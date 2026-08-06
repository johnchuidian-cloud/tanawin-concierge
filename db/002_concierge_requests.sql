-- Concierge Phase 2 — guest requests.
--
-- Guests submit via the security-definer RPC only (room code validated,
-- DINING CODES REJECTED — requests are room-gated per the 2026-08-05
-- decision, unlike the info app). Staff read and update status from Menu's
-- /staff dashboard (suite connection #7: Menu MAY write these rows — the one
-- sanctioned cross-write). Rate cap 10 requests/room/hour (Lexi).
--
-- Status model (deliberately NOT Menu's order lifecycle — a towel is not
-- "preparing"): new → acknowledged → done, plus cancelled.
--
-- Problem photos ride IN the row as compressed data URLs (Finance's pattern)
-- so anonymous guests never get storage-write access.

-- Note: Menu's `rooms` has NO id column (name/code/kind/is_active only), so
-- requests key rooms by NAME — no FK. Renaming a room orphans nothing; old
-- requests just keep the historical name, which is what a log should do.
create table public.concierge_requests (
  id uuid primary key default gen_random_uuid(),
  room_name text not null,
  kind text not null check (kind in ('towel_change', 'bin_clearing', 'room_items', 'problem')),
  items jsonb,                      -- room_items: [{id, label, qty, note}]
  note text,
  photo_data text,                  -- compressed data URL, problems only
  status text not null default 'new'
    check (status in ('new', 'acknowledged', 'done', 'cancelled')),
  out_of_hours boolean not null default false,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by text,
  done_at timestamptz,
  escalated_at timestamptz
);

create index concierge_requests_feed_idx on public.concierge_requests (status, created_at desc);
create index concierge_requests_room_idx on public.concierge_requests (room_name, created_at desc);

alter table public.concierge_requests enable row level security;

-- All active staff see and work the queue (front desk acknowledges, not
-- only admins). No delete policy: requests are history, like orders.
create policy "staff read requests" on public.concierge_requests
  for select to authenticated using (true);

create policy "staff update requests" on public.concierge_requests
  for update to authenticated
  using (exists (select 1 from public.staff s
                 where s.auth_uid = auth.uid() and s.is_active))
  with check (exists (select 1 from public.staff s
                      where s.auth_uid = auth.uid() and s.is_active));

-- Operating hours for the out-of-hours flag, kept as data so a schedule
-- change is an UPDATE, not DDL. Defaults from the handoff: staff 7am-7pm
-- weekdays / 9pm weekends; last call 6pm weekdays / 8pm weekends.
insert into public.concierge_content (key, value, last_reviewed) values
('request_config', '{
  "open": "07:00",
  "last_call_weekday": "18:00",
  "last_call_weekend": "20:00"
}', '2026-08-05')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Guest submit. Returns {ok:false, reason} on any rejection — never throws
-- for expected cases, and reveals nothing about which codes exist.
-- ---------------------------------------------------------------------------
create or replace function public.concierge_submit_request(
  p_access_code text,
  p_kind text,
  p_items jsonb default null,
  p_note text default null,
  p_photo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms%rowtype;
  v_recent int;
  v_cfg jsonb;
  v_now_local timestamptz;
  v_time time;
  v_dow int;
  v_last_call time;
  v_ooh boolean;
  v_id uuid;
begin
  select * into v_room
  from rooms
  where code = btrim(coalesce(p_access_code, '')) and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'bad_code');
  end if;
  if v_room.kind <> 'room' then
    return jsonb_build_object('ok', false, 'reason', 'room_guests_only');
  end if;

  if p_kind not in ('towel_change', 'bin_clearing', 'room_items', 'problem') then
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;
  if p_kind = 'room_items'
     and (p_items is null or jsonb_typeof(p_items) <> 'array'
          or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30) then
    return jsonb_build_object('ok', false, 'reason', 'bad_items');
  end if;
  if length(coalesce(p_note, '')) > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'note_too_long');
  end if;
  -- ~300 KB ceiling on the compressed photo data URL
  if p_photo is not null
     and (length(p_photo) > 400000 or p_photo not like 'data:image/%') then
    return jsonb_build_object('ok', false, 'reason', 'bad_photo');
  end if;

  select count(*) into v_recent
  from concierge_requests
  where room_name = v_room.name and created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- Out-of-hours: past last call or before opening, Asia/Manila.
  select value into v_cfg from concierge_content where key = 'request_config';
  v_now_local := now() at time zone 'Asia/Manila';
  v_time := v_now_local::time;
  v_dow := extract(isodow from v_now_local);   -- 6, 7 = weekend
  v_last_call := coalesce(
    case when v_dow in (6, 7) then (v_cfg->>'last_call_weekend')::time
         else (v_cfg->>'last_call_weekday')::time end,
    time '18:00');
  v_ooh := v_time >= v_last_call
        or v_time < coalesce((v_cfg->>'open')::time, time '07:00');

  insert into concierge_requests (room_name, kind, items, note, photo_data, out_of_hours)
  values (v_room.name, p_kind, p_items, nullif(btrim(coalesce(p_note, '')), ''), p_photo, v_ooh)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'out_of_hours', v_ooh);
end;
$$;

revoke all on function public.concierge_submit_request(text, text, jsonb, text, text) from public;
grant execute on function public.concierge_submit_request(text, text, jsonb, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Guest status peephole — the request uuid is the claim ticket, mirroring
-- Menu's get_order_status. No room data beyond what the guest already knows.
-- ---------------------------------------------------------------------------
create or replace function public.concierge_request_status(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r concierge_requests%rowtype;
begin
  select * into r from concierge_requests where id = p_id;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object(
    'ok', true,
    'kind', r.kind,
    'status', r.status,
    'out_of_hours', r.out_of_hours,
    'created_at', r.created_at,
    'acknowledged_at', r.acknowledged_at,
    'done_at', r.done_at);
end;
$$;

revoke all on function public.concierge_request_status(uuid) from public;
grant execute on function public.concierge_request_status(uuid) to anon, authenticated;

-- Seed the guest-facing request items list (Lexi-editable content block).
-- List per Lexi 2026-08-05; everything is free to borrow — no price notes.
insert into public.concierge_content (key, value, last_reviewed) values
('request_items', '{
  "items": [
    {"id": "bath_towel", "label": "Bath towel"},
    {"id": "floor_towel", "label": "Floor towel"},
    {"id": "pool_towel", "label": "Pool towel"},
    {"id": "blanket", "label": "Blanket"},
    {"id": "toilet_paper", "label": "Toilet paper"},
    {"id": "soap_3in1", "label": "3-in-1 soap"},
    {"id": "dish_soap", "label": "Dishwashing soap"},
    {"id": "plastic_bag", "label": "Plastic bag (trash or wet clothes)"},
    {"id": "barbecue", "label": "Barbecue grill"},
    {"id": "kitchen_utensil", "label": "Kitchen utensil", "needs_note": true, "note_prompt": "Which utensil?"},
    {"id": "kitchen_appliance", "label": "Kitchen appliance", "needs_note": true, "note_prompt": "Which appliance?"},
    {"id": "other", "label": "Something else", "needs_note": true, "note_prompt": "Tell us what you need"}
  ]
}', '2026-08-05')
on conflict (key) do nothing;

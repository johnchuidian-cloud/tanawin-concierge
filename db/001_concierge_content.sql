-- Concierge Phase 1 — Tanawin Info content.
--
-- Lives in the MENU Supabase project (lkeuiquqogtevsgvaddf), shared so room
-- codes validate against the same `rooms` table Menu uses. Discipline:
-- every Concierge table is prefixed concierge_, and Concierge NEVER writes
-- to Menu's tables (it only reads `rooms`, inside the RPC below).
--
-- Content model: one row per content block, value is a jsonb blob shaped by
-- the app. Every block carries last_reviewed (handoff §10 — staleness is the
-- app's biggest long-term risk; third-party blocks display it to guests).
--
-- Editing is ADMIN-only (Lexi owns content reviews). Staff can read.
-- Guests have no table access at all — they get content through the
-- security-definer RPC, which first validates their room access code.

create table public.concierge_content (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  last_reviewed date,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.concierge_content enable row level security;

create policy "staff read concierge content" on public.concierge_content
  for select to authenticated using (true);

create policy "admin insert concierge content" on public.concierge_content
  for insert to authenticated
  with check (exists (select 1 from public.staff s
                      where s.auth_uid = auth.uid()
                        and s.role = 'admin' and s.is_active));

create policy "admin update concierge content" on public.concierge_content
  for update to authenticated
  using (exists (select 1 from public.staff s
                 where s.auth_uid = auth.uid()
                   and s.role = 'admin' and s.is_active))
  with check (exists (select 1 from public.staff s
                      where s.auth_uid = auth.uid()
                        and s.role = 'admin' and s.is_active));

create policy "admin delete concierge content" on public.concierge_content
  for delete to authenticated
  using (exists (select 1 from public.staff s
                 where s.auth_uid = auth.uid()
                   and s.role = 'admin' and s.is_active));

-- The one guest read path. The access code both authenticates and resolves
-- the room (same contract as place_order: btrim + is_active). A wrong code
-- returns {ok:false} — no exception, no information about which codes exist.
create or replace function public.concierge_bootstrap(p_access_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms%rowtype;
  v_content jsonb;
begin
  select * into v_room
  from rooms
  where code = btrim(coalesce(p_access_code, '')) and is_active;
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  select coalesce(
           jsonb_object_agg(c.key, jsonb_build_object(
             'value', c.value,
             'last_reviewed', c.last_reviewed)),
           '{}'::jsonb)
  into v_content
  from concierge_content c;

  return jsonb_build_object(
    'ok', true,
    'room', jsonb_build_object('name', v_room.name, 'kind', v_room.kind),
    'content', v_content);
end;
$$;

revoke all on function public.concierge_bootstrap(text) from public;
grant execute on function public.concierge_bootstrap(text) to anon, authenticated;

-- Public bucket for the Sinagtala map image (swappable without a rebuild —
-- a new map is being drawn) and future content photos. Admin-only writes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('concierge-assets', 'concierge-assets', true, 5242880,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy "admin insert concierge assets" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'concierge-assets'
              and exists (select 1 from public.staff s
                          where s.auth_uid = auth.uid()
                            and s.role = 'admin' and s.is_active));
create policy "admin update concierge assets" on storage.objects
  for update to authenticated
  using (bucket_id = 'concierge-assets'
         and exists (select 1 from public.staff s
                     where s.auth_uid = auth.uid()
                       and s.role = 'admin' and s.is_active));
create policy "admin delete concierge assets" on storage.objects
  for delete to authenticated
  using (bucket_id = 'concierge-assets'
         and exists (select 1 from public.staff s
                     where s.auth_uid = auth.uid()
                       and s.role = 'admin' and s.is_active));

-- ---------------------------------------------------------------------------
-- Seed content. Everything below is transcribed from the 2026-08-05 handoff
-- (Lexi's answers) — nothing invented. Wifi and contact ship EMPTY: the wifi
-- upgrade is in progress and front-desk numbers weren't in the handoff; the
-- app renders only populated entries. last_reviewed = the handoff date.
-- ---------------------------------------------------------------------------

insert into public.concierge_content (key, value, last_reviewed) values

('wifi', '{"networks": []}', null),

('pool_hours', '{
  "intro": "These pools are Sinagtala''s, not Tanawin''s — hours can change without notice.",
  "pools": [
    {"name": "Infinity Pool", "hours": "8:00 AM – 9:00 PM", "location": "Near the villas — closest to Tanawin"},
    {"name": "Sky Pool", "hours": "9:00 AM – 5:00 PM", "location": "Adventure Park"},
    {"name": "Lagoon Pool", "hours": "9:00 AM – 5:00 PM", "location": "Silangan camping area"}
  ],
  "tip": "After 5 PM only the Infinity Pool is still open — Sky and Lagoon close at 5."
}', '2026-08-05'),

('key_info', '{
  "items": [
    {"label": "Staff hours", "value": "7:00 AM – 7:00 PM weekdays, until 9:00 PM on weekends"},
    {"label": "Last call", "value": "6:00 PM weekdays, 8:00 PM weekends — for coffee, extra towels and other requests"},
    {"label": "Breakfast", "value": "7:00 – 9:00 AM, third floor of the Wing building"},
    {"label": "Checkout", "value": "11:00 AM. Free until 12 NN if there is no next guest — please ask at the front desk. Late checkout for a fee if the room is available."},
    {"label": "Quiet time", "value": "10:00 PM – 6:00 AM — feel free to party, but keep it indoors"}
  ]
}', '2026-08-05'),

('getting_around', '{
  "intro": "Tanawin is marker 14 on the Sinagtala guide map — right beside the Dining Pavilion (6), the Adventure Park Front Desk (5) and the Sky Pool (SP). Sinagtala is on a hillside, so whether a walk is uphill or downhill matters more than the distance.",
  "image_url": null,
  "directions": [
    {"place": "Infinity Pool", "walk": "About 2 minutes — a level walk past the villas"},
    {"place": "Lagoon Pool", "walk": "Downhill to the Silangan camping area — it''s uphill coming back"}
  ]
}', '2026-08-05'),

('house_rules', '{
  "sections": [
    {"title": "Housekeeping & requests", "items": [
      "There is no daily housekeeping — but bath towels are replaced daily on request.",
      "Bins are cleared on request. Please use separate trash bags for food waste.",
      "Please don''t hang wet clothes on railings or furniture — drying racks are provided."
    ]},
    {"title": "At the pool", "items": [
      "Proper swimming attire please — cotton clothing damages the pool filters.",
      "By the pool: snacks are fine, but non-breakable containers only."
    ]},
    {"title": "Smoking", "items": [
      "No smoking indoors.",
      "Ask the staff for an ashtray when smoking outdoors — please don''t stub out into pots, plants or the forest."
    ]},
    {"title": "We''re in a national park", "items": [
      "Please don''t leave food outdoors overnight.",
      "Don''t feed or harass the wildlife.",
      "Please don''t pick fruits, flowers or plants."
    ]},
    {"title": "General", "items": [
      "Please be mindful with electricity — switch the aircon off when leaving the room.",
      "Pets should be kept in check — and please pick up after them.",
      "Guests are responsible for their own children and belongings."
    ]}
  ]
}', '2026-08-05'),

('contact', '{"globe": "", "smart": "", "messenger": "", "viber": ""}', null);

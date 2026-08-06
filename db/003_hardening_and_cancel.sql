-- Concierge hardening batch (2026-08-05, John's fix list):
--   #2 photos: accept ONLY jpeg/png data URLs (was any image/*)
--   #3 code-guessing throttle: per-IP failed-attempt cap on both guest RPCs
--   #5 guest cancel: a still-new request can be cancelled by whoever holds
--      its uuid (the claim ticket, same trust model as the status peephole)

-- Failed code attempts per IP. Touched only by the definer functions;
-- RLS on with no policies = invisible to every client role.
create table if not exists public.concierge_code_attempts (
  ip text primary key,
  fails int not null default 1,
  window_start timestamptz not null default now()
);
alter table public.concierge_code_attempts enable row level security;

-- Helper: caller IP from PostgREST headers (first hop of x-forwarded-for).
-- Returns '' when unavailable — throttle fails OPEN, never locks guests out
-- on infrastructure quirks.
create or replace function public.concierge_caller_ip()
returns text
language sql
stable
as $$
  select split_part(coalesce(
    (current_setting('request.headers', true))::json->>'x-forwarded-for', ''), ',', 1);
$$;

-- True if this IP is over the bad-code budget (30 fails / 15 minutes).
-- Generous on purpose: a real guest mistypes a handful of times; 30 in 15
-- minutes is a script. CGNAT neighbours share budget — acceptable at 30.
create or replace function public.concierge_code_throttled(p_ip text)
returns boolean
language plpgsql
as $$
declare
  v record;
begin
  if p_ip = '' then return false; end if;
  -- opportunistic tidy-up; the table stays tiny
  delete from concierge_code_attempts where window_start < now() - interval '1 day';
  select * into v from concierge_code_attempts where ip = p_ip;
  return found and v.window_start > now() - interval '15 minutes' and v.fails >= 30;
end;
$$;

create or replace function public.concierge_note_bad_code(p_ip text)
returns void
language sql
as $$
  insert into concierge_code_attempts (ip) values (p_ip)
  on conflict (ip) do update set
    fails = case when concierge_code_attempts.window_start < now() - interval '15 minutes'
                 then 1 else concierge_code_attempts.fails + 1 end,
    window_start = case when concierge_code_attempts.window_start < now() - interval '15 minutes'
                        then now() else concierge_code_attempts.window_start end
  where p_ip <> '';
$$;

-- Bootstrap, now throttled. Same {ok:false} for wrong code and throttle —
-- an enumeration script learns nothing from the shape of the refusal.
create or replace function public.concierge_bootstrap(p_access_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text := concierge_caller_ip();
  v_room rooms%rowtype;
  v_content jsonb;
begin
  if concierge_code_throttled(v_ip) then
    return jsonb_build_object('ok', false);
  end if;

  select * into v_room
  from rooms
  where code = btrim(coalesce(p_access_code, '')) and is_active;
  if not found then
    perform concierge_note_bad_code(v_ip);
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

-- Submit, now throttled + jpeg/png-only photos.
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
  v_ip text := concierge_caller_ip();
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
  if concierge_code_throttled(v_ip) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select * into v_room
  from rooms
  where code = btrim(coalesce(p_access_code, '')) and is_active;
  if not found then
    perform concierge_note_bad_code(v_ip);
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
  if p_photo is not null
     and (length(p_photo) > 400000
          or (p_photo not like 'data:image/jpeg%' and p_photo not like 'data:image/png%')) then
    return jsonb_build_object('ok', false, 'reason', 'bad_photo');
  end if;

  select count(*) into v_recent
  from concierge_requests
  where room_name = v_room.name and created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select value into v_cfg from concierge_content where key = 'request_config';
  v_now_local := now() at time zone 'Asia/Manila';
  v_time := v_now_local::time;
  v_dow := extract(isodow from v_now_local);
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

-- #5 Guest cancel: only while still 'new' — once staff have acknowledged,
-- cancelling is a conversation, not a button.
create or replace function public.concierge_cancel_request(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update concierge_requests
  set status = 'cancelled'
  where id = p_id and status = 'new'
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_cancellable');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.concierge_cancel_request(uuid) from public;
grant execute on function public.concierge_cancel_request(uuid) to anon, authenticated;

-- Bug-hunt hardening (2026-08-07):
--   * items array is now sanitized ELEMENT-BY-ELEMENT server-side — a
--     code-holder poking the RPC directly could previously insert junk
--     elements ([1,2,3]) that rendered as "undefined" rows in the staff
--     dashboard. Each element is rebuilt: label (required, ≤80 chars),
--     qty clamped 1..99, note ≤200, id ≤60; unknown fields stripped.
--   * photo prefix tightened to full data:image/{jpeg,png};base64, form.

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
  v_items jsonb;
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

  if p_kind = 'room_items' then
    if p_items is null or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
      return jsonb_build_object('ok', false, 'reason', 'bad_items');
    end if;
    -- rebuild each element from scratch: only known fields, bounded sizes
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', left(e->>'id', 60),
             'label', left(e->>'label', 80),
             'qty', greatest(1, least(99, coalesce((e->>'qty')::int, 1))),
             'note', nullif(left(btrim(coalesce(e->>'note', '')), 200), ''))))
    into v_items
    from jsonb_array_elements(p_items) e
    where jsonb_typeof(e) = 'object'
      and coalesce(btrim(e->>'label'), '') <> '';
    if v_items is null or jsonb_array_length(v_items) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'bad_items');
    end if;
  end if;

  if length(coalesce(p_note, '')) > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'note_too_long');
  end if;
  if p_photo is not null
     and (length(p_photo) > 400000
          or (p_photo not like 'data:image/jpeg;base64,%'
              and p_photo not like 'data:image/png;base64,%')) then
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
  values (v_room.name, p_kind, v_items, nullif(btrim(coalesce(p_note, '')), ''), p_photo, v_ooh)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'out_of_hours', v_ooh);
end;
$$;

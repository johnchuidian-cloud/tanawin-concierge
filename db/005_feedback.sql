-- Guest feedback (approved by Lexi 2026-08-07): one small "How was your
-- stay?" card. Routing happens client-side: 4-5 stars get a "share on
-- Google" button (URL in the feedback_config content row, editable by
-- Lexi); lower ratings just land here, privately, for the staff to read.
--
-- Both room AND dining codes may submit (a diner's opinion is welcome);
-- capped 3 per room per 24h. No guest PII is collected — deliberately no
-- name/contact field. Staff read via RLS; guests have no table access.

create table public.concierge_feedback (
  id uuid primary key default gen_random_uuid(),
  room_name text not null,
  rating int not null check (rating between 1 and 5),
  enjoyed text,
  improve text,
  app_note text,
  created_at timestamptz not null default now()
);

create index concierge_feedback_time_idx on public.concierge_feedback (created_at desc);

alter table public.concierge_feedback enable row level security;

create policy "staff read feedback" on public.concierge_feedback
  for select to authenticated using (true);
-- no update/delete policies: feedback is history

create or replace function public.concierge_submit_feedback(
  p_access_code text,
  p_rating int,
  p_enjoyed text default null,
  p_improve text default null,
  p_app_note text default null
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

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return jsonb_build_object('ok', false, 'reason', 'bad_rating');
  end if;
  if length(coalesce(p_enjoyed, '')) > 1000
     or length(coalesce(p_improve, '')) > 1000
     or length(coalesce(p_app_note, '')) > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'too_long');
  end if;

  select count(*) into v_recent
  from concierge_feedback
  where room_name = v_room.name and created_at > now() - interval '24 hours';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  insert into concierge_feedback (room_name, rating, enjoyed, improve, app_note)
  values (
    v_room.name,
    p_rating,
    nullif(btrim(coalesce(p_enjoyed, '')), ''),
    nullif(btrim(coalesce(p_improve, '')), ''),
    nullif(btrim(coalesce(p_app_note, '')), ''));

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.concierge_submit_feedback(text, int, text, text, text) from public;
grant execute on function public.concierge_submit_feedback(text, int, text, text, text) to anon, authenticated;

-- Google review link, Lexi-editable; the guest-side Google button renders
-- only when this is populated.
insert into public.concierge_content (key, value, last_reviewed) values
('feedback_config', '{"google_url": ""}', null)
on conflict (key) do nothing;

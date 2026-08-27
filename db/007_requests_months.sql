-- Requests by month (Lexi approved 2026-08-24). Sibling to Menu's
-- orders_months(): Menu builds the UI on their combined queue — their
-- renderer, their screen — and reads this. Concierge owns the table, so the
-- aggregate lives here.
--
-- Same three rules as concierge_feedback_months():
--   * ONE ROW PER MONTH, aggregated in SQL, so the caller can never pull the
--     table across the wire or be truncated into reporting a wrong total.
--   * Months cut in Asia/Manila. PH is UTC+8, so a UTC boundary files every
--     request made before 8am on the 1st under the previous month.
--   * The gate lives in the query body (security definer), AND anon is
--     revoked explicitly below.
--
-- Visible to ALL active staff, not just admins: there is no money in a towel
-- request, and the people who work the queue are the ones who need to look
-- back at it. That matches the existing "staff read requests" RLS policy.

create or replace function public.concierge_requests_months()
returns table (
  month text,            -- 'YYYY-MM' in PH time
  n int,
  towel_change int,
  bin_clearing int,
  room_items int,
  problem int,
  cancelled int,
  out_of_hours int
)
language sql
security definer
set search_path = public
as $$
  select
    to_char(r.created_at at time zone 'Asia/Manila', 'YYYY-MM') as month,
    count(*)::int,
    count(*) filter (where r.kind = 'towel_change')::int,
    count(*) filter (where r.kind = 'bin_clearing')::int,
    count(*) filter (where r.kind = 'room_items')::int,
    count(*) filter (where r.kind = 'problem')::int,
    count(*) filter (where r.status = 'cancelled')::int,
    -- how often guests needed something outside staffed hours: a staffing
    -- signal Lexi can act on, and free to collect here
    count(*) filter (where r.out_of_hours)::int
  from public.concierge_requests r
  where exists (select 1 from public.staff s
                where s.auth_uid = auth.uid() and s.is_active)
  group by 1
  order by 1 desc;
$$;

-- Revoking from PUBLIC is not enough: Supabase's default privileges grant
-- EXECUTE to anon/authenticated/service_role BY NAME at creation, and a PUBLIC
-- revoke leaves those standing. And per Menu's 2026-08-24 finding, CREATE OR
-- REPLACE re-applies them — so any migration that ever replaces this function
-- must repeat these two lines and re-verify with has_function_privilege().
revoke all on function public.concierge_requests_months() from public;
revoke all on function public.concierge_requests_months() from anon;
grant execute on function public.concierge_requests_months() to authenticated;

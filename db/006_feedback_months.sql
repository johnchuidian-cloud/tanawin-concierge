-- Reviews by month (2026-08-24). The inbox was a flat "newest 30", which
-- stops being an archive the moment there are 31. This adds the month index
-- behind reviews.html.
--
-- The aggregate runs in SQL and returns ONE ROW PER MONTH, so the page never
-- pulls the table across the wire and can't be truncated by PostgREST's
-- row cap the way a select-everything-and-count-in-JS page would be. The
-- month rows themselves are read by the page with a normal filtered select
-- plus .range() paging.
--
-- Months are cut in Asia/Manila, NOT UTC: PH is UTC+8, so a UTC month
-- boundary would file everything before 8am on the 1st under the previous
-- month. Same reason the editor uses todayLocal() instead of toISOString().

create or replace function public.concierge_feedback_months()
returns table (
  month text,          -- 'YYYY-MM' in PH time
  n int,
  avg_rating numeric,
  s1 int, s2 int, s3 int, s4 int, s5 int
)
language sql
security definer
set search_path = public
as $$
  select
    to_char(f.created_at at time zone 'Asia/Manila', 'YYYY-MM') as month,
    count(*)::int as n,
    round(avg(f.rating)::numeric, 1) as avg_rating,
    count(*) filter (where f.rating = 1)::int as s1,
    count(*) filter (where f.rating = 2)::int as s2,
    count(*) filter (where f.rating = 3)::int as s3,
    count(*) filter (where f.rating = 4)::int as s4,
    count(*) filter (where f.rating = 5)::int as s5
  from public.concierge_feedback f
  -- security definer, so the admin gate is here rather than in RLS
  where exists (select 1 from public.staff s
                where s.auth_uid = auth.uid()
                  and s.role = 'admin' and s.is_active)
  group by 1
  order by 1 desc;
$$;

-- Revoking from PUBLIC is NOT enough on Supabase: its default privileges
-- grant EXECUTE to anon/authenticated/service_role by name the moment a
-- function is created, and a PUBLIC revoke leaves those named grants intact
-- (verified 2026-08-24 — anon could still call this). Every staff-only
-- function needs the explicit revoke from anon below. The admin check inside
-- the body already returns nothing to a caller without an admin session, so
-- this is the second lock, not the only one.
revoke all on function public.concierge_feedback_months() from public;
revoke all on function public.concierge_feedback_months() from anon;
grant execute on function public.concierge_feedback_months() to authenticated;

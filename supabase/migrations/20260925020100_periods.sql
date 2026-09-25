-- Phase 3: periods (R5.7) in SQL, mirroring src/lib/periods.ts, and week/fortnight hours views.

-- R5.7.2 company-wide fortnights anchored on settings.fortnight_anchor, with a real floor
-- before the anchor (the day before the anchor is fortnight -1, not 0).
create or replace function private.fortnight_index(d date)
returns integer
language sql
stable
set search_path = ''
as $$
  select floor((d - s.fortnight_anchor) / 14.0)::integer from public.daymark_settings s where s.id = 1;
$$;

create or replace function private.fortnight_start(d date)
returns date
language sql
stable
set search_path = ''
as $$
  select s.fortnight_anchor + 14 * private.fortnight_index(d) from public.daymark_settings s where s.id = 1;
$$;

-- R5.7.1 weeks run Mon–Sun. R5.7.3 week_no(d) = (monday(d) − monday(start)) / 7 + 1;
-- total weeks = week_no(planned_end).
create or replace function private.week_no(d date, start_date date)
returns integer
language sql
immutable
set search_path = ''
as $$
  select ((d - extract(isodow from d)::integer) - (start_date - extract(isodow from start_date)::integer)) / 7 + 1;
$$;

create view public.daymark_v_week_hours with (security_invoker = true) as
select r.placement_id,
       r.work_date - (extract(isodow from r.work_date)::integer - 1) as week_start,
       private.week_no(r.work_date, p.start_date) as week_no,
       sum(r.scheduled)::integer as scheduled,
       sum(r.worked)::integer as worked,
       sum(r.counted)::integer as counted,
       sum(r.overtime)::integer as overtime,
       sum(r.approved_ot)::integer as approved_ot,
       coalesce(sum(r.short), 0)::integer as short,
       (count(*) filter (where r.no_show))::integer as no_shows,
       (count(*) filter (where r.late))::integer as late_days
from public.daymark_day_results r
join public.daymark_placements p on p.id = r.placement_id
group by r.placement_id, 2, 3;

create view public.daymark_v_fortnight_hours with (security_invoker = true) as
select r.placement_id,
       f.fortnight_start,
       f.fortnight_start + 13 as fortnight_end,
       sum(r.scheduled)::integer as scheduled,
       sum(r.worked)::integer as worked,
       sum(r.counted)::integer as counted,
       sum(r.overtime)::integer as overtime,
       sum(r.approved_ot)::integer as approved_ot,
       coalesce(sum(r.short), 0)::integer as short,
       (count(*) filter (where r.no_show))::integer as no_shows,
       (count(*) filter (where r.late))::integer as late_days
from public.daymark_day_results r
cross join lateral (select private.fortnight_start(r.work_date) as fortnight_start) f
group by r.placement_id, f.fortnight_start;

revoke all on table public.daymark_v_week_hours, public.daymark_v_fortnight_hours from public, anon, authenticated;
grant select on table public.daymark_v_week_hours, public.daymark_v_fortnight_hours to authenticated, service_role;

revoke all on function private.fortnight_index(date) from public, anon;
revoke all on function private.fortnight_start(date) from public, anon;
revoke all on function private.week_no(date, date) from public, anon;
grant execute on function private.fortnight_index(date) to authenticated, service_role;
grant execute on function private.fortnight_start(date) to authenticated, service_role;
grant execute on function private.week_no(date, date) to authenticated, service_role;

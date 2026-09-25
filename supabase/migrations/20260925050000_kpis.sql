-- Phases 6–7: one KPI round trip per dashboard (§12) and the flagged-events list (review rule 9).
-- Integer minutes; percentages are whole numbers 0–100, or null when there is nothing to measure.

create or replace function private.pct(part numeric, whole numeric)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(whole, 0) = 0 then null else round(100 * part / whole)::integer end;
$$;

-- Attendance and punctuality over closed scheduled days in [from_date, to_date] (§12 intern 6).
-- attended = a scheduled day that was not a no-show; leave days have scheduled = 0 and drop out.
create or replace function private.attendance(placements uuid[], from_date date, to_date date)
returns table (attendance_pct integer, on_time_pct integer)
language sql
stable
security definer
set search_path = ''
as $$
  select private.pct(count(*) filter (where not r.no_show), count(*)),
         private.pct(count(*) filter (where not r.no_show and not r.late), count(*) filter (where not r.no_show))
  from public.daymark_day_results r
  where r.placement_id = any (placements) and r.scheduled > 0 and r.closed
    and r.work_date between from_date and to_date;
$$;

create or replace function private.kpi_intern()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  pl uuid := private.current_placement(me);
  p record;
  today date := private.darwin_today();
  week_start date := today - (extract(isodow from today)::integer - 1);
  a record;
  streak integer := 0;
  d record;
begin
  if pl is null then
    return null;
  end if;
  select * into p from private.progress_rows(array[pl]);
  select * into a from private.attendance(array[pl], today - 28, today);

  for d in
    select r.work_date, exists (select 1 from public.daymark_work_logs w where w.placement_id = pl and w.work_date = r.work_date) as logged
    from public.daymark_day_results r
    where r.placement_id = pl and r.raw > 0
    order by r.work_date desc
  loop
    exit when not d.logged;
    streak := streak + 1;
  end loop;

  return jsonb_build_object(
    'placement_id', pl,
    'counted_total', p.counted_total,
    'target_minutes', p.target_minutes,
    'remaining', p.remaining,
    'week_no', p.week_no,
    'total_weeks', p.total_weeks,
    'forecast_finish', p.forecast_finish,
    'days_late', p.days_late,
    'pace', p.pace,
    'owed', p.owed,
    'this_week', jsonb_build_object(
      'counted', coalesce((select sum(r.counted) from public.daymark_day_results r
                           where r.placement_id = pl and r.work_date between week_start and week_start + 6), 0),
      'scheduled', coalesce((select sum(s.planned_minutes) from public.daymark_scheduled_days s
                             where s.placement_id = pl and s.status in ('scheduled', 'leave')
                               and s.work_date between week_start and week_start + 6), 0)),
    'on_time_pct', a.on_time_pct,
    'attendance_pct', a.attendance_pct,
    'work_log_streak', streak,
    'pending_requests', (select count(*) from public.daymark_requests x
                         where x.placement_id = pl and x.status in ('pending_supervisor', 'pending_admin'))
  );
end;
$$;

create or replace function private.kpi_supervisor()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  ids uuid[];
  fs date := private.fortnight_start(private.darwin_today());
  fe date := private.fortnight_start(private.darwin_today()) + 13;
  a record;
begin
  if not exists (select 1 from public.daymark_profiles x where x.id = me and x.is_supervisor and x.active) then
    raise exception 'Only supervisors see this.' using errcode = '42501';
  end if;
  select coalesce(array_agg(p.id), '{}') into ids from public.daymark_placements p
  where p.supervisor_id = me and p.status in ('active', 'extended', 'target_reached');
  select * into a from private.attendance(ids, fs, fe);

  return jsonb_build_object(
    'approvals_waiting', (select count(*) from public.daymark_requests r
                          where r.placement_id = any (ids) and r.status = 'pending_supervisor'),
    'oldest_hours', (select floor(extract(epoch from private.clock_now() - min(r.created_at)) / 3600)::integer
                     from public.daymark_requests r where r.placement_id = any (ids) and r.status = 'pending_supervisor'),
    'at_risk', (select count(*) from private.progress_rows(ids) x where cardinality(x.risk_reasons) > 0),
    'attendance_pct', a.attendance_pct,
    'on_time_pct', a.on_time_pct,
    'overtime_approved_minutes', coalesce((select sum(r.approved_ot) from public.daymark_day_results r
                                           where r.placement_id = any (ids) and r.work_date between fs and fe), 0),
    'work_log_pct', (select private.pct(count(*) filter (where exists (
                              select 1 from public.daymark_work_logs w where w.placement_id = r.placement_id and w.work_date = r.work_date)),
                            count(*))
                     from public.daymark_day_results r
                     where r.placement_id = any (ids) and r.raw > 0 and r.work_date between fs and fe)
  );
end;
$$;

create or replace function private.kpi_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := private.darwin_today();
  fs date := private.fortnight_start(private.darwin_today());
  fe date := private.fortnight_start(private.darwin_today()) + 13;
  live uuid[];
  site public.daymark_sites%rowtype;
  a record;
begin
  perform private.require_admin();
  select coalesce(array_agg(p.id), '{}') into live from public.daymark_placements p where p.status in ('active', 'extended');
  select * into site from public.daymark_sites s where s.active order by s.created_at limit 1;
  select * into a from private.attendance(live, today - 28, today);

  return jsonb_build_object(
    'active', cardinality(live),
    'starting_soon', (select count(*) from public.daymark_placements p
                      where p.status in ('active', 'extended') and p.start_date between today + 1 and today + 14),
    'finishing_soon', (select count(*) from public.daymark_placements p
                       where p.status in ('active', 'extended') and p.planned_end_date between today and today + 14),
    'pct_on_pace', (select private.pct(count(*) filter (where x.pace = 'green'), count(*)) from private.progress_rows(live) x),
    'counted_fortnight', coalesce((select sum(r.counted) from public.daymark_day_results r where r.work_date between fs and fe), 0),
    'counted_all_time', coalesce((select sum(r.counted) from public.daymark_day_results r), 0),
    'attendance_pct', a.attendance_pct,
    'on_time_pct', a.on_time_pct,
    'no_shows_fortnight', (select count(*) from public.daymark_day_results r where r.no_show and r.work_date between fs and fe),
    'missed_punches_fortnight', (select count(*) from public.daymark_shifts s where s.auto_closed and s.work_date between fs and fe),
    'turnaround', coalesce((
      select jsonb_agg(jsonb_build_object('supervisor_id', t.supervisor_id, 'name', t.name, 'median_hours', t.median_hours)
                       order by t.name)
      from (
        select p.supervisor_id, pr.display_name as name,
               round(percentile_cont(0.5) within group (
                 order by extract(epoch from coalesce(r.supervisor_decided_at, r.admin_decided_at) - r.created_at) / 3600
               )::numeric, 1) as median_hours
        from public.daymark_requests r
        join public.daymark_placements p on p.id = r.placement_id
        join public.daymark_profiles pr on pr.id = p.supervisor_id
        where coalesce(r.supervisor_decided_at, r.admin_decided_at) >= private.clock_now() - interval '30 days'
        group by p.supervisor_id, pr.display_name
      ) t), '[]'),
    'desk_use_pct', (
      select private.pct(sum(h.n), site.standard_capacity * count(*))
      from generate_series(fs, least(fe, today), interval '1 day') g(d)
      cross join lateral (select count(*) as n from public.daymark_scheduled_days x
                          where x.site_id = site.id and x.work_date = g.d::date and x.status = 'scheduled') h
      where extract(isodow from g.d) <= 5
        and not exists (select 1 from public.daymark_closure_days c where c.day = g.d::date and (c.site_id is null or c.site_id = site.id))),
    'days_at_four', (
      select count(*) from generate_series(fs, fe, interval '1 day') g(d)
      where (select count(*) from public.daymark_scheduled_days x
             where x.site_id = site.id and x.work_date = g.d::date and x.status = 'scheduled') > site.standard_capacity),
    'outcomes', jsonb_build_object(
      'on_time', (select count(*) from public.daymark_placements p where p.status = 'completed'
                  and p.ended_on >= today - 180 and p.ended_on <= p.original_end_date),
      'late', (select count(*) from public.daymark_placements p where p.status = 'completed'
               and p.ended_on >= today - 180 and p.ended_on > p.original_end_date),
      'withdrawn', (select count(*) from public.daymark_placements p where p.status = 'withdrawn' and p.ended_on >= today - 180)),
    'interns_per_supervisor', coalesce((
      select jsonb_agg(jsonb_build_object('supervisor_id', s.id, 'name', s.display_name, 'interns', s.n) order by s.display_name)
      from (select pr.id, pr.display_name, count(p.id) as n
            from public.daymark_profiles pr
            left join public.daymark_placements p on p.supervisor_id = pr.id and p.status in ('active', 'extended', 'target_reached')
            where pr.is_supervisor and pr.active
            group by pr.id, pr.display_name) s), '[]'),
    'heatmap', (
      select jsonb_agg(jsonb_build_object('date', g.d::date, 'headcount',
               (select count(*) from public.daymark_scheduled_days x
                where x.site_id = site.id and x.work_date = g.d::date and x.status = 'scheduled')) order by g.d)
      from generate_series(fs, fe, interval '1 day') g(d)
      where extract(isodow from g.d) <= 5)
  );
end;
$$;

create or replace function private.flagged_events(from_date date, to_date date)
returns table (punch_id uuid, intern_id uuid, display_name text, occurred_at timestamptz, event_type text,
               flags text[], distance_m double precision, accuracy_m double precision, photo_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select x.id, x.user_id, pr.display_name, x.occurred_at, x.event_type, x.flags, x.distance_m, x.accuracy_m, x.photo_path
  from public.daymark_punches x
  join public.daymark_profiles pr on pr.id = x.user_id
  where cardinality(x.flags) > 0
    and x.occurred_at >= private.darwin_at(from_date, '00:00') and x.occurred_at < private.darwin_at(to_date + 1, '00:00')
    and (private.is_admin() or private.is_supervisor_of(x.user_id))
  order by x.occurred_at desc;
$$;

create or replace function public.kpi_intern()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.kpi_intern(); $$;
create or replace function public.kpi_supervisor()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.kpi_supervisor(); $$;
create or replace function public.kpi_admin()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.kpi_admin(); $$;
create or replace function public.flagged_events(from_date date, to_date date)
returns table (punch_id uuid, intern_id uuid, display_name text, occurred_at timestamptz, event_type text,
               flags text[], distance_m double precision, accuracy_m double precision, photo_path text)
language sql stable security invoker set search_path = ''
as $$ select * from private.flagged_events(from_date, to_date); $$;

revoke all on function private.pct(numeric, numeric) from public, anon;
revoke all on function private.attendance(uuid[], date, date) from public, anon, authenticated;
revoke all on function private.kpi_intern() from public, anon;
revoke all on function private.kpi_supervisor() from public, anon;
revoke all on function private.kpi_admin() from public, anon;
revoke all on function private.flagged_events(date, date) from public, anon;
revoke all on function public.kpi_intern() from public, anon;
revoke all on function public.kpi_supervisor() from public, anon;
revoke all on function public.kpi_admin() from public, anon;
revoke all on function public.flagged_events(date, date) from public, anon;
grant execute on function private.pct(numeric, numeric) to authenticated;
grant execute on function private.kpi_intern() to authenticated;
grant execute on function private.kpi_supervisor() to authenticated;
grant execute on function private.kpi_admin() to authenticated;
grant execute on function private.flagged_events(date, date) to authenticated;
grant execute on function public.kpi_intern() to authenticated;
grant execute on function public.kpi_supervisor() to authenticated;
grant execute on function public.kpi_admin() to authenticated;
grant execute on function public.flagged_events(date, date) to authenticated;

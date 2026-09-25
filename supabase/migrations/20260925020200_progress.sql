-- Phase 3: owed balance and progress (§8.3, R5.6), forecast finish (§8.4), at risk (§8.8, R5.10),
-- and the check-ins table the risk rule reads (Phase 6 adds its RPC).

create table public.daymark_checkins (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.daymark_placements (id) on delete cascade,
  supervisor_id uuid references public.daymark_profiles (id) on delete set null,
  week_start date not null check (extract(isodow from week_start) = 1),
  reliability smallint not null check (reliability between 1 and 5),
  quality smallint not null check (quality between 1 and 5),
  communication smallint not null check (communication between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (placement_id, week_start)
);
create index daymark_checkins_supervisor_idx on public.daymark_checkins (supervisor_id);

alter table public.daymark_checkins enable row level security;
create policy "Check-ins follow the placement" on public.daymark_checkins
  for select to authenticated using ((select private.can_view_placement(placement_id)));
revoke all on table public.daymark_checkins from public, anon, authenticated;
grant select on table public.daymark_checkins to authenticated;
grant all on table public.daymark_checkins to service_role;

-- One set-based query for any set of placements the caller may view (§8.3, §8.4, §8.8).
-- No loops over punches: it aggregates the day-result cache and the schedule by index.
create or replace function private.progress_rows(ids uuid[])
returns table (
  placement_id uuid,
  intern_id uuid,
  intern_name text,
  supervisor_id uuid,
  status text,
  start_date date,
  planned_end_date date,
  target_minutes integer,
  target_reached_at timestamptz,
  expected_to_date integer,
  counted_to_date integer,
  owed integer,
  counted_total integer,
  remaining integer,
  future_sched integer,
  schedule_gap integer,
  week_no integer,
  total_weeks integer,
  fortnight_start date,
  fortnight_end date,
  no_shows_fortnight integer,
  forecast_ratio numeric,
  forecast_finish date,
  days_late integer,
  pace text,
  latest_checkin_average numeric,
  risk_reasons text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select private.darwin_today() as today,
           private.clock_now() >= private.darwin_at(private.darwin_today(), '19:00') as today_closed,
           private.fortnight_start(private.darwin_today()) as fs
  ),
  pl as (
    select p.id, p.intern_id, pr.display_name, p.supervisor_id, p.status, p.site_id, p.start_date,
           p.planned_end_date, p.target_minutes, p.target_reached_at,
           greatest(p.start_date, t.today - 28) as win_start,                       -- §8.4 window
           exists (select 1 from public.daymark_shifts s
                   where s.placement_id = p.id and s.work_date = t.today) as shift_today
    from public.daymark_placements p
    join public.daymark_profiles pr on pr.id = p.intern_id
    cross join t
    where p.id = any (ids) and private.can_view_placement(p.id)
  ),
  sd as (
    select d.placement_id,
           -- R5.6.1 expected: scheduled and leave days before today, plus today once closed.
           -- Leave stays owed (R5.6.4); cancelled and moved days are not (R5.2.5).
           sum(d.planned_minutes) filter (where d.status in ('scheduled', 'leave')
             and (d.work_date < t.today or (d.work_date = t.today and t.today_closed))) as expected,
           sum(d.planned_minutes) filter (where d.status in ('scheduled', 'leave')
             and d.work_date >= pl.win_start and d.work_date < t.today) as e_window,
           -- §8.3 future: scheduled days after today, plus today if nothing is clocked yet.
           sum(d.planned_minutes) filter (where d.status = 'scheduled'
             and (d.work_date > t.today or (d.work_date = t.today and not t.today_closed and not pl.shift_today))) as future_sched
    from public.daymark_scheduled_days d
    join pl on pl.id = d.placement_id
    cross join t
    group by d.placement_id
  ),
  dr as (
    select r.placement_id,
           sum(r.counted) as counted_total,                                         -- incl. today so far
           sum(r.counted) filter (where r.work_date < t.today
                                  or (r.work_date = t.today and t.today_closed)) as counted_to_date,  -- R5.6.2
           sum(r.counted) filter (where r.work_date >= pl.win_start and r.work_date < t.today) as c_window,
           count(*) filter (where r.no_show and r.work_date between t.fs and t.today) as no_shows
    from public.daymark_day_results r
    join pl on pl.id = r.placement_id
    cross join t
    group by r.placement_id
  ),
  b as (
    select pl.*,
           coalesce(sd.expected, 0)::integer as expected,
           coalesce(dr.counted_to_date, 0)::integer as counted_to_date,
           coalesce(dr.counted_total, 0)::integer as counted_total,
           greatest(0, pl.target_minutes - coalesce(dr.counted_total, 0))::integer as remaining,
           coalesce(sd.future_sched, 0)::integer as future_sched,
           coalesce(dr.no_shows, 0)::integer as no_shows,
           -- §8.4 recent attendance ratio, numeric, clamped 0.2–1.2; 1.0 without history
           case when coalesce(sd.e_window, 0) = 0 then 1.0
                else least(greatest(coalesce(dr.c_window, 0)::numeric / sd.e_window, 0.2), 1.2) end as ratio
    from pl
    left join sd on sd.placement_id = pl.id
    left join dr on dr.placement_id = pl.id
  ),
  f as (
    select b.*, fc.forecast, ck.score
    from b
    cross join t
    -- §8.4 forecast finish: walk future scheduled days, then the latest pattern past the planned
    -- end for at most 400 days (closure days skipped); null when the target is out of reach.
    left join lateral (
      select case
        when b.remaining = 0 then coalesce((b.target_reached_at at time zone 'Australia/Darwin')::date, t.today)
        else (
          select u.d from (
            select x.d, sum(x.m) over (order by x.d) as acc
            from (
              select d.work_date as d, d.planned_minutes * b.ratio as m
              from public.daymark_scheduled_days d
              where d.placement_id = b.id and d.status = 'scheduled'
                and (d.work_date > t.today or (d.work_date = t.today and not t.today_closed and not b.shift_today))
              union all
              select g.d::date, pd.planned * b.ratio
              from generate_series(greatest(b.planned_end_date, t.today) + 1,
                                   greatest(b.planned_end_date, t.today) + 400, interval '1 day') g (d)
              join (
                select w.weekday,
                       (extract(epoch from w.end_time - w.start_time) / 60)::integer
                       - case when w.end_time - w.start_time > interval '300 minutes' then 30 else 0 end as planned  -- R5.2.4
                from public.daymark_pattern_days w
                where w.pattern_version_id = (
                  select v.id from public.daymark_pattern_versions v
                  where v.placement_id = b.id order by v.effective_from desc limit 1)
              ) pd on pd.weekday = extract(isodow from g.d)
              where b.future_sched * b.ratio < b.remaining                         -- only when the schedule falls short
                and not exists (
                  select 1 from public.daymark_closure_days c
                  where c.day = g.d::date and (c.site_id is null or c.site_id = b.site_id))
            ) x
          ) u
          where u.acc >= b.remaining
          order by u.d
          limit 1)
      end as forecast
    ) fc on true
    left join lateral (
      select c.reliability + c.quality + c.communication as score
      from public.daymark_checkins c
      where c.placement_id = b.id
      order by c.week_start desc
      limit 1
    ) ck on true
  )
  select f.id, f.intern_id, f.display_name, f.supervisor_id, f.status, f.start_date, f.planned_end_date,
         f.target_minutes, f.target_reached_at,
         f.expected, f.counted_to_date,
         f.expected - f.counted_to_date,                                            -- R5.6.3 owed (negative = ahead)
         f.counted_total, f.remaining, f.future_sched,
         f.remaining - f.future_sched,                                              -- schedule gap
         private.week_no(t.today, f.start_date),                                    -- R5.7.3
         private.week_no(f.planned_end_date, f.start_date),
         t.fs, t.fs + 13,
         f.no_shows,
         round(f.ratio, 3),
         f.forecast,
         f.forecast - f.planned_end_date,                                           -- A3 calendar days
         case when f.forecast is null then 'red'                                    -- §7.8 pace
              when f.forecast - f.planned_end_date <= 0 then 'green'
              when f.forecast - f.planned_end_date <= 5 then 'amber'
              else 'red' end,
         round(f.score / 3.0, 2),
         case when f.status in ('active', 'extended') then array_remove(array[      -- §8.8 / R5.10
           case when f.remaining - f.future_sched > 240 then 'schedule_gap' end,
           case when f.expected - f.counted_to_date > 240 then 'owed' end,
           case when f.no_shows >= 2 then 'no_shows' end,
           case when f.forecast is null or f.forecast - f.planned_end_date > 5 then 'forecast_late' end,
           case when f.score < 9 then 'low_checkin' end                             -- average < 3.0, exact
         ], null) else '{}'::text[] end
  from f
  cross join t
  order by f.display_name, f.id;
$$;

create or replace function private.placement_progress(placement uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(r) from private.progress_rows(array[placement]) r;
$$;

-- The caller's own interns with a live placement.
create or replace function private.progress_for_supervisor()
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(r)
  from private.progress_rows(array(
    select p.id from public.daymark_placements p
    where p.supervisor_id = (select auth.uid()) and p.status in ('active', 'extended', 'target_reached'))) r
  order by r.intern_name, r.placement_id;
$$;

create or replace function private.progress_all()
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select to_jsonb(r)
    from private.progress_rows(array(select p.id from public.daymark_placements p)) r
    order by r.intern_name, r.placement_id;
end;
$$;

create or replace function public.placement_progress(placement uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.placement_progress(placement); $$;

create or replace function public.progress_for_supervisor()
returns setof jsonb language sql stable security invoker set search_path = ''
as $$ select private.progress_for_supervisor(); $$;

create or replace function public.progress_all()
returns setof jsonb language sql stable security invoker set search_path = ''
as $$ select private.progress_all(); $$;

create view public.daymark_v_placement_progress with (security_invoker = true) as
select r.* from private.progress_rows(array(select p.id from public.daymark_placements p)) r;

revoke all on table public.daymark_v_placement_progress from public, anon, authenticated;
grant select on table public.daymark_v_placement_progress to authenticated, service_role;

-- progress_rows filters by can_view_placement itself, so the invoker view can call it.
revoke all on function private.progress_rows(uuid[]) from public, anon;
revoke all on function private.placement_progress(uuid) from public, anon;
revoke all on function private.progress_for_supervisor() from public, anon;
revoke all on function private.progress_all() from public, anon;
revoke all on function public.placement_progress(uuid) from public, anon;
revoke all on function public.progress_for_supervisor() from public, anon;
revoke all on function public.progress_all() from public, anon;
grant execute on function private.progress_rows(uuid[]) to authenticated;
grant execute on function private.placement_progress(uuid) to authenticated;
grant execute on function private.progress_for_supervisor() to authenticated;
grant execute on function private.progress_all() to authenticated;
grant execute on function public.placement_progress(uuid) to authenticated;
grant execute on function public.progress_for_supervisor() to authenticated;
grant execute on function public.progress_all() to authenticated;

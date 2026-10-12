-- Open-ended placements (Dilip, 13 Oct; D47). The start date is required, the end date is not: an
-- intern whose leave date isn't known yet has planned_end_date null. Their roster runs 12 weeks
-- ahead and rolls forward a day at a time (job_roll_rosters, run from job_reminders). The hours target
-- is optional too: target_minutes null means no target. With no end date there is no forecast, no pace
-- and no "ends in"; with no target there is no forecast, no pace and no target_reached. When the
-- intern leaves, Extend sets the end date (days past it are cancelled), or ending the placement sets
-- it to the day it ends. Retention still counts from ended_on.
--
-- Functions below are copied from their latest definition, changing only what null needs. Readers of
-- planned_end_date that were already null-safe stay as they are: comparisons with null are not true,
-- so set_pattern, set_pattern_range, check_request, check_staff_day, clock_block_reason and
-- save_checkin don't block on a missing end date, and job_day_close never marks target_reached
-- without a target. regenerate and generate_days go through pattern_candidates, which now stops at
-- the roster horizon.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.daymark_placements
  alter column planned_end_date drop not null,
  alter column original_end_date drop not null,
  alter column target_minutes drop not null,   -- the 60–120,000 check passes null
  drop constraint daymark_placements_dates_check,
  add constraint daymark_placements_dates_check check (planned_end_date is null or planned_end_date >= start_date);

-- ---------------------------------------------------------------------------
-- 2. The roster horizon: the planned end date, or 12 weeks from today when there isn't one.
-- ---------------------------------------------------------------------------
create or replace function private.roster_horizon(pl public.daymark_placements)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pl.planned_end_date, private.darwin_today() + 84);
$$;

-- The last day the pattern has been rolled out to (any status, so cancelled days aren't re-added).
create or replace function private.roster_rolled_to(placement uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(s.work_date), p.start_date - 1)
  from public.daymark_placements p
  left join public.daymark_scheduled_days s on s.placement_id = p.id and s.source = 'pattern'
  where p.id = placement
  group by p.start_date;
$$;

-- ---------------------------------------------------------------------------
-- 3. Redefined readers
-- ---------------------------------------------------------------------------
create or replace function private.pattern_candidates(placement uuid, from_date date, to_date date)
returns table (work_date date, start_time time, end_time time)
language sql
stable
security definer
set search_path = ''
as $$
  select g.d::date, pd.start_time, pd.end_time
  from public.daymark_placements p
  cross join generate_series(greatest(p.start_date, from_date), least(private.roster_horizon(p), to_date), interval '1 day') g(d)
  cross join lateral (
    select v.id from public.daymark_pattern_versions v
    where v.placement_id = p.id and v.effective_from <= g.d::date
    order by v.effective_from desc
    limit 1
  ) v
  join public.daymark_pattern_days pd on pd.pattern_version_id = v.id and pd.weekday = extract(isodow from g.d)
  where p.id = placement
    and not exists (
      select 1 from public.daymark_closure_days c
      where c.day = g.d::date and (c.site_id is null or c.site_id = p.site_id)
    )
    and not exists (
      select 1 from public.daymark_scheduled_days s
      where s.placement_id = p.id and s.work_date = g.d::date and s.status in ('scheduled', 'leave')
    )
  order by 1;
$$;

create or replace function private.capacity_preview(site uuid, start_date date, end_date date, days jsonb, exclude_placement uuid)
returns table (work_date date, headcount integer, with_new integer, status text, closure text)
language sql
stable
security definer
set search_path = ''
as $$
  with pattern as (select * from private.parse_pattern(days)),
  dates as (
    select g.d::date as work_date
    from generate_series(start_date, least(coalesce(end_date, private.darwin_today() + 84), start_date + 400), interval '1 day') g(d)
    where extract(isodow from g.d)::smallint in (select weekday from pattern)
  )
  select d.work_date,
         coalesce(h.n, 0)::integer,
         case when c.name is null then coalesce(h.n, 0)::integer + 1 else coalesce(h.n, 0)::integer end,
         case when c.name is not null then 'closed'
              when coalesce(h.n, 0) + 1 > s.hard_capacity then 'over'
              when coalesce(h.n, 0) + 1 > s.standard_capacity then 'extra'
              else 'ok' end,
         c.name
  from dates d
  cross join public.daymark_sites s
  left join lateral (
    select count(*) as n from public.daymark_scheduled_days x
    where x.site_id = site and x.work_date = d.work_date and x.status = 'scheduled'
      and x.placement_id is distinct from exclude_placement
  ) h on true
  left join lateral (
    select c.name from public.daymark_closure_days c
    where c.day = d.work_date and (c.site_id is null or c.site_id = site) limit 1
  ) c on true
  where s.id = site and (private.is_admin() or exists (
    select 1 from public.daymark_profiles me where me.id = (select auth.uid()) and me.is_supervisor and me.active))
  order by d.work_date;
$$;

create or replace function private.save_placement(p jsonb, allow_extra boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  pl public.daymark_placements%rowtype;
  before_row jsonb;
  pid uuid := nullif(p ->> 'id', '')::uuid;
  v_intern uuid := (p ->> 'intern_id')::uuid;
  v_supervisor uuid := (p ->> 'supervisor_id')::uuid;
  v_start date := nullif(p ->> 'start_date', '')::date;
  v_end date := nullif(p ->> 'planned_end_date', '')::date;              -- null: no end date yet (D47)
  v_target integer := nullif(p ->> 'target_minutes', '')::integer;       -- null: no target (D47)
  v_break integer := nullif(p ->> 'break_minutes', '')::integer;
  v_site uuid := coalesce(nullif(p ->> 'site_id', '')::uuid,
                          (select s.id from public.daymark_sites s where s.active order by s.created_at limit 1));
  ver uuid;
  started boolean;
begin
  perform private.require_admin();

  if pid is null and not exists (select 1 from public.daymark_profiles x where x.id = v_intern and x.is_intern and x.active) then
    raise exception 'Pick an active intern.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.daymark_profiles x where x.id = v_supervisor and x.is_supervisor and x.active)
     or v_supervisor = coalesce(v_intern, (select q.intern_id from public.daymark_placements q where q.id = pid)) then
    raise exception 'Pick an active supervisor who isn''t the intern.' using errcode = '22023';
  end if;
  if v_start is null then
    raise exception 'Pick a start date.' using errcode = '22023';
  end if;
  if v_end < v_start then
    raise exception 'The planned end date must be on or after the start date.' using errcode = '22023';
  end if;
  if v_target not between 60 and 120000 then
    raise exception 'Set target hours between 1 and 2,000.' using errcode = '22023';
  end if;
  if nullif(btrim(p ->> 'university'), '') is null or nullif(btrim(p ->> 'course'), '') is null then
    raise exception 'Enter the university and the course.' using errcode = '22023';
  end if;
  if v_break is not null and v_break not between 0 and 120 then
    raise exception 'Set the break between 0 and 120 minutes.' using errcode = '22023';
  end if;

  if pid is null then
    begin
      insert into public.daymark_placements (
        intern_id, supervisor_id, cohort_id, site_id, university, course, uni_coordinator_name,
        uni_coordinator_email, start_date, planned_end_date, original_end_date, target_minutes, break_minutes,
        created_by
      ) values (
        v_intern, v_supervisor, nullif(p ->> 'cohort_id', '')::uuid, v_site, btrim(p ->> 'university'),
        btrim(p ->> 'course'), nullif(btrim(p ->> 'uni_coordinator_name'), ''),
        nullif(lower(btrim(p ->> 'uni_coordinator_email')), ''), v_start, v_end, v_end, v_target,
        coalesce(v_break, (select s.break_minutes from public.daymark_settings s where s.id = 1)), me
      ) returning * into pl;
    exception when unique_violation then
      raise exception 'This intern already has a live placement.' using errcode = '23505';
    end;

    insert into public.daymark_pattern_versions (placement_id, effective_from, created_by)
    values (pl.id, v_start, me) returning id into ver;
    insert into public.daymark_pattern_days (pattern_version_id, weekday, start_time, end_time)
    select ver, x.weekday, x.start_time, x.end_time from private.parse_pattern(p -> 'pattern') x;

    perform private.regenerate(pl.id, v_start, allow_extra);
    perform private.audit('create_placement', 'daymark_placements', pl.id::text, null, to_jsonb(pl));
    perform private.notify(v_intern, 'placement', 'Your placement is set up',
      'Your schedule is ready. Check it under Schedule.', '/clock/schedule');
    return pl.id;
  end if;

  select * into pl from public.daymark_placements where id = pid for update;
  if not found then
    raise exception 'That placement doesn''t exist.' using errcode = '22023';
  end if;
  before_row := to_jsonb(pl);
  started := pl.start_date <= private.darwin_today()
             or exists (select 1 from public.daymark_punches x where x.placement_id = pid);
  if started and (v_start <> pl.start_date or v_end is distinct from pl.planned_end_date) then
    raise exception 'This placement has started. Use Extend to change its end date.' using errcode = '22023';
  end if;

  update public.daymark_placements q
  set supervisor_id = v_supervisor,
      cohort_id = nullif(p ->> 'cohort_id', '')::uuid,
      university = btrim(p ->> 'university'),
      course = btrim(p ->> 'course'),
      uni_coordinator_name = nullif(btrim(p ->> 'uni_coordinator_name'), ''),
      uni_coordinator_email = nullif(lower(btrim(p ->> 'uni_coordinator_email')), ''),
      target_minutes = v_target,
      break_minutes = coalesce(v_break, q.break_minutes),
      start_date = v_start,
      planned_end_date = v_end,
      original_end_date = case when started then q.original_end_date else v_end end
  where q.id = pid
  returning * into pl;

  if not started and (v_start <> (before_row ->> 'start_date')::date
                      or v_end is distinct from (before_row ->> 'planned_end_date')::date) then
    update public.daymark_pattern_versions v set effective_from = v_start
    where v.placement_id = pid
      and v.effective_from = (select min(x.effective_from) from public.daymark_pattern_versions x where x.placement_id = pid);
    update public.daymark_scheduled_days s set status = 'cancelled', updated_at = private.clock_now()
    where s.placement_id = pid and s.status = 'scheduled' and s.source = 'pattern';
    perform private.regenerate(pid, v_start, allow_extra);
  end if;

  perform private.audit('update_placement', 'daymark_placements', pid::text, before_row, to_jsonb(pl));
  return pid;
end;
$$;

create or replace function private.extend_placement(placement uuid, new_end date, note text, allow_extra boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype := private.require_placement_manager(placement);
  before_row jsonb := to_jsonb(pl);
  old_end date := pl.planned_end_date;
  today date := private.darwin_today();
  rolled date;
begin
  if pl.status not in ('active', 'extended', 'target_reached') then
    raise exception 'This placement has already ended.' using errcode = '22023';
  end if;

  -- D47 an open-ended placement gets its end date: days past it are cancelled (as ending does),
  -- days up to it beyond the rolling roster are added. The status stays as it is.
  if old_end is null then
    if new_end is null or new_end < greatest(pl.start_date, today) then
      raise exception 'Pick an end date from % on.', private.fmt_day(greatest(pl.start_date, today)) using errcode = '22023';
    end if;
    if allow_extra and not private.is_admin() then
      raise exception 'Only an admin can approve an extra spot.' using errcode = '42501';
    end if;
    rolled := private.roster_rolled_to(placement);
    update public.daymark_placements
    set planned_end_date = new_end, original_end_date = coalesce(original_end_date, new_end)
    where id = placement
    returning * into pl;
    update public.daymark_scheduled_days s set status = 'cancelled', updated_at = private.clock_now()
    where s.placement_id = placement and s.work_date > new_end and s.status in ('scheduled', 'leave');
    if new_end > rolled then
      perform private.regenerate(placement, greatest(rolled + 1, today, pl.start_date), allow_extra);
    end if;
    perform private.audit('set_end_date', 'daymark_placements', placement::text, before_row,
      to_jsonb(pl) || jsonb_build_object('note', note));
    perform private.notify(pl.intern_id, 'extended', 'Your placement has an end date',
      'Your placement ends on ' || private.fmt_day(new_end) || '. Your schedule is updated.', '/clock/schedule');
    return;
  end if;
  if new_end is null or new_end <= old_end then
    raise exception 'Pick a new end date after %.', private.fmt_day(old_end) using errcode = '22023';
  end if;
  if allow_extra and not private.is_admin() then
    raise exception 'Only an admin can approve an extra spot.' using errcode = '42501';
  end if;

  update public.daymark_placements set planned_end_date = new_end, status = 'extended' where id = placement
  returning * into pl;
  perform private.regenerate(placement, greatest(old_end + 1, private.darwin_today()), allow_extra);
  perform private.audit('extend_placement', 'daymark_placements', placement::text, before_row,
    to_jsonb(pl) || jsonb_build_object('note', note));
  perform private.notify(pl.intern_id, 'extended', 'Your placement is extended',
    'Your planned end date is now ' || private.fmt_day(new_end) || '. New days are on your schedule.', '/clock/schedule');
end;
$$;

create or replace function private.end_placement(placement uuid, new_status text, note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype := private.require_placement_manager(placement);
  before_row jsonb := to_jsonb(pl);
  today date := private.darwin_today();
begin
  if pl.status not in ('active', 'extended', 'target_reached') then
    raise exception 'This placement has already ended.' using errcode = '22023';
  end if;

  -- D47 an open-ended placement takes its end date from the day it ends.
  update public.daymark_placements
  set status = new_status, ended_on = today,
      planned_end_date = coalesce(planned_end_date, greatest(today, start_date)),
      original_end_date = coalesce(original_end_date, greatest(today, start_date))
  where id = placement
  returning * into pl;
  update public.daymark_scheduled_days s set status = 'cancelled', updated_at = private.clock_now()
  where s.placement_id = placement and s.work_date > today and s.status in ('scheduled', 'leave');

  perform private.audit(case new_status when 'completed' then 'confirm_completion' else 'withdraw_placement' end,
    'daymark_placements', placement::text, before_row, to_jsonb(pl) || jsonb_build_object('note', note));
  perform private.send_retention_reminder(pl, 0);
end;
$$;

create or replace function private.import_placements(rows jsonb, temp_password text, dry_run boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  i integer := 0;
  results jsonb := '[]';
  failed boolean := false;
  person jsonb;
  sup uuid;
  cohort uuid;
  hours numeric;
begin
  perform private.require_admin();
  perform private.check_password(temp_password);
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) = 0 then
    raise exception 'The file has no rows to import.' using errcode = '22023';
  end if;
  if jsonb_array_length(rows) > 200 then
    raise exception 'Import at most 200 rows at a time.' using errcode = '22023';
  end if;

  begin
    for r in select * from jsonb_array_elements(rows) loop
      begin
        select p.id into sup from public.daymark_profiles p
        join auth.users u on u.id = p.id
        where lower(u.email) = lower(btrim(r ->> 'supervisor_email')) and p.is_supervisor and p.active;
        if sup is null then
          raise exception 'No active supervisor uses %.', coalesce(nullif(btrim(r ->> 'supervisor_email'), ''), 'that email')
            using errcode = '22023';
        end if;

        hours := nullif(btrim(r ->> 'target_hours'), '')::numeric;
        if hours * 60 <> round(hours * 60) then                                     -- blank: no target (D47)
          raise exception 'Target hours must be a number of whole minutes, like 120 or 80.5.' using errcode = '22023';
        end if;

        cohort := null;
        if nullif(btrim(r ->> 'cohort'), '') is not null then
          select c.id into cohort from public.daymark_cohorts c where lower(c.name) = lower(btrim(r ->> 'cohort'));
          if cohort is null then
            insert into public.daymark_cohorts (name) values (btrim(r ->> 'cohort')) returning id into cohort;
          end if;
        end if;

        person := private.create_person(r ->> 'display_name', r ->> 'email', temp_password, true, false, false);
        perform private.save_placement(jsonb_build_object(
          'intern_id', person ->> 'id', 'supervisor_id', sup, 'cohort_id', cohort,
          'university', r ->> 'university', 'course', r ->> 'course',
          'start_date', r ->> 'start_date', 'planned_end_date', nullif(btrim(r ->> 'planned_end_date'), ''),
          'target_minutes', (hours * 60)::integer,
          'pattern', private.parse_pattern_text(r ->> 'pattern')
        ), false);
        results := results || jsonb_build_object('row', i + 1, 'email', r ->> 'email', 'ok', true);
      exception when others then
        failed := true;
        results := results || jsonb_build_object('row', i + 1, 'email', r ->> 'email', 'ok', false,
          'error', case when sqlstate in ('22007', '22008') then 'Use dates like 2026-10-12.'
                        when sqlstate = '22P02' then 'A number or date in this row is not valid.'
                        else sqlerrm end);
      end;
      i := i + 1;
    end loop;

    if dry_run or failed then
      raise exception using errcode = 'DGK01';   -- undo everything above, keep the verdicts
    end if;
  exception when sqlstate 'DGK01' then
    null;
  end;

  if not dry_run and not failed then
    perform private.audit('import_placements', 'daymark_placements', null, null,
      jsonb_build_object('rows', i));   -- never the password
  end if;
  return jsonb_build_object('ok', not failed, 'dry_run', dry_run,
    'imported', case when dry_run or failed then 0 else i end, 'results', results);
end;
$$;

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
           -- greatest() skips nulls, so no target needs its own null (D47)
           case when pl.target_minutes is not null
                then greatest(0, pl.target_minutes - coalesce(dr.counted_total, 0))::integer end as remaining,
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
        when b.planned_end_date is null or b.target_minutes is null then null        -- D47 open-ended or no target
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
         case when f.planned_end_date is null or f.target_minutes is null then null -- D47 no pace
              when f.forecast is null then 'red'                                    -- §7.8 pace
              when f.forecast - f.planned_end_date <= 0 then 'green'
              when f.forecast - f.planned_end_date <= 5 then 'amber'
              else 'red' end,
         round(f.score / 3.0, 2),
         case when f.status in ('active', 'extended') then array_remove(array[      -- §8.8 / R5.10
           case when f.planned_end_date is not null and f.remaining - f.future_sched > 240 then 'schedule_gap' end,
           case when f.expected - f.counted_to_date > 240 then 'owed' end,
           case when f.no_shows >= 2 then 'no_shows' end,
           case when f.planned_end_date is not null and f.target_minutes is not null
                and (f.forecast is null or f.forecast - f.planned_end_date > 5) then 'forecast_late' end,
           case when f.score < 9 then 'low_checkin' end                             -- average < 3.0, exact
         ], null) else '{}'::text[] end
  from f
  cross join t
  order by f.display_name, f.id;
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
    'pct_on_pace', (select private.pct(count(*) filter (where x.pace = 'green'), count(x.pace)) from private.progress_rows(live) x),
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

create or replace function private.catch_up_plan(placement uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype;
  site public.daymark_sites%rowtype;
  owed integer;
  need integer;
  earliest timestamptz := private.clock_now()
    + make_interval(hours => (select s.notice_hours from public.daymark_settings s where s.id = 1));
  day record;
  len integer;
  best integer;
  best_start time;
  best_end time;
  try_len integer;
  gain integer;
  a jsonb := '[]';
  a_cover integer := 0;
  b jsonb := '[]';
  b_cover integer := 0;
  usual_start time;
  usual_end time;
  usual_planned integer;
  d date;
begin
  if not private.can_view_placement(placement) then
    raise exception 'You don''t have access to this placement.' using errcode = '42501';
  end if;
  select * into pl from public.daymark_placements where id = placement;
  select * into site from public.daymark_sites where id = pl.site_id;
  select r.owed into owed from private.progress_rows(array[placement]) r;
  owed := coalesce(owed, 0);

  if owed <= 0 or pl.status not in ('active', 'extended') then
    return jsonb_build_object('owed_minutes', owed,
      'a', jsonb_build_object('requests', '[]'::jsonb, 'covers_minutes', 0, 'fully_covers', owed <= 0),
      'b', jsonb_build_object('requests', '[]'::jsonb, 'covers_minutes', 0, 'fully_covers', owed <= 0));
  end if;

  -- Option A: lengthen upcoming scheduled days, end later first, then start earlier.
  need := owed;
  for day in
    select s.* from public.daymark_scheduled_days s
    where s.placement_id = placement and s.status = 'scheduled'
      and s.work_date <= private.roster_horizon(pl)
      and private.darwin_at(s.work_date, s.start_time) >= earliest
      and not exists (select 1 from public.daymark_requests r
                      where r.intern_id = pl.intern_id and r.status in ('pending_supervisor', 'pending_admin')
                        and s.work_date = any (r.dates))
    order by s.work_date
  loop
    exit when need <= 0;
    len := (extract(epoch from day.end_time - day.start_time) / 60)::integer;
    best := null;
    try_len := len + 15;
    while try_len <= 600 loop
      if day.start_time + make_interval(mins => try_len) <= site.window_end then
        best_start := day.start_time;
        best_end := day.start_time + make_interval(mins => try_len);
      elsif day.end_time - make_interval(mins => try_len) >= site.window_start then
        best_start := day.end_time - make_interval(mins => try_len);
        best_end := day.end_time;
      else
        exit;
      end if;
      best := try_len;
      gain := private.planned_length(try_len) - private.planned_length(len);
      exit when gain >= need;
      try_len := try_len + 15;
    end loop;
    if best is not null then
      gain := private.planned_length(best) - private.planned_length(len);
      if gain > 0 then
        a := a || jsonb_build_object(
          'type', 'shift_change',
          'payload', jsonb_build_object('scheduled_day_id', day.id, 'start', to_char(best_start, 'HH24:MI'),
                                        'end', to_char(best_end, 'HH24:MI')),
          'gain_minutes', gain,
          'label', private.fmt_day(day.work_date) || ': ' || private.fmt_clock(best_start) || '–' || private.fmt_clock(best_end)
            || ' (+' || private.fmt_duration(gain) || ')');
        a_cover := a_cover + gain;
        need := need - gain;
      end if;
    end if;
  end loop;

  -- Option B: extra days at the usual (most common) times on days under standard capacity.
  select x.start_time, x.end_time into usual_start, usual_end
  from public.daymark_pattern_days x
  where x.pattern_version_id = (
    select v.id from public.daymark_pattern_versions v
    where v.placement_id = placement and v.effective_from <= private.darwin_today()
    order by v.effective_from desc limit 1)
  group by x.start_time, x.end_time
  order by count(*) desc, x.start_time
  limit 1;

  need := owed;
  if usual_start is not null then
    usual_planned := private.planned_length((extract(epoch from usual_end - usual_start) / 60)::integer);
    for d in
      select g.d::date
      from generate_series((earliest at time zone 'Australia/Darwin')::date, private.roster_horizon(pl), interval '1 day') g(d)
      where extract(isodow from g.d) <= 5
        and private.darwin_at(g.d::date, usual_start) >= earliest
        and not exists (select 1 from public.daymark_closure_days c
                        where c.day = g.d::date and (c.site_id is null or c.site_id = pl.site_id))
        and not exists (select 1 from public.daymark_scheduled_days s
                        where s.placement_id = placement and s.work_date = g.d::date and s.status in ('scheduled', 'leave'))
        and not exists (select 1 from public.daymark_requests r
                        where r.intern_id = pl.intern_id and r.status in ('pending_supervisor', 'pending_admin')
                          and g.d::date = any (r.dates))
        and (select count(*) from public.daymark_scheduled_days s
             where s.site_id = pl.site_id and s.work_date = g.d::date and s.status = 'scheduled') < site.standard_capacity
      order by 1
    loop
      exit when need <= 0;
      b := b || jsonb_build_object(
        'type', 'extra_day',
        'payload', jsonb_build_object('date', d, 'start', to_char(usual_start, 'HH24:MI'), 'end', to_char(usual_end, 'HH24:MI')),
        'gain_minutes', usual_planned,
        'label', private.fmt_day(d) || ': ' || private.fmt_clock(usual_start) || '–' || private.fmt_clock(usual_end)
          || ' (+' || private.fmt_duration(usual_planned) || ')');
      b_cover := b_cover + usual_planned;
      need := need - usual_planned;
    end loop;
  end if;

  return jsonb_build_object('owed_minutes', owed,
    'a', jsonb_build_object('requests', a, 'covers_minutes', a_cover, 'fully_covers', a_cover >= owed),
    'b', jsonb_build_object('requests', b, 'covers_minutes', b_cover, 'fully_covers', b_cover >= owed));
end;
$$;

create or replace function private.catch_up_slots(placement uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype;
  site public.daymark_sites%rowtype;
  owed integer;
  earliest timestamptz := private.clock_now()
    + make_interval(hours => (select s.notice_hours from public.daymark_settings s where s.id = 1));
  usual_start time;
  usual_end time;
  days jsonb;
begin
  if not private.can_view_placement(placement) then
    raise exception 'You don''t have access to this placement.' using errcode = '42501';
  end if;
  select * into pl from public.daymark_placements where id = placement;
  select * into site from public.daymark_sites where id = pl.site_id;
  select r.owed into owed from private.progress_rows(array[placement]) r;

  -- The intern's usual (most common) times; 9–5 when the pattern is empty.
  select x.start_time, x.end_time into usual_start, usual_end
  from public.daymark_pattern_days x
  where x.pattern_version_id = (
    select v.id from public.daymark_pattern_versions v
    where v.placement_id = placement and v.effective_from <= private.darwin_today()
    order by v.effective_from desc limit 1)
  group by x.start_time, x.end_time
  order by count(*) desc, x.start_time
  limit 1;
  usual_start := coalesce(usual_start, '09:00');
  usual_end := coalesce(usual_end, '17:00');

  -- Office days (Mon–Fri, not closed) inside the placement, after the notice window, that the
  -- intern isn't rostered, on leave or already asking for, with a spot free under standard capacity.
  if pl.status in ('active', 'extended') then
    select coalesce(jsonb_agg(jsonb_build_object('date', d.day, 'free', site.standard_capacity - d.booked) order by d.day),
                    '[]'::jsonb)
    into days
    from (
      select g.d::date as day,
             (select count(*) from public.daymark_scheduled_days s
              where s.site_id = pl.site_id and s.work_date = g.d::date and s.status = 'scheduled')::integer as booked
      from generate_series(greatest((earliest at time zone 'Australia/Darwin')::date, pl.start_date),
                           private.roster_horizon(pl), interval '1 day') g(d)
      where extract(isodow from g.d) <= 5
        and private.darwin_at(g.d::date, usual_start) >= earliest
        and not exists (select 1 from public.daymark_closure_days c
                        where c.day = g.d::date and (c.site_id is null or c.site_id = pl.site_id))
        and not exists (select 1 from public.daymark_scheduled_days s
                        where s.placement_id = placement and s.work_date = g.d::date and s.status in ('scheduled', 'leave'))
        and not exists (select 1 from public.daymark_requests r
                        where r.intern_id = pl.intern_id and r.status in ('pending_supervisor', 'pending_admin')
                          and g.d::date = any (r.dates))
      limit 60
    ) d
    where d.booked < site.standard_capacity;
  end if;

  return jsonb_build_object(
    'owed_minutes', greatest(coalesce(owed, 0), 0),
    'break_minutes', pl.break_minutes,
    'usual', jsonb_build_object('start', to_char(usual_start, 'HH24:MI'), 'end', to_char(usual_end, 'HH24:MI')),
    'window', jsonb_build_object('start', to_char(site.window_start, 'HH24:MI'), 'end', to_char(site.window_end, 'HH24:MI')),
    'days', coalesce(days, '[]'::jsonb));
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. Rolling roster: open-ended placements keep 12 weeks of days. Each run adds the days past the
-- last one rolled out, up to today + 84, so a repeat run (job_reminders is every 5 minutes) finds
-- nothing to add. A day that is full is skipped and the supervisor is told once; it never takes an
-- extra spot on its own.
-- ---------------------------------------------------------------------------
create or replace function private.job_roll_rosters()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  horizon date := private.darwin_today() + 84;
  pl record;
  c record;
  n integer := 0;
  alert_link text;
begin
  for pl in
    select p.id, p.site_id, p.supervisor_id, pr.display_name, private.roster_rolled_to(p.id) as rolled
    from public.daymark_placements p
    join public.daymark_profiles pr on pr.id = p.intern_id
    where p.planned_end_date is null and p.status in ('active', 'extended', 'target_reached')
      and private.roster_rolled_to(p.id) < horizon
  loop
    for c in
      select * from private.pattern_candidates(pl.id, greatest(pl.rolled + 1, private.darwin_today()), horizon)
    loop
      begin
        insert into public.daymark_scheduled_days (placement_id, site_id, work_date, start_time, end_time, source)
        values (pl.id, pl.site_id, c.work_date, c.start_time, c.end_time, 'pattern');
        n := n + 1;
      exception when sqlstate 'P0001' then                                  -- capacity_guard: the day is full
        alert_link := '/supervisor/intern?id=' || pl.id || '&day=' || c.work_date;
        if not exists (select 1 from public.daymark_notifications x
                       where x.person_id = pl.supervisor_id and x.kind = 'schedule' and x.link = alert_link) then
          perform private.notify(pl.supervisor_id, 'schedule', pl.display_name || '''s day on ' || private.fmt_day(c.work_date) || ' is full',
            'Their usual day couldn''t be added to the roster. Add another day for them, or an extra spot.', alert_link);
        end if;
      end;
    end loop;
  end loop;
  return n;
end;
$$;

create or replace function private.job_reminders()
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.job_day_reminders() + private.job_evening_reminders() + private.job_digest()
         + private.job_signoff_reminders() + private.job_tasks() + private.job_roll_rosters();
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants: the new helpers and the job are internal only.
-- ---------------------------------------------------------------------------
revoke all on function private.roster_horizon(public.daymark_placements) from public, anon, authenticated;
revoke all on function private.roster_rolled_to(uuid) from public, anon, authenticated;
revoke all on function private.job_roll_rosters() from public, anon, authenticated;
revoke all on function private.job_reminders() from public, anon, authenticated;

-- Phase 3: shifts (§8.1) and the day-result cache (§8.2, R5.4). Integer minutes only.

-- ---------------------------------------------------------------------------
-- Tables (§10)
-- ---------------------------------------------------------------------------

-- Derived from punches by private.rebuild_shifts only; nobody writes it directly.
create table public.daymark_shifts (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.daymark_placements (id) on delete cascade,
  work_date date not null,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,                     -- null = currently open
  in_punch_id uuid not null references public.daymark_punches (id) on delete cascade,
  out_punch_id uuid references public.daymark_punches (id) on delete cascade,
  auto_closed boolean not null default false,  -- D3: closed at its own clock-in, counts 0
  unscheduled boolean not null default false,  -- R5.1.8: no scheduled day on the date
  unverified boolean not null default false,   -- review §2.7: supervisor path, not yet confirmed, counts 0
  constraint daymark_shifts_order_check check (clock_out_at is null or clock_out_at >= clock_in_at)
);

create index daymark_shifts_placement_idx on public.daymark_shifts (placement_id, work_date, clock_in_at);
create index daymark_shifts_in_punch_idx on public.daymark_shifts (in_punch_id);
create index daymark_shifts_out_punch_idx on public.daymark_shifts (out_punch_id);
create index daymark_shifts_open_idx on public.daymark_shifts (work_date) where clock_out_at is null;

-- One row per placement and date that has a live day (scheduled/leave) or a shift.
create table public.daymark_day_results (
  placement_id uuid not null references public.daymark_placements (id) on delete cascade,
  work_date date not null,
  raw integer not null,            -- R5.4.1
  break integer not null,          -- R5.4.2
  worked integer not null,         -- R5.4.3
  countable integer not null,      -- R5.4.4
  over_max integer not null,       -- R5.4.4
  scheduled integer not null,      -- R5.4.5
  base integer not null,           -- R5.4.6
  overtime integer not null,       -- R5.4.7
  approved_ot integer not null,    -- R5.4.8
  counted integer not null,        -- R5.4.9
  short integer,                   -- R5.4.10, null until the day is closed
  late boolean not null,           -- R5.4.12
  left_early boolean not null,     -- R5.4.13
  no_show boolean not null,        -- R5.5.2
  auto_closed boolean not null,    -- D3
  unscheduled boolean not null,
  unverified boolean not null,     -- review §2.7
  closed boolean not null,
  computed_at timestamptz not null,
  primary key (placement_id, work_date)
);

create index daymark_day_results_date_idx on public.daymark_day_results (work_date);

alter table public.daymark_shifts enable row level security;
alter table public.daymark_day_results enable row level security;

create policy "Shifts follow the placement" on public.daymark_shifts
  for select to authenticated using ((select private.can_view_placement(placement_id)));
create policy "Day results follow the placement" on public.daymark_day_results
  for select to authenticated using ((select private.can_view_placement(placement_id)));

revoke all on table public.daymark_shifts, public.daymark_day_results from public, anon, authenticated;
grant select on table public.daymark_shifts, public.daymark_day_results to authenticated;
grant all on table public.daymark_shifts, public.daymark_day_results to service_role;

-- ---------------------------------------------------------------------------
-- §8.2 compute_day: the single source of truth for R5.4, pure (reads only).
-- ---------------------------------------------------------------------------

create or replace function private.compute_day(placement uuid, work_date date)
returns public.daymark_day_results
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.daymark_day_results;
  st public.daymark_settings%rowtype;
  sd public.daymark_scheduled_days%rowtype;
  n_shifts integer;
  first_in timestamptz;
  last_out timestamptz;
  last_open boolean;
  last_auto boolean;
  raw_seconds numeric;
  gap_break boolean;
  approved integer;
begin
  select * into st from public.daymark_settings s where s.id = 1;
  select * into sd from public.daymark_scheduled_days d
  where d.placement_id = placement and d.work_date = compute_day.work_date and d.status = 'scheduled';

  -- Presence uses every shift (open, unverified or auto-closed); minutes use only counting shifts:
  -- closed, verified and not auto-closed (D3, review §2.7).
  select count(*), min(s.clock_in_at)
  into n_shifts, first_in
  from public.daymark_shifts s
  where s.placement_id = placement and s.work_date = compute_day.work_date;

  select s.clock_out_at, s.clock_out_at is null, s.auto_closed
  into last_out, last_open, last_auto
  from public.daymark_shifts s
  where s.placement_id = placement and s.work_date = compute_day.work_date
  order by s.clock_in_at desc
  limit 1;

  with c as (
    select s.clock_in_at, s.clock_out_at,
           s.clock_in_at - lag(s.clock_out_at) over (order by s.clock_in_at) as gap
    from public.daymark_shifts s
    where s.placement_id = placement and s.work_date = compute_day.work_date
      and s.clock_out_at is not null and not s.auto_closed and not s.unverified
  )
  select coalesce(sum(extract(epoch from c.clock_out_at - c.clock_in_at)), 0),
         coalesce(bool_or(c.gap >= interval '30 minutes'), false)                   -- R5.4.2
  into raw_seconds, gap_break
  from c;

  r.placement_id := placement;
  r.work_date := work_date;
  r.raw := floor(raw_seconds / 60)::integer;                                        -- R5.4.1
  r.break := case when r.raw > st.break_threshold_minutes and not gap_break
                  then st.break_minutes else 0 end;                                 -- R5.4.2
  r.worked := r.raw - r.break;                                                      -- R5.4.3
  r.countable := least(r.worked, st.max_day_minutes);                               -- R5.4.4
  r.over_max := greatest(0, r.worked - st.max_day_minutes);                         -- R5.4.4
  r.scheduled := coalesce(sd.planned_minutes, 0);                                   -- R5.4.5
  r.base := least(r.countable, r.scheduled);                                        -- R5.4.6
  r.overtime := greatest(0, r.countable - r.scheduled);                             -- R5.4.7

  select q.approved_minutes into approved
  from public.daymark_requests q
  where q.placement_id = placement and q.type = 'overtime' and q.dates[1] = compute_day.work_date
    and q.status = 'approved';
  -- R5.4.8, never more than today's overtime (a later punch fix may lower it before day close clamps it).
  r.approved_ot := least(coalesce(approved, 0), r.overtime);
  r.counted := r.base + r.approved_ot;                                              -- R5.4.9

  r.closed := private.clock_now() >= private.darwin_at(work_date, '19:00');          -- R5.4.10
  r.short := case when r.closed then greatest(0, r.scheduled - r.worked) end;       -- R5.4.10
  r.late := r.scheduled > 0 and first_in is not null
            and first_in > private.darwin_at(work_date, sd.start_time)
                           + make_interval(mins => st.grace_minutes);               -- R5.4.12
  -- R5.4.13; an auto-closed last shift says nothing about when the intern left.
  r.left_early := r.closed and r.scheduled > 0 and n_shifts > 0 and not last_open and not last_auto
                  and last_out < private.darwin_at(work_date, sd.end_time) and r.short > 0;
  r.no_show := r.closed and r.scheduled > 0 and n_shifts = 0;                       -- R5.5.2
  r.auto_closed := coalesce(last_auto, false);                                      -- only the last shift can be auto-closed
  r.unscheduled := r.scheduled = 0 and n_shifts > 0;
  r.unverified := exists (
    select 1 from public.daymark_shifts s
    where s.placement_id = placement and s.work_date = compute_day.work_date and s.unverified
  );
  r.computed_at := private.clock_now();
  return r;
end;
$$;

-- Stores compute_day for one placement and date. Rows exist only for dates with a live day
-- (scheduled or leave) or a shift; a write happens only when a value changed.
create or replace function private.recompute_day(placement uuid, work_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.daymark_day_results;
begin
  if not exists (
       select 1 from public.daymark_scheduled_days d
       where d.placement_id = placement and d.work_date = recompute_day.work_date and d.status in ('scheduled', 'leave'))
     and not exists (
       select 1 from public.daymark_shifts s
       where s.placement_id = placement and s.work_date = recompute_day.work_date) then
    delete from public.daymark_day_results x where x.placement_id = placement and x.work_date = recompute_day.work_date;
    return;
  end if;

  r := private.compute_day(placement, work_date);
  insert into public.daymark_day_results as t values (r.*)
  on conflict on constraint daymark_day_results_pkey do update
  set raw = excluded.raw, break = excluded.break, worked = excluded.worked, countable = excluded.countable,
      over_max = excluded.over_max, scheduled = excluded.scheduled, base = excluded.base,
      overtime = excluded.overtime, approved_ot = excluded.approved_ot, counted = excluded.counted,
      short = excluded.short, late = excluded.late, left_early = excluded.left_early, no_show = excluded.no_show,
      auto_closed = excluded.auto_closed, unscheduled = excluded.unscheduled, unverified = excluded.unverified,
      closed = excluded.closed, computed_at = excluded.computed_at
  where (t.raw, t.break, t.worked, t.countable, t.over_max, t.scheduled, t.base, t.overtime, t.approved_ot,
         t.counted, t.short, t.late, t.left_early, t.no_show, t.auto_closed, t.unscheduled, t.unverified, t.closed)
        is distinct from
        (excluded.raw, excluded.break, excluded.worked, excluded.countable, excluded.over_max, excluded.scheduled,
         excluded.base, excluded.overtime, excluded.approved_ot, excluded.counted, excluded.short, excluded.late,
         excluded.left_early, excluded.no_show, excluded.auto_closed, excluded.unscheduled, excluded.unverified,
         excluded.closed);
end;
$$;

-- ---------------------------------------------------------------------------
-- §8.1 rebuild_shifts: pair the day's punches into shifts, then recompute the day. O(k log k).
-- ---------------------------------------------------------------------------

create or replace function private.rebuild_shifts(placement uuid, work_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  in_id uuid;
  in_at timestamptz;
  in_unverified boolean;
  unscheduled boolean;
begin
  delete from public.daymark_shifts s where s.placement_id = placement and s.work_date = rebuild_shifts.work_date;
  unscheduled := not exists (
    select 1 from public.daymark_scheduled_days d
    where d.placement_id = placement and d.work_date = rebuild_shifts.work_date and d.status = 'scheduled');

  for p in
    select x.id, x.event_type, x.occurred_at, x.source,
           x.source = 'supervisor' and x.confirmed_at is null as unverified
    from public.daymark_punches x
    where x.placement_id = placement
      and x.occurred_at >= private.darwin_at(rebuild_shifts.work_date, '00:00')
      and x.occurred_at < private.darwin_at(rebuild_shifts.work_date + 1, '00:00')
      and x.event_type in ('shift_in', 'shift_out')                                 -- R5.1.4 breaks ignored
      and not exists (select 1 from public.daymark_punches f where f.replaces_punch_id = x.id)  -- fixes supersede
    -- At the same instant an auto-close clock-out follows its clock-in (D3); otherwise out before in.
    order by x.occurred_at, x.source = 'auto_close', x.event_type desc, x.created_at, x.id
  loop
    if p.event_type = 'shift_in' then
      in_id := p.id;
      in_at := p.occurred_at;
      in_unverified := p.unverified;
    elsif in_id is not null then
      insert into public.daymark_shifts (placement_id, work_date, clock_in_at, clock_out_at, in_punch_id, out_punch_id,
                                         auto_closed, unscheduled, unverified)
      values (placement, work_date, in_at, p.occurred_at, in_id, p.id,
              p.source = 'auto_close', unscheduled, in_unverified or p.unverified);
      in_id := null;
    end if;
  end loop;
  if in_id is not null then
    insert into public.daymark_shifts (placement_id, work_date, clock_in_at, in_punch_id, unscheduled, unverified)
    values (placement, work_date, in_at, in_id, unscheduled, in_unverified);
  end if;

  perform private.recompute_day(placement, work_date);
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers: punches, scheduled days and overtime decisions keep the cache fresh.
-- Shifts have no trigger: only rebuild_shifts writes them, and it recomputes the day itself.
-- ---------------------------------------------------------------------------

-- Punches: rebuild every affected (placement, Darwin date), including a replaced punch's date.
create or replace function private.on_punches_inserted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
begin
  for k in
    select distinct x.placement_id, (x.occurred_at at time zone 'Australia/Darwin')::date as work_date
    from (
      select n.placement_id, n.occurred_at from new_rows n where n.event_type in ('shift_in', 'shift_out')
      union all
      select o.placement_id, o.occurred_at from public.daymark_punches o
      where o.id in (select n.replaces_punch_id from new_rows n where n.replaces_punch_id is not null)
    ) x
    where x.placement_id is not null
    order by 1, 2
  loop
    perform private.rebuild_shifts(k.placement_id, k.work_date);
  end loop;
  return null;
end;
$$;

create or replace function private.on_punches_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
begin
  for k in
    select distinct x.placement_id, (x.occurred_at at time zone 'Australia/Darwin')::date as work_date
    from (
      select n.placement_id, n.occurred_at from new_rows n
      union all
      select o.placement_id, o.occurred_at from old_rows o
      union all
      select o.placement_id, o.occurred_at from public.daymark_punches o
      where o.id in (select n.replaces_punch_id from new_rows n where n.replaces_punch_id is not null
                     union select o2.replaces_punch_id from old_rows o2 where o2.replaces_punch_id is not null)
    ) x
    where x.placement_id is not null
    order by 1, 2
  loop
    perform private.rebuild_shifts(k.placement_id, k.work_date);
  end loop;
  return null;
end;
$$;

create trigger daymark_punches_shifts_insert
  after insert on public.daymark_punches
  referencing new table as new_rows
  for each statement execute function private.on_punches_inserted();

create trigger daymark_punches_shifts_update
  after update on public.daymark_punches
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.on_punches_updated();

-- Scheduled days: a day added, moved, cancelled, put on leave or re-timed changes the
-- shifts' unscheduled flag and the day result, for the old and the new date.
create or replace function private.on_scheduled_days_inserted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
begin
  for k in select distinct n.placement_id, n.work_date from new_rows n order by 1, 2 loop
    perform private.rebuild_shifts(k.placement_id, k.work_date);
  end loop;
  return null;
end;
$$;

create or replace function private.on_scheduled_days_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
begin
  for k in
    select distinct x.placement_id, x.work_date
    from new_rows n
    join old_rows o on o.id = n.id
    cross join lateral (values (n.placement_id, n.work_date), (o.placement_id, o.work_date)) x (placement_id, work_date)
    where (o.status, o.work_date, o.start_time, o.end_time, o.placement_id)
          is distinct from (n.status, n.work_date, n.start_time, n.end_time, n.placement_id)
    order by 1, 2
  loop
    perform private.rebuild_shifts(k.placement_id, k.work_date);
  end loop;
  return null;
end;
$$;

create trigger daymark_scheduled_days_hours_insert
  after insert on public.daymark_scheduled_days
  referencing new table as new_rows
  for each statement execute function private.on_scheduled_days_inserted();

create trigger daymark_scheduled_days_hours_update
  after update on public.daymark_scheduled_days
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.on_scheduled_days_updated();

-- Overtime decisions (R5.4.8): the approved minutes feed counted.
create or replace function private.on_overtime_request_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.recompute_day(new.placement_id, new.dates[1]);
  if tg_op = 'UPDATE' and (old.placement_id, old.dates[1]) is distinct from (new.placement_id, new.dates[1]) then
    perform private.recompute_day(old.placement_id, old.dates[1]);
  end if;
  return null;
end;
$$;

create trigger daymark_requests_overtime_hours
  after insert or update of status, approved_minutes, dates, placement_id on public.daymark_requests
  for each row
  when (new.type = 'overtime')
  execute function private.on_overtime_request_changed();

-- ---------------------------------------------------------------------------
-- §8.2 reconciliation: recompute the last `days` days, audit every drift. Returns the count.
-- ---------------------------------------------------------------------------

create or replace function private.reconcile_day_results(days integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := private.darwin_today();
  k record;
  n integer := 0;
begin
  for k in
    with keys as (
      select d.placement_id, d.work_date from public.daymark_scheduled_days d
      where d.work_date between today - days and today and d.status in ('scheduled', 'leave')
      union
      select s.placement_id, s.work_date from public.daymark_shifts s
      where s.work_date between today - days and today
      union
      select r.placement_id, r.work_date from public.daymark_day_results r
      where r.work_date between today - days and today
    )
    select y.placement_id, y.work_date, to_jsonb(r) - 'computed_at' as stored
    from keys y
    left join public.daymark_day_results r on r.placement_id = y.placement_id and r.work_date = y.work_date
    order by 1, 2
  loop
    perform private.recompute_day(k.placement_id, k.work_date);
    if k.stored is distinct from (
         select to_jsonb(r) - 'computed_at' from public.daymark_day_results r
         where r.placement_id = k.placement_id and r.work_date = k.work_date) then
      perform private.audit('day_result_drift', 'daymark_day_results', k.placement_id || ':' || k.work_date, k.stored,
        (select to_jsonb(r) - 'computed_at' from public.daymark_day_results r
         where r.placement_id = k.placement_id and r.work_date = k.work_date));
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- View
-- ---------------------------------------------------------------------------

create view public.daymark_v_day_hours with (security_invoker = true) as
select r.*, p.intern_id, p.supervisor_id
from public.daymark_day_results r
join public.daymark_placements p on p.id = r.placement_id;

revoke all on table public.daymark_v_day_hours from public, anon, authenticated;
grant select on table public.daymark_v_day_hours to authenticated;
grant select on table public.daymark_v_day_hours to service_role;

-- Only definer functions and triggers call these.
revoke all on function private.compute_day(uuid, date) from public, anon, authenticated;
revoke all on function private.recompute_day(uuid, date) from public, anon, authenticated;
revoke all on function private.rebuild_shifts(uuid, date) from public, anon, authenticated;
revoke all on function private.on_punches_inserted() from public, anon, authenticated;
revoke all on function private.on_punches_updated() from public, anon, authenticated;
revoke all on function private.on_scheduled_days_inserted() from public, anon, authenticated;
revoke all on function private.on_scheduled_days_updated() from public, anon, authenticated;
revoke all on function private.on_overtime_request_changed() from public, anon, authenticated;
revoke all on function private.reconcile_day_results(integer) from public, anon, authenticated;

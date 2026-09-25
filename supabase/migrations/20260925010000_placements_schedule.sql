-- Phase 2: cohorts, placements, weekly patterns, the schedule, capacity (R5.2, R5.3, §8.5, §8.6),
-- notifications, and placement-aware clocking (R5.1.1).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.daymark_cohorts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 80),
  starts_on date,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now()
);

create table public.daymark_placements (
  id uuid primary key default gen_random_uuid(),
  intern_id uuid not null references public.daymark_profiles (id) on delete cascade,
  supervisor_id uuid not null references public.daymark_profiles (id),
  cohort_id uuid references public.daymark_cohorts (id) on delete set null,
  site_id uuid not null references public.daymark_sites (id),
  university text not null check (char_length(btrim(university)) between 1 and 120),
  course text not null check (char_length(btrim(course)) between 1 and 120),
  uni_coordinator_name text check (uni_coordinator_name is null or char_length(uni_coordinator_name) <= 80),
  uni_coordinator_email text check (
    uni_coordinator_email is null or uni_coordinator_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  start_date date not null,
  planned_end_date date not null,
  original_end_date date not null,
  target_minutes integer not null check (target_minutes between 60 and 120000),
  status text not null default 'active'
    check (status in ('active', 'target_reached', 'completed', 'extended', 'withdrawn')),
  target_reached_at timestamptz,
  ended_on date,
  report_approved_by uuid references public.daymark_profiles (id) on delete set null,
  report_approved_at timestamptz,
  report_approval_note text check (report_approval_note is null or char_length(report_approval_note) <= 500),
  created_by uuid references public.daymark_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint daymark_placements_dates_check check (planned_end_date >= start_date),
  constraint daymark_placements_supervisor_not_intern check (supervisor_id <> intern_id)
);

create unique index daymark_placements_one_live_key on public.daymark_placements (intern_id)
  where status in ('active', 'extended', 'target_reached');
create index daymark_placements_intern_idx on public.daymark_placements (intern_id);
create index daymark_placements_supervisor_idx on public.daymark_placements (supervisor_id);
create index daymark_placements_cohort_idx on public.daymark_placements (cohort_id);
create index daymark_placements_site_idx on public.daymark_placements (site_id);
create index daymark_placements_report_approved_by_idx on public.daymark_placements (report_approved_by);
create index daymark_placements_created_by_idx on public.daymark_placements (created_by);
create index daymark_placements_status_idx on public.daymark_placements (status);

-- R5.2.1 / C3: weekday, 07:00–19:00, end > start, ≤ 600 min, 15-minute steps.
create or replace function private.valid_day_times(start_time time, end_time time)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select start_time >= '07:00' and end_time <= '19:00' and end_time > start_time
     and end_time - start_time <= interval '600 minutes'
     and extract(epoch from start_time)::integer % 900 = 0
     and extract(epoch from end_time)::integer % 900 = 0;
$$;

create table public.daymark_pattern_versions (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.daymark_placements (id) on delete cascade,
  effective_from date not null,
  request_id uuid,
  created_by uuid references public.daymark_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (placement_id, effective_from)
);
create index daymark_pattern_versions_created_by_idx on public.daymark_pattern_versions (created_by);
create index daymark_pattern_versions_request_idx on public.daymark_pattern_versions (request_id);

create table public.daymark_pattern_days (
  id uuid primary key default gen_random_uuid(),
  pattern_version_id uuid not null references public.daymark_pattern_versions (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 5),
  start_time time not null,
  end_time time not null,
  unique (pattern_version_id, weekday),
  constraint daymark_pattern_days_times_check check (private.valid_day_times(start_time, end_time))
);

create table public.daymark_scheduled_days (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.daymark_placements (id) on delete cascade,
  site_id uuid not null references public.daymark_sites (id),
  work_date date not null check (extract(isodow from work_date) <= 5),
  start_time time not null,
  end_time time not null,
  -- R5.2.4: length minus a 30-minute break when longer than 300 minutes
  planned_minutes integer generated always as (
    (extract(epoch from (end_time - start_time)) / 60)::integer
    - case when extract(epoch from (end_time - start_time)) > 18000 then 30 else 0 end
  ) stored,
  source text not null default 'pattern' check (source in ('pattern', 'swap', 'extra_day', 'shift_change', 'admin')),
  status text not null default 'scheduled' check (status in ('scheduled', 'moved', 'leave', 'cancelled')),
  leave_kind text check (leave_kind in ('sick', 'personal')),
  origin_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daymark_scheduled_days_times_check check (private.valid_day_times(start_time, end_time)),
  constraint daymark_scheduled_days_leave_status_check check ((status = 'leave') = (leave_kind is not null))
);

-- R5.2.3 one live day per placement per date
create unique index daymark_scheduled_days_live_key on public.daymark_scheduled_days (placement_id, work_date)
  where status in ('scheduled', 'leave');
create index daymark_scheduled_days_placement_idx on public.daymark_scheduled_days (placement_id, work_date);
create index daymark_scheduled_days_site_headcount_idx on public.daymark_scheduled_days (site_id, work_date)
  where status = 'scheduled';
create index daymark_scheduled_days_site_idx on public.daymark_scheduled_days (site_id);
create index daymark_scheduled_days_request_idx on public.daymark_scheduled_days (origin_request_id);

create table public.daymark_schedule_history (
  id uuid primary key default gen_random_uuid(),
  scheduled_day_id uuid not null references public.daymark_scheduled_days (id) on delete cascade,
  before jsonb,
  after jsonb,
  changed_by uuid references public.daymark_profiles (id) on delete set null,
  request_id uuid,
  changed_at timestamptz not null default now()
);
create index daymark_schedule_history_day_idx on public.daymark_schedule_history (scheduled_day_id);
create index daymark_schedule_history_changed_by_idx on public.daymark_schedule_history (changed_by);
create index daymark_schedule_history_request_idx on public.daymark_schedule_history (request_id);

create table public.daymark_notifications (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.daymark_profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  link text check (link is null or link ~ '^/[A-Za-z0-9/_?=&.-]*$'),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index daymark_notifications_person_idx on public.daymark_notifications (person_id, created_at desc);
create index daymark_notifications_unread_idx on public.daymark_notifications (person_id) where read_at is null;

alter table public.daymark_punches
  add column placement_id uuid references public.daymark_placements (id) on delete cascade;
create index daymark_punches_placement_idx on public.daymark_punches (placement_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Access helpers (§6). Stable; policies call them per row or via (select …).
-- ---------------------------------------------------------------------------

create or replace function private.is_supervisor_of(intern uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.daymark_placements p
    join public.daymark_profiles s on s.id = p.supervisor_id
    where p.intern_id = intern and p.supervisor_id = (select auth.uid()) and s.is_supervisor and s.active
  );
$$;

create or replace function private.is_my_supervisor(person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.daymark_placements p
    where p.intern_id = (select auth.uid()) and p.supervisor_id = person
  );
$$;

create or replace function private.can_view_placement(placement uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin() or exists (
    select 1
    from public.daymark_placements p
    left join public.daymark_profiles s on s.id = p.supervisor_id
    where p.id = placement
      and (p.intern_id = (select auth.uid())
           or (p.supervisor_id = (select auth.uid()) and s.is_supervisor and s.active))
  );
$$;

-- The intern's live placement, else their most recent one.
create or replace function private.current_placement(intern uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.daymark_placements p
  where p.intern_id = intern
  order by (p.status in ('active', 'extended', 'target_reached')) desc, p.created_at desc
  limit 1;
$$;

create or replace function private.notify(person uuid, kind text, title text, body text, link text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.daymark_notifications (person_id, kind, title, body, link, created_at)
  values (person, kind, title, coalesce(body, ''), link, private.clock_now());
$$;

create or replace function private.fmt_day(d date)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(d, 'Dy FMDD Mon');
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.daymark_cohorts enable row level security;
alter table public.daymark_placements enable row level security;
alter table public.daymark_pattern_versions enable row level security;
alter table public.daymark_pattern_days enable row level security;
alter table public.daymark_scheduled_days enable row level security;
alter table public.daymark_schedule_history enable row level security;
alter table public.daymark_notifications enable row level security;

create policy "Signed-in people read cohorts" on public.daymark_cohorts
  for select to authenticated using (true);
create policy "Placement is visible to its intern, supervisor and admins" on public.daymark_placements
  for select to authenticated using ((select private.can_view_placement(id)));
create policy "Pattern versions follow the placement" on public.daymark_pattern_versions
  for select to authenticated using ((select private.can_view_placement(placement_id)));
create policy "Pattern days follow the placement" on public.daymark_pattern_days
  for select to authenticated using (exists (
    select 1 from public.daymark_pattern_versions v
    where v.id = pattern_version_id and (select private.can_view_placement(v.placement_id))
  ));
create policy "Scheduled days follow the placement" on public.daymark_scheduled_days
  for select to authenticated using ((select private.can_view_placement(placement_id)));
create policy "Schedule history follows the placement" on public.daymark_schedule_history
  for select to authenticated using (exists (
    select 1 from public.daymark_scheduled_days d
    where d.id = scheduled_day_id and (select private.can_view_placement(d.placement_id))
  ));
create policy "People read their own notifications" on public.daymark_notifications
  for select to authenticated using (person_id = (select auth.uid()));

drop policy if exists "Profiles are visible to the owner and admins" on public.daymark_profiles;
create policy "Profiles are visible to self, supervisors, own supervisor and admins" on public.daymark_profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin())
         or private.is_supervisor_of(id) or private.is_my_supervisor(id));

drop policy if exists "Punches are visible to the owner and admins" on public.daymark_punches;
create policy "Punches are visible to the intern, their supervisor and admins" on public.daymark_punches
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()) or private.is_supervisor_of(user_id));

drop policy if exists "Clock photos are readable by the owner and admins" on storage.objects;
create policy "Clock photos are readable by the intern, their supervisor and admins" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'daymark-photos'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select private.is_admin())
      or ((storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
          and private.is_supervisor_of(((storage.foldername(name))[1])::uuid))
    )
  );

revoke all on table public.daymark_cohorts, public.daymark_placements, public.daymark_pattern_versions,
  public.daymark_pattern_days, public.daymark_scheduled_days, public.daymark_schedule_history,
  public.daymark_notifications from public, anon, authenticated;
grant select on table public.daymark_cohorts, public.daymark_placements, public.daymark_pattern_versions,
  public.daymark_pattern_days, public.daymark_scheduled_days, public.daymark_schedule_history,
  public.daymark_notifications to authenticated;
grant all on table public.daymark_cohorts, public.daymark_placements, public.daymark_pattern_versions,
  public.daymark_pattern_days, public.daymark_scheduled_days, public.daymark_schedule_history,
  public.daymark_notifications to service_role;

-- ---------------------------------------------------------------------------
-- Capacity (§8.5, R5.3)
-- ---------------------------------------------------------------------------

-- Locks the site-dates in sorted order, raises if any would pass hard capacity, and returns
-- the dates that would need an extra spot (headcount above standard). `dates` are the days
-- being added; repeats count once each.
create or replace function private.assert_capacity(site uuid, dates date[], allow_extra boolean)
returns date[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  d date;
  std integer;
  hard integer;
  over date[];
  extra date[];
begin
  select s.standard_capacity, s.hard_capacity into std, hard from public.daymark_sites s where s.id = site;
  for d in select distinct x from unnest(dates) x order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(site::text || d::text, 0));
  end loop;

  with want as (
    select x as work_date, count(*) as delta from unnest(dates) x group by x
  ), have as (
    select s.work_date, count(*) as n
    from public.daymark_scheduled_days s
    where s.site_id = site and s.work_date = any (dates) and s.status = 'scheduled'
    group by s.work_date
  )
  select array_agg(w.work_date order by w.work_date) filter (where coalesce(h.n, 0) + w.delta > hard),
         array_agg(w.work_date order by w.work_date) filter (where coalesce(h.n, 0) + w.delta > std
                                                              and coalesce(h.n, 0) + w.delta <= hard)
  into over, extra
  from want w left join have h using (work_date);

  if over is not null then
    if cardinality(over) = 1 then
      raise exception 'That day already has % interns — the office limit (%).', hard, private.fmt_day(over[1])
        using errcode = 'P0001', hint = 'capacity', detail = array_to_string(over, ',');
    end if;
    raise exception 'These days already have % interns — the office limit: %.', hard,
      (select string_agg(private.fmt_day(x), ', ' order by x) from unnest(over) x)
      using errcode = 'P0001', hint = 'capacity', detail = array_to_string(over, ',');
  end if;
  return coalesce(extra, '{}');
end;
$$;

-- Last line of defence (R5.3.5, R5.3.7): re-count under the same lock after every change.
create or replace function private.capacity_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  std integer;
  hard integer;
begin
  if new.status <> 'scheduled'
     or (tg_op = 'UPDATE' and old.status = 'scheduled' and old.work_date = new.work_date
         and old.site_id = new.site_id) then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.site_id::text || new.work_date::text, 0));
  select s.standard_capacity, s.hard_capacity into std, hard from public.daymark_sites s where s.id = new.site_id;
  select count(*) into n from public.daymark_scheduled_days d
  where d.site_id = new.site_id and d.work_date = new.work_date and d.status = 'scheduled';
  if n > hard then
    raise exception 'That day already has % interns — the office limit (%).', hard, private.fmt_day(new.work_date)
      using errcode = 'P0001', hint = 'capacity';
  end if;
  if n > std and current_setting('daymark.extra_spot_ok', true) is distinct from 'on' then
    raise exception '% is full. An extra spot needs supervisor and admin approval.', private.fmt_day(new.work_date)
      using errcode = 'P0001', hint = 'extra_spot';
  end if;
  return null;
end;
$$;

create constraint trigger daymark_scheduled_days_capacity
  after insert or update on public.daymark_scheduled_days
  deferrable initially immediate
  for each row execute function private.capacity_guard();

-- Adds one day (swap, extra day, admin), checking capacity. Used by Phase 5 request effects.
create or replace function private.add_scheduled_day(
  placement uuid,
  work_date date,
  start_time time,
  end_time time,
  source text,
  origin_request_id uuid,
  allow_extra boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  site uuid;
  extra date[];
  new_id uuid;
begin
  select p.site_id into site from public.daymark_placements p where p.id = placement;
  extra := private.assert_capacity(site, array[work_date], allow_extra);
  if cardinality(extra) > 0 and not allow_extra then
    raise exception '% is full. An extra spot needs supervisor and admin approval.', private.fmt_day(work_date)
      using errcode = 'P0001', hint = 'extra_spot', detail = work_date::text;
  end if;
  if cardinality(extra) > 0 then
    perform set_config('daymark.extra_spot_ok', 'on', true);
  end if;
  insert into public.daymark_scheduled_days (placement_id, site_id, work_date, start_time, end_time, source, origin_request_id)
  values (placement, site, work_date, start_time, end_time, source, origin_request_id)
  returning id into new_id;
  perform set_config('daymark.extra_spot_ok', 'off', true);
  if cardinality(extra) > 0 then
    perform private.audit('extra_spot', 'daymark_scheduled_days', new_id::text, null,
      jsonb_build_object('placement_id', placement, 'work_date', work_date, 'origin_request_id', origin_request_id));
  end if;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Schedule generation (§8.6, R5.2.2)
-- ---------------------------------------------------------------------------

-- The pattern days that would be scheduled in [from_date, to_date]: weekdays of the pattern
-- version in force on each date, inside the placement, not closed, no live day already.
create or replace function private.pattern_candidates(placement uuid, from_date date, to_date date)
returns table (work_date date, start_time time, end_time time)
language sql
stable
security definer
set search_path = ''
as $$
  select g.d::date, pd.start_time, pd.end_time
  from public.daymark_placements p
  cross join generate_series(greatest(p.start_date, from_date), least(p.planned_end_date, to_date), interval '1 day') g(d)
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

create or replace function private.generate_days(placement uuid, from_date date, to_date date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.daymark_scheduled_days (placement_id, site_id, work_date, start_time, end_time, source)
  select placement, p.site_id, c.work_date, c.start_time, c.end_time, 'pattern'
  from private.pattern_candidates(placement, from_date, to_date) c
  cross join public.daymark_placements p
  where p.id = placement
  order by c.work_date;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Cancel future pattern days from `from_date` and generate them again from the current
-- pattern versions, checking capacity over the whole set in one call. Swap, extra-day,
-- shift-change, admin and leave days are kept. Returns the extra-spot dates used.
create or replace function private.regenerate(placement uuid, from_date date, allow_extra boolean)
returns date[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.daymark_placements%rowtype;
  dates date[];
  extra date[];
begin
  select * into p from public.daymark_placements where id = placement for update;

  update public.daymark_scheduled_days s
  set status = 'cancelled', updated_at = private.clock_now()
  where s.placement_id = placement and s.source = 'pattern' and s.status = 'scheduled' and s.work_date >= from_date;

  select coalesce(array_agg(c.work_date), '{}') into dates
  from private.pattern_candidates(placement, from_date, p.planned_end_date) c;
  extra := private.assert_capacity(p.site_id, dates, allow_extra);

  if cardinality(extra) > 0 and not allow_extra then
    raise exception 'Some days would need an extra spot (a 4th intern): %.',
      (select string_agg(private.fmt_day(x), ', ' order by x) from unnest(extra) x)
      using errcode = 'P0001', hint = 'extra_spot', detail = array_to_string(extra, ',');
  end if;
  if cardinality(extra) > 0 then
    perform set_config('daymark.extra_spot_ok', 'on', true);
  end if;
  perform private.generate_days(placement, from_date, p.planned_end_date);
  perform set_config('daymark.extra_spot_ok', 'off', true);
  if cardinality(extra) > 0 then
    perform private.audit('capacity_override', 'daymark_placements', placement::text, null,
      jsonb_build_object('extra_spot_dates', extra));
  end if;
  return extra;
end;
$$;

-- Validates a pattern given as [{"weekday":1,"start":"09:00","end":"17:00"}, …].
create or replace function private.parse_pattern(days jsonb)
returns table (weekday smallint, start_time time, end_time time)
language plpgsql
immutable
set search_path = ''
as $$
declare
  d jsonb;
  w smallint;
  s time;
  e time;
  seen smallint[] := '{}';
begin
  if jsonb_typeof(days) <> 'array' or jsonb_array_length(days) = 0 then
    raise exception 'Pick at least one usual day.' using errcode = '22023';
  end if;
  for d in select * from jsonb_array_elements(days) loop
    begin
      w := (d ->> 'weekday')::smallint;
      s := (d ->> 'start')::time;
      e := (d ->> 'end')::time;
    exception when others then
      raise exception 'Each usual day needs a weekday, a start and an end time.' using errcode = '22023';
    end;
    if w is null or w not between 1 and 5 or s is null or e is null or not private.valid_day_times(s, e) then
      raise exception 'Usual days are Monday to Friday, between 7:00 am and 7:00 pm, in 15-minute steps and at most 10 hours.'
        using errcode = '22023';
    end if;
    if w = any (seen) then
      raise exception 'Each weekday can appear once in the pattern.' using errcode = '22023';
    end if;
    seen := seen || w;
    weekday := w;
    start_time := s;
    end_time := e;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin placement RPCs
-- ---------------------------------------------------------------------------

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
  v_start date := (p ->> 'start_date')::date;
  v_end date := (p ->> 'planned_end_date')::date;
  v_target integer := (p ->> 'target_minutes')::integer;
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
  if v_start is null or v_end is null or v_end < v_start then
    raise exception 'The planned end date must be on or after the start date.' using errcode = '22023';
  end if;
  if v_target is null or v_target not between 60 and 120000 then
    raise exception 'Set target hours between 1 and 2,000.' using errcode = '22023';
  end if;
  if nullif(btrim(p ->> 'university'), '') is null or nullif(btrim(p ->> 'course'), '') is null then
    raise exception 'Enter the university and the course.' using errcode = '22023';
  end if;

  if pid is null then
    begin
      insert into public.daymark_placements (
        intern_id, supervisor_id, cohort_id, site_id, university, course, uni_coordinator_name,
        uni_coordinator_email, start_date, planned_end_date, original_end_date, target_minutes, created_by
      ) values (
        v_intern, v_supervisor, nullif(p ->> 'cohort_id', '')::uuid, v_site, btrim(p ->> 'university'),
        btrim(p ->> 'course'), nullif(btrim(p ->> 'uni_coordinator_name'), ''),
        nullif(lower(btrim(p ->> 'uni_coordinator_email')), ''), v_start, v_end, v_end, v_target, me
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
  if started and (v_start <> pl.start_date or v_end <> pl.planned_end_date) then
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
      start_date = v_start,
      planned_end_date = v_end,
      original_end_date = case when started then q.original_end_date else v_end end
  where q.id = pid
  returning * into pl;

  if not started and (v_start <> (before_row ->> 'start_date')::date or v_end <> (before_row ->> 'planned_end_date')::date) then
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

-- Admin edits the weekly pattern from a date (≥ today). Phase 5's pattern_change reuses regenerate.
create or replace function private.set_pattern(placement uuid, effective_from date, days jsonb, allow_extra boolean)
returns date[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype;
  ver uuid;
  extra date[];
begin
  perform private.require_admin();
  select * into pl from public.daymark_placements where id = placement;
  if not found then
    raise exception 'That placement doesn''t exist.' using errcode = '22023';
  end if;
  if effective_from < private.darwin_today() or effective_from < pl.start_date or effective_from > pl.planned_end_date then
    raise exception 'A new pattern starts today or later, inside the placement.' using errcode = '22023';
  end if;

  delete from public.daymark_pattern_versions v where v.placement_id = placement and v.effective_from = set_pattern.effective_from;
  insert into public.daymark_pattern_versions (placement_id, effective_from, created_by)
  values (placement, set_pattern.effective_from, (select auth.uid())) returning id into ver;
  insert into public.daymark_pattern_days (pattern_version_id, weekday, start_time, end_time)
  select ver, x.weekday, x.start_time, x.end_time from private.parse_pattern(days) x;

  extra := private.regenerate(placement, set_pattern.effective_from, allow_extra);
  perform private.audit('set_pattern', 'daymark_placements', placement::text, null,
    jsonb_build_object('effective_from', effective_from, 'pattern', days));
  perform private.notify(pl.intern_id, 'schedule', 'Your usual days changed',
    'Your schedule from ' || private.fmt_day(effective_from) || ' has been updated.', '/clock/schedule');
  return extra;
end;
$$;

-- Wizard preview: for each pattern date in range, today's headcount and the result with this intern.
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
    from generate_series(start_date, least(end_date, start_date + 400), interval '1 day') g(d)
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

create or replace function private.save_cohort(id uuid, name text, starts_on date, notes text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := save_cohort.id;
begin
  perform private.require_admin();
  if char_length(btrim(coalesce(name, ''))) not between 1 and 80 then
    raise exception 'Enter a cohort name up to 80 characters.' using errcode = '22023';
  end if;
  begin
    if cid is null then
      insert into public.daymark_cohorts (name, starts_on, notes)
      values (btrim(name), starts_on, nullif(btrim(notes), '')) returning daymark_cohorts.id into cid;
    else
      update public.daymark_cohorts c set name = btrim(save_cohort.name), starts_on = save_cohort.starts_on,
        notes = nullif(btrim(save_cohort.notes), '') where c.id = cid;
    end if;
  exception when unique_violation then
    raise exception 'A cohort with that name already exists.' using errcode = '23505';
  end;
  perform private.audit('save_cohort', 'daymark_cohorts', cid::text, null, jsonb_build_object('name', name));
  return cid;
end;
$$;

-- R5.2.5 A closure day added after generation cancels those days (not owed) and tells the intern.
create or replace function private.on_closure_day_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    update public.daymark_scheduled_days s
    set status = 'cancelled', updated_at = private.clock_now()
    where s.work_date = new.day and s.status in ('scheduled', 'leave')
      and (new.site_id is null or s.site_id = new.site_id)
    returning s.id, s.placement_id
  loop
    perform private.notify(
      (select p.intern_id from public.daymark_placements p where p.id = r.placement_id),
      'closure', 'Office closed ' || private.fmt_day(new.day),
      'The office is closed on ' || private.fmt_day(new.day) || ' for ' || new.name
        || '. That day is cancelled and you don''t owe its hours.',
      '/clock/schedule');
  end loop;
  perform private.audit('add_closure_day', 'daymark_closure_days', new.id::text, null, to_jsonb(new));
  return new;
end;
$$;

create trigger daymark_closure_days_cancel
  after insert on public.daymark_closure_days
  for each row execute function private.on_closure_day_added();

-- ---------------------------------------------------------------------------
-- Placement-aware clocking (R5.1.1, R5.1.2 site from the placement)
-- ---------------------------------------------------------------------------

create or replace function private.live_placement(intern uuid)
returns public.daymark_placements
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.daymark_placements p
  where p.intern_id = intern and p.status in ('active', 'extended', 'target_reached')
  order by p.created_at desc
  limit 1;
$$;

create or replace function private.site_for(person uuid)
returns public.daymark_sites
language sql
stable
security definer
set search_path = ''
as $$
  select s.* from public.daymark_sites s
  where s.id = coalesce(
    (select p.site_id from public.daymark_placements p where p.id = private.current_placement(person)),
    (select x.id from public.daymark_sites x where x.active order by x.created_at limit 1)
  );
$$;

create or replace function private.clock_block_reason(person uuid, event_type text, at timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.daymark_profiles%rowtype;
  pl public.daymark_placements%rowtype;
  site public.daymark_sites%rowtype;
  local_ts timestamp := at at time zone 'Australia/Darwin';
  closure text;
  last_event text;
begin
  select * into p from public.daymark_profiles where id = person;
  if not found or not p.is_intern then
    return 'Only interns clock in.';                                             -- R5.1.1
  end if;
  if not p.active then
    return 'Your login is paused. Ask the DGK admin to turn it back on.';        -- R5.1.1
  end if;

  pl := private.live_placement(person);
  if pl.id is null then
    if exists (select 1 from public.daymark_placements x where x.intern_id = person) then
      return 'Your placement has ended. You can still view and download your records.';  -- R5.11.5
    end if;
    return 'You don''t have a placement yet. Ask the DGK admin to set one up.';   -- R5.1.1
  end if;
  if pl.status = 'target_reached' and clock_block_reason.event_type = 'shift_in' then
    return 'You''ve reached your target hours. Your supervisor will confirm what happens next.';  -- R5.11.1, A5
  end if;

  select s.* into site from public.daymark_sites s where s.id = pl.site_id;
  if extract(isodow from local_ts) > 5 then
    return 'The office is closed on weekends.';                                  -- R5.1.2
  end if;
  select c.name into closure from public.daymark_closure_days c
  where c.day = local_ts::date and (c.site_id is null or c.site_id = site.id)
  limit 1;
  if closure is not null then
    return 'The office is closed today for ' || closure || '.';                  -- R5.1.2
  end if;
  if local_ts::time < site.window_start or local_ts::time > site.window_end then
    return 'Clocking is open ' || lower(to_char(site.window_start, 'FMHH12:MI am')) || ' to '
      || lower(to_char(site.window_end, 'FMHH12:MI am')) || ' on weekdays.';     -- R5.1.2
  end if;
  if clock_block_reason.event_type = 'shift_in' and local_ts::date < pl.start_date then
    return 'Your placement starts ' || private.fmt_day(pl.start_date) || '.';
  end if;
  if clock_block_reason.event_type = 'shift_in' and local_ts::date > pl.planned_end_date then
    return 'Your planned end date has passed. Ask your supervisor to extend your placement.';  -- review rule 4
  end if;

  select x.event_type into last_event from public.daymark_punches x
  where x.user_id = person and x.event_type in ('shift_in', 'shift_out')           -- R5.1.4 old breaks ignored
  order by x.occurred_at desc, x.created_at desc
  limit 1;
  if clock_block_reason.event_type = 'shift_in' and last_event = 'shift_in' then
    return 'You''re already clocked in. Clock out first.';                       -- R5.1.5
  end if;
  if clock_block_reason.event_type = 'shift_out' and last_event is distinct from 'shift_in' then
    return 'Clock in before you clock out.';                                     -- R5.1.5
  end if;

  if exists (select 1 from public.daymark_punches x
             where x.user_id = person and x.source = 'device'
               and x.occurred_at > at - interval '60 seconds' and x.occurred_at <= at) then
    return 'You just clocked. Wait a minute and try again.';                     -- review rule 8
  end if;
  return null;
end;
$$;

create or replace function private.punch_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  err text;
  site public.daymark_sites%rowtype;
begin
  if new.source = 'device' then
    new.occurred_at := private.clock_now();                                      -- server time only
  end if;
  new.placement_id := coalesce(new.placement_id, (private.live_placement(new.user_id)).id,
                               private.current_placement(new.user_id));
  err := private.punch_rule_error(new);
  if err is not null then
    raise exception '%', err using errcode = 'P0001';
  end if;
  if new.source = 'device' then
    site := private.site_for(new.user_id);
    new.distance_m := private.distance_metres(new.latitude, new.longitude, site.latitude, site.longitude);
    new.place_name := site.name;
    new.verification_method := 'gps_selfie';
    new.flags := private.punch_flags(new);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers
-- ---------------------------------------------------------------------------

create or replace function public.save_placement(p jsonb, allow_extra boolean default false)
returns uuid language sql security invoker set search_path = ''
as $$ select private.save_placement(p, allow_extra); $$;

create or replace function public.set_pattern(placement uuid, effective_from date, days jsonb, allow_extra boolean default false)
returns date[] language sql security invoker set search_path = ''
as $$ select private.set_pattern(placement, effective_from, days, allow_extra); $$;

create or replace function public.capacity_preview(site uuid, start_date date, end_date date, days jsonb, exclude_placement uuid default null)
returns table (work_date date, headcount integer, with_new integer, status text, closure text)
language sql stable security invoker set search_path = ''
as $$ select * from private.capacity_preview(site, start_date, end_date, days, exclude_placement); $$;

create or replace function public.save_cohort(id uuid, name text, starts_on date default null, notes text default null)
returns uuid language sql security invoker set search_path = ''
as $$ select private.save_cohort(id, name, starts_on, notes); $$;

create or replace function private.mark_notifications_read(ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.daymark_notifications n set read_at = private.clock_now()
  where n.person_id = (select auth.uid()) and n.read_at is null and (ids is null or n.id = any (ids));
$$;

create or replace function public.mark_notifications_read(ids uuid[] default null)
returns void language sql security invoker set search_path = ''
as $$ select private.mark_notifications_read(ids); $$;


-- Grants: private helpers callable by authenticated (their bodies check the caller);
-- everything else only by definer functions.
revoke all on function private.valid_day_times(time, time) from public, anon;
revoke all on function private.is_supervisor_of(uuid) from public, anon;
revoke all on function private.is_my_supervisor(uuid) from public, anon;
revoke all on function private.can_view_placement(uuid) from public, anon;
revoke all on function private.current_placement(uuid) from public, anon;
revoke all on function private.live_placement(uuid) from public, anon;
revoke all on function private.notify(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function private.fmt_day(date) from public, anon;
revoke all on function private.assert_capacity(uuid, date[], boolean) from public, anon, authenticated;
revoke all on function private.capacity_guard() from public, anon, authenticated;
revoke all on function private.add_scheduled_day(uuid, date, time, time, text, uuid, boolean) from public, anon, authenticated;
revoke all on function private.pattern_candidates(uuid, date, date) from public, anon, authenticated;
revoke all on function private.generate_days(uuid, date, date) from public, anon, authenticated;
revoke all on function private.regenerate(uuid, date, boolean) from public, anon, authenticated;
revoke all on function private.parse_pattern(jsonb) from public, anon;
revoke all on function private.save_placement(jsonb, boolean) from public, anon;
revoke all on function private.set_pattern(uuid, date, jsonb, boolean) from public, anon;
revoke all on function private.capacity_preview(uuid, date, date, jsonb, uuid) from public, anon;
revoke all on function private.save_cohort(uuid, text, date, text) from public, anon;
revoke all on function private.on_closure_day_added() from public, anon, authenticated;
revoke all on function private.mark_notifications_read(uuid[]) from public, anon;
revoke all on function public.save_placement(jsonb, boolean) from public, anon;
revoke all on function public.set_pattern(uuid, date, jsonb, boolean) from public, anon;
revoke all on function public.capacity_preview(uuid, date, date, jsonb, uuid) from public, anon;
revoke all on function public.save_cohort(uuid, text, date, text) from public, anon;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;

grant execute on function private.valid_day_times(time, time) to authenticated;
grant execute on function private.is_supervisor_of(uuid) to authenticated;
grant execute on function private.is_my_supervisor(uuid) to authenticated;
grant execute on function private.can_view_placement(uuid) to authenticated;
grant execute on function private.current_placement(uuid) to authenticated;
grant execute on function private.live_placement(uuid) to authenticated;
grant execute on function private.fmt_day(date) to authenticated;
grant execute on function private.parse_pattern(jsonb) to authenticated;
grant execute on function private.save_placement(jsonb, boolean) to authenticated;
grant execute on function private.set_pattern(uuid, date, jsonb, boolean) to authenticated;
grant execute on function private.capacity_preview(uuid, date, date, jsonb, uuid) to authenticated;
grant execute on function private.save_cohort(uuid, text, date, text) to authenticated;
grant execute on function private.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.save_placement(jsonb, boolean) to authenticated;
grant execute on function public.set_pattern(uuid, date, jsonb, boolean) to authenticated;
grant execute on function public.capacity_preview(uuid, date, date, jsonb, uuid) to authenticated;
grant execute on function public.save_cohort(uuid, text, date, text) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

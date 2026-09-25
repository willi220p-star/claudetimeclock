-- Phase 5: request validation (§8.9, §9.1 C1–C7, §9.2 type rules). The state machine and the
-- effects of approval are in 20260925041000_request_decisions.sql.

-- A note the system adds when it moves a request (e.g. capacity changed → admin).
alter table public.daymark_requests
  add column system_note text check (system_note is null or char_length(system_note) <= 500);

create or replace function private.fmt_clock(t time)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(to_char(t, 'FMHH12:MI am'));
$$;

-- "7h 30m", "45m", "8h" (formatMinutes in src/lib/minutes.ts, for non-negative values).
create or replace function private.fmt_duration(minutes integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when minutes >= 60 and minutes % 60 > 0 then minutes / 60 || 'h ' || minutes % 60 || 'm'
              when minutes % 60 > 0 then minutes || 'm'
              else minutes / 60 || 'h' end;
$$;

-- "Tue 14 Oct, Wed 15 Oct and 3 more"
create or replace function private.fmt_days(days date[])
returns text
language sql
immutable
set search_path = ''
as $$
  select string_agg(private.fmt_day(x), ', ' order by x) filter (where n <= 3)
         || case when count(*) > 3 then ' and ' || count(*) - 3 || ' more' else '' end
  from unnest(days) with ordinality u(x, n);
$$;

-- ---------------------------------------------------------------------------
-- Payload shapes. Mirror these in zod; keys not listed are rejected and JSON nulls count as absent.
--   swap           { scheduled_day_id: uuid, new_date: 'YYYY-MM-DD', start?: 'HH:MM', end?: 'HH:MM' }
--                  start and end come together; without them the day keeps its times
--   shift_change   { scheduled_day_id: uuid, start: 'HH:MM', end: 'HH:MM' }
--   extra_day      { date: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM' }
--   leave          { dates: ['YYYY-MM-DD', …] (1–10, all different), kind: 'sick' | 'personal' }
--   punch_fix      { date: 'YYYY-MM-DD', clock_in?: 'HH:MM', clock_out?: 'HH:MM',
--                    replaces_in_punch_id?: uuid (needs clock_in), replaces_out_punch_id?: uuid (needs clock_out) }
--                  at least one of clock_in / clock_out
--   overtime       { date?: 'YYYY-MM-DD' }            system-created (Phase 3); dates[1] is the work date
--   pattern_change { effective_from: 'YYYY-MM-DD', pattern: [{ weekday: 1–5, start: 'HH:MM', end: 'HH:MM' }, …] }
--   attendance     { punch_id: uuid, event_type: 'shift_in' | 'shift_out' }   system-created (supervisor confirmation)
-- The reason is a column, not part of the payload: required for intern types, ≥ 20 characters for
-- a punch fix (review rule 14).
-- ---------------------------------------------------------------------------
create or replace function private.request_payload_error(type text, payload jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  p jsonb := jsonb_strip_nulls(payload);
  keys text[];
  allowed text[];
  required text[];
  k text;
begin
  allowed := case type
    when 'swap' then '{scheduled_day_id,new_date,start,end}'
    when 'shift_change' then '{scheduled_day_id,start,end}'
    when 'extra_day' then '{date,start,end}'
    when 'leave' then '{dates,kind}'
    when 'punch_fix' then '{date,clock_in,clock_out,replaces_in_punch_id,replaces_out_punch_id}'
    when 'overtime' then '{date}'
    when 'pattern_change' then '{effective_from,pattern}'
    when 'attendance' then '{punch_id,event_type}'
  end;
  if allowed is null then
    return 'Pick a request type.';
  end if;
  if jsonb_typeof(p) is distinct from 'object' then
    return 'That request is incomplete. Refresh the page and try again.';
  end if;
  keys := array(select jsonb_object_keys(p));
  if not keys <@ allowed then
    return 'That request has a field we don''t recognise. Refresh the page and try again.';
  end if;
  required := case type
    when 'swap' then '{scheduled_day_id,new_date}'
    when 'shift_change' then '{scheduled_day_id,start,end}'
    when 'extra_day' then '{date,start,end}'
    when 'leave' then '{dates,kind}'
    when 'punch_fix' then '{date}'
    when 'overtime' then '{}'
    when 'pattern_change' then '{effective_from,pattern}'
    when 'attendance' then '{punch_id,event_type}'
  end;
  if not required <@ keys then
    return 'That request is incomplete. Refresh the page and try again.';
  end if;

  foreach k in array keys loop
    if k in ('scheduled_day_id', 'replaces_in_punch_id', 'replaces_out_punch_id', 'punch_id')
       and (jsonb_typeof(p -> k) <> 'string' or not pg_input_is_valid(p ->> k, 'uuid')) then
      return 'That request is incomplete. Refresh the page and try again.';
    end if;
    if k in ('new_date', 'date', 'effective_from')
       and (jsonb_typeof(p -> k) <> 'string' or p ->> k !~ '^\d{4}-\d{2}-\d{2}$' or not pg_input_is_valid(p ->> k, 'date')) then
      return 'Pick a valid date.';
    end if;
    if k in ('start', 'end', 'clock_in', 'clock_out')
       and (jsonb_typeof(p -> k) <> 'string' or p ->> k !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
      return 'Enter times as hours and minutes, like 09:00.';
    end if;
  end loop;

  if type = 'swap' and (p ? 'start') <> (p ? 'end') then
    return 'Pick the start and end times together.';
  end if;
  if type = 'leave' then
    if jsonb_typeof(p -> 'dates') <> 'array' or jsonb_array_length(p -> 'dates') not between 1 and 10
       or exists (select 1 from jsonb_array_elements(p -> 'dates') x
                  where jsonb_typeof(x) <> 'string' or x #>> '{}' !~ '^\d{4}-\d{2}-\d{2}$'
                     or not pg_input_is_valid(x #>> '{}', 'date'))
       or (select count(distinct x) from jsonb_array_elements_text(p -> 'dates') x) <> jsonb_array_length(p -> 'dates') then
      return 'Pick between 1 and 10 different dates.';
    end if;
    if p ->> 'kind' is distinct from 'sick' and p ->> 'kind' is distinct from 'personal' then
      return 'Choose sick or personal leave.';
    end if;
  end if;
  if type = 'punch_fix' then
    if not (p ? 'clock_in' or p ? 'clock_out') then
      return 'Enter the corrected clock-in time, clock-out time, or both.';
    end if;
    if (p ? 'replaces_in_punch_id' and not p ? 'clock_in') or (p ? 'replaces_out_punch_id' and not p ? 'clock_out') then
      return 'That request is incomplete. Refresh the page and try again.';
    end if;
  end if;
  if type = 'pattern_change' and jsonb_typeof(p -> 'pattern') <> 'array' then
    return 'Pick at least one usual day.';
  end if;
  if type = 'attendance' and p ->> 'event_type' not in ('shift_in', 'shift_out') then
    return 'That request is incomplete. Refresh the page and try again.';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Punch fixes (§9.2, review rule 14)
-- ---------------------------------------------------------------------------

-- The intern's shifts on a date as the hours engine pairs them: live punches (not superseded by
-- a fix) in time order, a clock-in before a clock-out at the same instant; out_at null = open.
create or replace function private.punch_fix_shifts(intern uuid, work_date date)
returns table (in_id uuid, in_at timestamptz, out_id uuid, out_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.occurred_at,
         case when q.next_type = 'shift_out' then q.next_id end,
         case when q.next_type = 'shift_out' then q.next_at end
  from (
    select x.id, x.event_type, x.occurred_at,
           lead(x.id) over w as next_id, lead(x.event_type) over w as next_type, lead(x.occurred_at) over w as next_at
    from public.daymark_punches x
    where x.user_id = intern and x.event_type in ('shift_in', 'shift_out')
      and (x.occurred_at at time zone 'Australia/Darwin')::date = work_date
      and not exists (select 1 from public.daymark_punches y where y.replaces_punch_id = x.id)
    window w as (order by x.occurred_at, x.event_type, x.created_at, x.id)
  ) q
  where q.event_type = 'shift_in';
$$;

-- The fixed shift lies in the site window and in the past, ends after it starts and doesn't
-- overlap (or touch) another shift that day. Null when it's fine.
create or replace function private.punch_fix_error(req public.daymark_requests, site public.daymark_sites)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p jsonb := jsonb_strip_nulls(req.payload);
  d date := (p ->> 'date')::date;
  cin time := (p ->> 'clock_in')::time;
  cout time := (p ->> 'clock_out')::time;
  rin uuid := (p ->> 'replaces_in_punch_id')::uuid;
  rout uuid := (p ->> 'replaces_out_punch_id')::uuid;
  ts_in timestamptz := private.darwin_at(d, cin);
  ts_out timestamptz := private.darwin_at(d, cout);
  s record;
  s2 record;
  r_in timestamptz;
  r_out timestamptz;
begin
  if (cin is not null and (cin < site.window_start or cin > site.window_end))
     or (cout is not null and (cout < site.window_start or cout > site.window_end)) then
    return 'Punch-fix times must be between ' || private.fmt_clock(site.window_start) || ' and '
      || private.fmt_clock(site.window_end) || '.';
  end if;
  if ts_in > private.clock_now() or ts_out > private.clock_now() then
    return 'Punch-fix times must be in the past.';
  end if;
  if cout <= cin then
    return 'The clock-out has to be after the clock-in.';
  end if;

  -- Which existing shift the fix changes, if any.
  if rin is not null then
    select * into s from private.punch_fix_shifts(req.intern_id, d) x where x.in_id = rin;
    if not found then
      return 'That clock-in isn''t one of your punches on ' || private.fmt_day(d) || '.';
    end if;
  end if;
  if rout is not null then
    select * into s2 from private.punch_fix_shifts(req.intern_id, d) x where x.out_id = rout;
    if not found then
      return 'That clock-out isn''t one of your punches on ' || private.fmt_day(d) || '.';
    end if;
    if rin is not null and s.in_id <> s2.in_id then
      return 'Those punches belong to different shifts. Fix one shift at a time.';
    end if;
    s := s2;
  end if;
  if rin is null and rout is null then
    if cout is null then
      return 'Add the clock-out time too, or pick the clock-in you''re correcting.';
    end if;
    if cin is null then                                                   -- closes an open shift
      select * into s from private.punch_fix_shifts(req.intern_id, d) x where x.out_id is null
      order by x.in_at desc limit 1;
      if not found then
        return 'There''s no open clock-in on ' || private.fmt_day(d) || ' to close. Add the clock-in time too.';
      end if;
    end if;
  end if;
  if s.in_id is not null and cin is not null and rin is null then
    return 'Also pick the clock-in you''re correcting.';
  end if;
  if s.out_id is not null and cout is not null and rout is null then
    return 'Also pick the clock-out you''re correcting.';
  end if;

  r_in := coalesce(ts_in, s.in_at);
  r_out := coalesce(ts_out, s.out_at);
  if r_out <= r_in then
    return 'The clock-out has to be after the clock-in.';
  end if;
  if exists (
    select 1 from private.punch_fix_shifts(req.intern_id, d) x
    where x.in_id is distinct from s.in_id
      and x.in_at <= coalesce(r_out, 'infinity') and r_in <= coalesce(x.out_at, 'infinity')
  ) then
    return 'Those times overlap another shift on ' || private.fmt_day(d)
      || '. Pick times that don''t clash with your other clock-ins and clock-outs.';
  end if;
  return null;
end;
$$;

-- Review rule 14: more than N punch fixes in a rolling 14 days needs the admin. Counts the
-- intern's other pending or approved fixes asked in the 14 days before this one.
create or replace function private.punch_fix_over_limit(req public.daymark_requests)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) >= (select s.punch_fix_max_per_fortnight from public.daymark_settings s where s.id = 1)
  from public.daymark_requests o
  where o.intern_id = req.intern_id and o.type = 'punch_fix' and o.id is distinct from req.id
    and o.status in ('pending_supervisor', 'pending_admin', 'approved')
    and o.created_at > coalesce(req.created_at, private.clock_now()) - interval '14 days'
    and (req.created_at is null or (o.created_at, o.id) < (req.created_at, req.id));
$$;

-- ---------------------------------------------------------------------------
-- §8.9 The whole check, first failure wins. Also returns the days the request adds (new_dates)
-- and the ones that need an extra spot (extra_dates) for the preview.
--
-- When-you-asked rules (C2 "not in the past", C4 notice, sick backdating, the punch-fix window)
-- are measured from created_at, so a slow decision never turns a valid request invalid. At a
-- decision a schedule change still can't touch a day that has already started.
-- C6 holds the site-date locks until the transaction ends (§8.5), except for a pattern change,
-- whose dry run is undone; its approval re-checks inside private.regenerate.
-- ---------------------------------------------------------------------------
create or replace function private.check_request(
  req public.daymark_requests,
  out ok boolean,
  out message text,
  out needs_extra_spot boolean,
  out dates date[],
  out new_dates date[],
  out extra_dates date[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  p jsonb := jsonb_strip_nulls(req.payload);
  pl public.daymark_placements%rowtype;
  site public.daymark_sites%rowtype;
  st public.daymark_settings%rowtype;
  now_ts timestamptz := private.clock_now();
  asked timestamptz := coalesce(req.created_at, private.clock_now());
  asked_day date := (coalesce(req.created_at, private.clock_now()) at time zone 'Australia/Darwin')::date;
  schedule_types text[] := '{swap,shift_change,extra_day,leave,punch_fix,pattern_change}';
  earliest date;
  day public.daymark_scheduled_days%rowtype;
  d date;
  s time;
  e time;
  starts timestamptz[] := '{}';
  new_starts timestamptz[];
  t timestamptz;
  closure text;
  over_dates date[];
  det text;
  ver uuid;
begin
  ok := false;
  needs_extra_spot := false;
  dates := '{}';
  new_dates := '{}';
  extra_dates := '{}';

  message := private.request_payload_error(req.type, req.payload);
  if message is not null then
    return;
  end if;

  select * into pl from public.daymark_placements x where x.id = req.placement_id;
  select * into site from public.daymark_sites x where x.id = pl.site_id;
  select * into st from public.daymark_settings x where x.id = 1;

  -- C1 the placement is live and the intern isn't read-only (R5.11.5)
  if pl.id is null or pl.intern_id <> req.intern_id then
    message := 'That placement doesn''t exist.';
    return;
  end if;
  if pl.status in ('completed', 'withdrawn') then
    message := 'Your placement has ended, so requests are closed. You can still view and download your records.';
    return;
  end if;
  if pl.status = 'target_reached' and req.type not in ('overtime', 'punch_fix', 'attendance') then
    message := 'You''ve reached your target hours, so your schedule can''t change. Your supervisor will confirm what happens next.';
    return;
  end if;

  -- What the request touches
  earliest := asked_day;
  case req.type
  when 'swap', 'shift_change' then
    select * into day from public.daymark_scheduled_days x
    where x.id = (p ->> 'scheduled_day_id')::uuid and x.placement_id = pl.id and x.status = 'scheduled';
    if not found then
      message := 'Pick one of your scheduled days to ' || case req.type when 'swap' then 'swap.' else 'change.' end;
      return;
    end if;
    s := coalesce((p ->> 'start')::time, day.start_time);
    e := coalesce((p ->> 'end')::time, day.end_time);
    if req.type = 'swap' then
      d := (p ->> 'new_date')::date;
      if d = day.work_date then
        message := 'Pick a different date. To change the times on the same day, ask for a shift change.';
        return;
      end if;
      dates := array[least(day.work_date, d), greatest(day.work_date, d)];
      new_dates := array[d];
      starts := array[private.darwin_at(day.work_date, day.start_time), private.darwin_at(d, s)];
    else
      if s = day.start_time and e = day.end_time then
        message := 'Those are already the times for ' || private.fmt_day(day.work_date) || '.';
        return;
      end if;
      dates := array[day.work_date];
      starts := array[private.darwin_at(day.work_date, least(day.start_time, s))];
    end if;
  when 'extra_day' then
    d := (p ->> 'date')::date;
    s := (p ->> 'start')::time;
    e := (p ->> 'end')::time;
    dates := array[d];
    new_dates := array[d];
    starts := array[private.darwin_at(d, s)];
  when 'leave' then
    dates := array(select x::date from jsonb_array_elements_text(p -> 'dates') x order by 1);
    if p ->> 'kind' = 'sick' then
      earliest := asked_day - st.sick_backdate_days;                   -- no notice, up to 2 days late
    end if;
    foreach d in array dates loop
      select * into day from public.daymark_scheduled_days x
      where x.placement_id = pl.id and x.work_date = d and x.status = 'scheduled';
      if not found then
        message := 'You''re not scheduled on ' || private.fmt_day(d) || ', so there''s no day to take off.';
        return;
      end if;
      if p ->> 'kind' = 'personal' then
        starts := starts || private.darwin_at(d, day.start_time);
      end if;
    end loop;
  when 'punch_fix' then
    d := (p ->> 'date')::date;
    dates := array[d];
    earliest := asked_day - st.punch_fix_days;                         -- at most 7 days ago
    if d > asked_day then
      message := 'Punch fixes are for today or earlier.';
      return;
    end if;
  when 'overtime' then
    dates := case when p ? 'date' then array[(p ->> 'date')::date] else req.dates end;
    if cardinality(dates) is distinct from 1 or dates[1] is null or req.requested_minutes is null then
      message := 'That request is incomplete. Refresh the page and try again.';
      return;
    end if;
  when 'attendance' then
    select array[(x.occurred_at at time zone 'Australia/Darwin')::date] into dates
    from public.daymark_punches x
    where x.id = (p ->> 'punch_id')::uuid and x.user_id = req.intern_id and x.source = 'supervisor'
      and x.event_type = p ->> 'event_type';
    if dates is null then
      message := 'That clock-in isn''t waiting for confirmation.';
      return;
    end if;
  when 'pattern_change' then
    d := (p ->> 'effective_from')::date;
    if d <= asked_day or d < pl.start_date or d > pl.planned_end_date then
      message := 'A new pattern can start tomorrow at the earliest, inside your placement dates.';
      return;
    end if;
    -- §8.6 dry run of the regeneration, undone before going on: the days it would cancel and
    -- add, and one capacity check over the whole new set.
    begin
      delete from public.daymark_pattern_versions v where v.placement_id = pl.id and v.effective_from = d;
      insert into public.daymark_pattern_versions (placement_id, effective_from) values (pl.id, d) returning id into ver;
      insert into public.daymark_pattern_days (pattern_version_id, weekday, start_time, end_time)
      select ver, x.weekday, x.start_time, x.end_time from private.parse_pattern(p -> 'pattern') x;
      with gone as (
        update public.daymark_scheduled_days x set status = 'cancelled'
        where x.placement_id = pl.id and x.source = 'pattern' and x.status = 'scheduled' and x.work_date >= d
        returning x.work_date, x.start_time
      )
      select coalesce(array_agg(g.work_date), '{}'), coalesce(array_agg(private.darwin_at(g.work_date, g.start_time)), '{}')
      into dates, starts from gone g;
      select coalesce(array_agg(c.work_date order by c.work_date), '{}'),
             coalesce(array_agg(private.darwin_at(c.work_date, c.start_time)), '{}')
      into new_dates, new_starts from private.pattern_candidates(pl.id, d, pl.planned_end_date) c;
      begin
        extra_dates := private.assert_capacity(site.id, new_dates, true);
      exception when sqlstate 'P0001' then
        get stacked diagnostics det = pg_exception_detail;
        over_dates := string_to_array(det, ',')::date[];
      end;
      raise exception using errcode = 'DM000';                           -- undo the dry run
    exception
      when sqlstate 'DM000' then null;
      when sqlstate '22023' then                                         -- C3 via parse_pattern
        message := sqlerrm;
        return;
    end;
    dates := array(select distinct x from unnest(dates || new_dates) x order by 1);
    starts := starts || new_starts;
  end case;

  -- C2 every date is a weekday, open, not in the past and inside the placement
  if req.type = any (schedule_types) then
    foreach d in array dates loop
      if extract(isodow from d) > 5 then
        message := private.fmt_day(d) || ' is on a weekend. Pick a weekday.';
        return;
      end if;
      select c.name into closure from public.daymark_closure_days c
      where c.day = d and (c.site_id is null or c.site_id = site.id) limit 1;
      if closure is not null then
        message := 'The office is closed on ' || private.fmt_day(d) || ' (' || closure || '). Pick another day.';
        return;
      end if;
      if d < earliest then
        message := case
          when req.type = 'leave' and p ->> 'kind' = 'sick' then
            'Sick leave can be asked for up to ' || st.sick_backdate_days || ' days after the day. '
            || private.fmt_day(d) || ' is too long ago — talk to your supervisor.'
          when req.type = 'punch_fix' then
            'Punch fixes can go back ' || st.punch_fix_days || ' days. '
            || private.fmt_day(d) || ' is too long ago — talk to your supervisor.'
          else private.fmt_day(d) || ' has passed. Pick a day from today on.' end;
        return;
      end if;
      if d > pl.planned_end_date then
        message := private.fmt_day(d) || ' is after your planned end date (' || private.fmt_day(pl.planned_end_date)
          || '). Pick an earlier day.';
        return;
      end if;
      if d < pl.start_date then
        message := 'Your placement starts ' || private.fmt_day(pl.start_date) || '. Pick a day from then on.';
        return;
      end if;
    end loop;
  end if;

  -- C3 times (pattern days were checked by parse_pattern, punch-fix times below)
  if req.type in ('swap', 'shift_change', 'extra_day') and not private.valid_day_times(s, e) then
    message := 'Times must be between 7:00 am and 7:00 pm, in 15-minute steps, and at most 10 hours.';
    return;
  end if;

  -- C4 notice (exempt: sick leave, punch fixes, overtime, attendance)
  if req.type in ('swap', 'shift_change', 'extra_day', 'pattern_change')
     or (req.type = 'leave' and p ->> 'kind' = 'personal') then
    foreach t in array array(select x from unnest(starts) x order by 1) loop
      if t <= now_ts and req.type <> 'leave' then
        message := private.fmt_day((t at time zone 'Australia/Darwin')::date) || ' has already started, so this can''t change now.';
        return;
      end if;
      if t < asked + make_interval(hours => st.notice_hours) then
        message := private.fmt_day((t at time zone 'Australia/Darwin')::date) || ' starts in less than ' || st.notice_hours
          || ' hours. Changes need ' || st.notice_hours || ' hours'' notice — talk to your supervisor.';
        return;
      end if;
    end loop;
  end if;

  -- C5 one live day per date
  if req.type in ('swap', 'extra_day') then
    foreach d in array new_dates loop
      if exists (select 1 from public.daymark_scheduled_days x
                 where x.placement_id = pl.id and x.work_date = d and x.status in ('scheduled', 'leave')) then
        message := 'You''re already scheduled on ' || private.fmt_day(d) || '.';
        return;
      end if;
    end loop;
  end if;

  -- C6 capacity (§8.5): a 4th needs an extra spot, a 5th is impossible
  if req.type in ('swap', 'extra_day') then
    begin
      extra_dates := private.assert_capacity(site.id, new_dates, true);
    exception when sqlstate 'P0001' then
      get stacked diagnostics det = pg_exception_detail;
      over_dates := string_to_array(det, ',')::date[];
    end;
  end if;
  if over_dates is not null then
    message := case when req.type = 'pattern_change' then
                 'Your new pattern would go past the office limit of ' || site.hard_capacity || ' interns on '
                 || private.fmt_days(over_dates) || '. Pick other days or times.'
               else private.fmt_day(over_dates[1]) || ' already has ' || site.hard_capacity
                 || ' interns — the office limit. Pick another day.' end;
    return;
  end if;
  needs_extra_spot := cardinality(extra_dates) > 0;

  -- C7 no other pending request from this intern on the same date (system types excluded)
  if req.type = any (schedule_types) then
    select min(x) into d
    from public.daymark_requests o, unnest(o.dates) x
    where o.intern_id = req.intern_id and o.id is distinct from req.id
      and o.status in ('pending_supervisor', 'pending_admin') and o.type = any (schedule_types)
      and o.dates && check_request.dates and x = any (check_request.dates);
    if d is not null then
      message := 'You already have a request waiting for ' || private.fmt_day(d) || '. Cancel it or wait for a decision first.';
      return;
    end if;
  end if;

  -- Type rules (§9.2)
  if req.type = 'leave' then
    select min((x.occurred_at at time zone 'Australia/Darwin')::date) into d
    from public.daymark_punches x
    where x.user_id = req.intern_id
      and (x.occurred_at at time zone 'Australia/Darwin')::date = any (check_request.dates);
    if d is not null then
      message := 'You clocked in on ' || private.fmt_day(d) || ', so it can''t be leave. Ask for a punch fix if your times are wrong.';
      return;
    end if;
  end if;
  if req.type = 'punch_fix' then
    message := private.punch_fix_error(req, site);
    if message is not null then
      return;
    end if;
    if char_length(btrim(coalesce(req.reason, ''))) < st.punch_fix_min_reason then
      message := 'Explain what happened in at least ' || st.punch_fix_min_reason || ' characters.';
      return;
    end if;
  end if;
  if req.type = 'attendance' then
    if dates[1] <> private.darwin_today() then
      message := 'Supervisor confirmation has to happen on the same day, so this one can''t be confirmed now.';
      return;
    end if;
    if exists (select 1 from public.daymark_punches x where x.id = (p ->> 'punch_id')::uuid and x.confirmed_at is not null) then
      message := 'That clock-in is already confirmed.';
      return;
    end if;
  end if;
  if req.type in ('swap', 'shift_change', 'extra_day', 'leave', 'pattern_change') and nullif(btrim(req.reason), '') is null then
    message := 'Add a short reason.';
    return;
  end if;

  ok := true;
end;
$$;

-- The contract other code and the preview use: (ok, message, needs_extra_spot, dates).
create or replace function private.validate_request(
  req public.daymark_requests,
  out ok boolean,
  out message text,
  out needs_extra_spot boolean,
  out dates date[]
)
language sql
security definer
set search_path = ''
as $$
  select c.ok, c.message, c.needs_extra_spot, c.dates from private.check_request(req) c;
$$;

-- Every insert is validated and starts at pending_supervisor, whoever inserts it (R5.12.2).
create or replace function private.request_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  new.created_at := private.clock_now();
  new.updated_at := new.created_at;
  new.status := 'pending_supervisor';
  new.supervisor_decision := null;
  new.supervisor_id := null;
  new.supervisor_decided_at := null;
  new.supervisor_note := null;
  new.admin_decision := null;
  new.admin_id := null;
  new.admin_decided_at := null;
  new.admin_note := null;
  new.system_note := null;
  new.escalated_at := null;
  new.approved_minutes := null;
  new.attachment_path := null;
  new.certificate_sighted := false;
  select * into v from private.validate_request(new);
  if not v.ok then
    raise exception '%', v.message using errcode = 'P0001';
  end if;
  new.dates := v.dates;
  new.needs_extra_spot := v.needs_extra_spot;
  return new;
end;
$$;

create trigger daymark_requests_validate
  before insert on public.daymark_requests
  for each row execute function private.request_before_insert();

revoke all on function private.fmt_clock(time) from public, anon, authenticated;
revoke all on function private.fmt_duration(integer) from public, anon, authenticated;
revoke all on function private.fmt_days(date[]) from public, anon, authenticated;
revoke all on function private.request_payload_error(text, jsonb) from public, anon, authenticated;
revoke all on function private.punch_fix_shifts(uuid, date) from public, anon, authenticated;
revoke all on function private.punch_fix_error(public.daymark_requests, public.daymark_sites) from public, anon, authenticated;
revoke all on function private.punch_fix_over_limit(public.daymark_requests) from public, anon, authenticated;
revoke all on function private.check_request(public.daymark_requests) from public, anon, authenticated;
revoke all on function private.validate_request(public.daymark_requests) from public, anon, authenticated;
revoke all on function private.request_before_insert() from public, anon, authenticated;

-- Offline clock-in (Dilip, 8 Oct; design docs/superpowers/specs/2026-10-08-offline-push-design.md, D35):
-- with no signal the phone keeps the clock (its own time, GPS, a selfie with a phone-picked gesture)
-- and sends it when back online. The server can't vouch for the time, so it is a punch waiting for
-- the supervisor, like a typed-in time: it counts 0 until the attendance request is approved.

-- ---------------------------------------------------------------------------
-- 1. Punch columns
-- ---------------------------------------------------------------------------
alter table public.daymark_punches drop constraint daymark_punches_verification_method_check;
alter table public.daymark_punches add constraint daymark_punches_verification_method_check
  check (verification_method in ('gps_selfie', 'supervisor', 'punch_fix', 'staff_edit', 'offline'));
-- The phone's id for a queued clock: sending it twice returns the first punch.
alter table public.daymark_punches add column offline_id uuid unique;

-- ---------------------------------------------------------------------------
-- 2. Shared steps
-- ---------------------------------------------------------------------------
-- A punch waiting for the supervisor: file the attendance request and tell the supervisor and admins.
create or replace function private.request_punch_confirmation(pl public.daymark_placements, punch uuid, event_type text,
                                                               reason text, headline text, detail text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.daymark_requests (placement_id, intern_id, type, payload, reason)
  values (pl.id, pl.intern_id, 'attendance', jsonb_build_object('punch_id', punch, 'event_type', event_type), reason);
  perform private.notify(pl.supervisor_id, 'attendance', headline, detail || ' Confirm it in Approvals.', '/supervisor/approvals');
  perform private.notify_admins('attendance', headline, detail, '/admin/requests');
end;
$$;

-- Save a day's kind (Full day / Work-based) for a placement; a work-based day asks the supervisor.
create or replace function private.save_day_kind(pl public.daymark_placements, day date, kind text)
returns public.daymark_day_kinds
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.daymark_day_kinds%rowtype;
begin
  if kind is null or kind not in ('full_day', 'work_based') then
    raise exception 'Pick Full day or Work-based.' using errcode = '22023';
  end if;
  if exists (select 1 from public.daymark_day_kinds d
             where d.placement_id = pl.id and d.work_date = save_day_kind.day and d.status in ('approved', 'declined')) then
    raise exception 'That day''s type is already decided.' using errcode = 'P0001';
  end if;

  insert into public.daymark_day_kinds (placement_id, work_date, kind, status, created_at)
  values (pl.id, save_day_kind.day, kind, case when kind = 'work_based' then 'pending' end, private.clock_now())
  on conflict (placement_id, work_date) do update set kind = excluded.kind, status = excluded.status
  returning * into saved;

  if kind = 'work_based' then
    perform private.notify(pl.supervisor_id, 'work_based', 'Work-based day to approve',
      (select x.display_name from public.daymark_profiles x where x.id = pl.intern_id) || ' is doing a work-based day on '
        || private.fmt_day(save_day_kind.day) || '. Approve it to count the full day.', '/supervisor/approvals');
  end if;
  perform private.recompute_day(pl.id, save_day_kind.day);
  return saved;
end;
$$;

create or replace function private.choose_day_kind(kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype := private.live_placement((select auth.uid()));
begin
  if pl.id is null then
    raise exception 'You don''t have an active placement.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.daymark_day_kinds d
             where d.placement_id = pl.id and d.work_date = private.darwin_today() and d.status in ('approved', 'declined')) then
    raise exception 'Today''s day type is already decided.' using errcode = 'P0001';
  end if;
  return to_jsonb(private.save_day_kind(pl, private.darwin_today(), kind));
end;
$$;

-- Typed-in times now share the request step with offline clocks.
create or replace function private.report_missed_time(event text, at_time time, note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  pl public.daymark_placements%rowtype := private.live_placement(me);
  ts timestamptz;
  last_at timestamptz;
  punch uuid;
  clean text := nullif(btrim(note), '');
  what text;
  name text := (select x.display_name from public.daymark_profiles x where x.id = me);
begin
  if not exists (select 1 from public.daymark_profiles x where x.id = me and x.is_intern and x.active) then
    raise exception 'Only interns clock in.' using errcode = '42501';
  end if;
  if pl.id is null then
    raise exception 'You don''t have an active placement.' using errcode = 'P0001';
  end if;
  if event is null or event not in ('shift_in', 'break_end') then
    raise exception 'Pick when you arrived or when your break ended.' using errcode = '22023';
  end if;
  if at_time is null then
    raise exception 'Enter the time.' using errcode = '22023';
  end if;
  if char_length(coalesce(clean, '')) > 200 then
    raise exception 'Keep the note under 200 characters.' using errcode = '22023';
  end if;
  perform private.require_clocking_consent(me);
  if event = 'shift_in' then
    perform private.require_day_kind(me);
  end if;

  ts := private.darwin_at(private.darwin_today(), at_time);
  if ts > private.clock_now() then
    raise exception 'That time hasn''t happened yet.' using errcode = '22023';
  end if;
  select max(x.occurred_at) into last_at from public.daymark_punches x
  where x.user_id = me and x.event_type in ('shift_in', 'shift_out');
  if last_at is not null and ts <= last_at then
    raise exception 'Pick a time after your last clock (%).', private.fmt_clock((last_at at time zone 'Australia/Darwin')::time)
      using errcode = '22023';
  end if;

  insert into public.daymark_punches (user_id, event_type, is_break, source, occurred_at, verification_method, user_agent)
  values (me, 'shift_in', event = 'break_end', 'supervisor', ts, 'supervisor', private.request_user_agent())
  returning id into punch;

  what := case event when 'shift_in' then 'arrived at ' else 'ended their break at ' end || private.fmt_clock(at_time);
  perform private.request_punch_confirmation(pl, punch, 'shift_in', 'Typed in: ' || what || coalesce('. ' || clean, ''),
    name || ' typed in a time', name || ' ' || what || ' on ' || private.fmt_day(private.darwin_today()) || '.');
  return jsonb_build_object('punch_id', punch, 'occurred_at', ts);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Offline clocks
-- ---------------------------------------------------------------------------
create or replace function private.submit_offline_punch(
  offline_id uuid,
  action text,
  occurred_at timestamptz,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  gesture text,
  day_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  pl public.daymark_placements%rowtype := private.live_placement(me);
  existing public.daymark_punches%rowtype;
  saved public.daymark_punches%rowtype;
  site public.daymark_sites%rowtype;
  path text := me || '/' || offline_id || '.jpg';
  on_date date := (submit_offline_punch.occurred_at at time zone 'Australia/Darwin')::date;
  metres double precision;
  what text;
  name text := (select x.display_name from public.daymark_profiles x where x.id = me);
begin
  if not exists (select 1 from public.daymark_profiles x where x.id = me and x.is_intern and x.active) then
    raise exception 'Only interns clock in.' using errcode = '42501';
  end if;
  if pl.id is null then
    raise exception 'You don''t have an active placement.' using errcode = 'P0001';
  end if;
  if offline_id is null then
    raise exception 'That offline clock has no id.' using errcode = '22023';
  end if;

  -- Sent twice (a retry after a dropped reply): hand back the first one.
  select * into existing from public.daymark_punches x where x.offline_id = submit_offline_punch.offline_id;
  if found then
    if existing.user_id <> me then
      raise exception 'That offline clock belongs to someone else.' using errcode = '42501';
    end if;
    return to_jsonb(existing);
  end if;

  if action is null or action not in ('shift_in', 'break_start', 'break_end', 'shift_out') then
    raise exception 'Use Start, Break and Finish.' using errcode = '22023';
  end if;
  if occurred_at is null or occurred_at > private.clock_now() + interval '2 minutes' then
    raise exception 'That clock''s time is in the future. Check your phone''s clock.' using errcode = '22023';
  end if;
  if occurred_at < private.clock_now() - interval '48 hours' then
    raise exception 'That offline clock is more than 2 days old. Ask your supervisor to add the time.' using errcode = '22023';
  end if;
  if latitude is null or longitude is null then
    raise exception 'A clock needs your location.' using errcode = '22023';
  end if;
  perform private.require_clocking_consent(me);
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'daymark-photos' and o.name = path and o.owner_id = me::text
  ) then
    raise exception 'We didn''t get the selfie for that clock. Open DGK Clock with signal to send it again.' using errcode = 'P0001';
  end if;

  -- The first clock-in of a day carries the day's kind the intern picked offline.
  if action = 'shift_in' and not exists (
    select 1 from public.daymark_day_kinds d where d.placement_id = pl.id and d.work_date = on_date
  ) then
    if day_kind is null then
      raise exception 'Pick Full day or Work-based before you clock in.' using errcode = 'P0001', hint = 'day_kind';
    end if;
    perform private.save_day_kind(pl, on_date, day_kind);
  end if;

  site := private.site_for(me);
  metres := private.distance_metres(latitude, longitude, site.latitude, site.longitude);
  insert into public.daymark_punches (user_id, event_type, is_break, source, occurred_at, verification_method,
                                      latitude, longitude, accuracy_m, distance_m, place_name, photo_path,
                                      client_reported_at, offline_id, user_agent)
  values (me, case when action in ('shift_in', 'break_end') then 'shift_in' else 'shift_out' end,
          action in ('break_start', 'break_end'), 'supervisor', occurred_at, 'offline',
          latitude, longitude, accuracy_m, metres, site.name, path,
          occurred_at, offline_id, private.request_user_agent())
  returning * into saved;

  what := case action when 'shift_in' then 'clocked in' when 'break_start' then 'started a break'
                      when 'break_end' then 'ended a break' else 'clocked out' end
          || ' offline at ' || private.fmt_clock((occurred_at at time zone 'Australia/Darwin')::time) || ' (phone time)';
  perform private.request_punch_confirmation(pl, saved.id, saved.event_type,
    'Offline: ' || what || ' on ' || private.fmt_day(on_date) || ', ' || private.format_distance(metres) || ' from '
      || coalesce(site.name, 'the office') || coalesce(', gesture "' || nullif(btrim(gesture), '') || '"', '')
      || '. Sent ' || private.fmt_clock((private.clock_now() at time zone 'Australia/Darwin')::time) || '.',
    name || ' clocked offline', name || ' ' || what || ' on ' || private.fmt_day(on_date) || '.');
  return to_jsonb(saved);
end;
$$;

create or replace function public.submit_offline_punch(
  offline_id uuid, action text, occurred_at timestamptz, latitude double precision, longitude double precision,
  accuracy_m double precision, gesture text default null, day_kind text default null
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.submit_offline_punch(offline_id, action, occurred_at, latitude, longitude, accuracy_m, gesture, day_kind); $$;

revoke all on function private.request_punch_confirmation(public.daymark_placements, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function private.save_day_kind(public.daymark_placements, date, text) from public, anon, authenticated;
revoke all on function private.submit_offline_punch(uuid, text, timestamptz, double precision, double precision, double precision, text, text) from public, anon;
revoke all on function public.submit_offline_punch(uuid, text, timestamptz, double precision, double precision, double precision, text, text) from public, anon;
grant execute on function private.submit_offline_punch(uuid, text, timestamptz, double precision, double precision, double precision, text, text) to authenticated;
grant execute on function public.submit_offline_punch(uuid, text, timestamptz, double precision, double precision, double precision, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. Confirming a typed-in or offline clock: within 7 days, not only the same day.
-- (Copied from 20260925040000_request_validation.sql; only the attendance date rule changed.)
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
    -- Typed-in and offline clocks reach the supervisor later than a live one (8 Oct): a week to confirm.
    if dates[1] < private.darwin_today() - 7 then
      message := 'Clocks are confirmed within 7 days, so this one can''t be confirmed now. Add the time on Timesheets instead.';
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

-- ---------------------------------------------------------------------------
-- 4. Collection notice v1.3: offline clocks and phone reminders.
-- Publishing makes it current, so every intern acknowledges it before their next clock-in.
-- ---------------------------------------------------------------------------
do $$
declare
  current_version text := (select s.notice_version from public.daymark_settings s where s.id = 1);
  n public.daymark_notices%rowtype;
  body text;
  new_version text := '1.3';
begin
  select * into n from public.daymark_notices x where x.version = current_version;
  body := replace(n.body, E'Who sees it\n',
    E'No signal and reminders\n\n'
    || E'DGK Clock is saved on your phone so it opens without signal; none of your information is kept in that saved copy. '
    || E'If you clock without signal, your phone keeps that clock (your phone''s time, your location and your selfie) until it is back online, '
    || E'sends it, then deletes it from the phone. A clock sent this way counts once your supervisor confirms it. '
    || E'If you turn on reminders, we store the code your browser gives us to send them to that phone; turn them off any time under Me.\n\n'
    || E'Who sees it\n');
  if body not like '%No signal and reminders%' then
    raise exception 'The collection notice wording changed; add the "No signal and reminders" section by hand.';
  end if;

  if exists (select 1 from public.daymark_notices x where x.version = new_version) then
    new_version := '1.3-' || to_char(private.darwin_today(), 'YYYYMMDD');
  end if;
  insert into public.daymark_notices (version, title, body, published_at)
  values (new_version, n.title, body, private.clock_now());
  update public.daymark_settings s set notice_version = new_version, updated_at = private.clock_now() where s.id = 1;
  perform private.notify(p.id, 'notice', 'We''ve updated how DGK Clock handles your information',
    'Please read it before your next clock-in.', '/clock')
  from public.daymark_profiles p
  where p.is_intern and p.active;
end;
$$;

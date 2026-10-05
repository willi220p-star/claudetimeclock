-- 5 Oct requests (Dilip):
--   1. Start · Break · Finish: a break is a clock-out and a clock-in marked is_break, so shifts,
--      auto-close and records work unchanged. Breaks start between 10 am and 2 pm.
--   2. Each intern has an assigned break (placement.break_minutes, default 30). On days over 5 hours
--      the unpaid break is topped up to it; roster planned minutes use it too.
--   3. Clock in and out as often as needed: the 60-second rule is gone (the 90-second single-use
--      challenge already stops double taps).
--   4. Finish needs that day's work log first. Breaks never do.
--   5. Admin, or the intern's supervisor, edits clock times directly (staff_edit_times). The edit is
--      the approval: that day's time beyond the roster counts straight away.
--   6. Catch-up: the intern picks free office days themselves (catch_up_slots,
--      submit_catch_up_days); the supervisor approves them as extra days. The "longer days" plan goes.
--   7. Location and selfie are required to clock. The supervisor-confirmation route is removed.
--   8. Collection notice v1.2 says both.

-- ---------------------------------------------------------------------------
-- 1. Breaks
-- ---------------------------------------------------------------------------
alter table public.daymark_punches add column is_break boolean not null default false;

alter table public.daymark_clock_challenges drop constraint daymark_clock_challenges_event_type_check;
alter table public.daymark_clock_challenges add constraint daymark_clock_challenges_event_type_check
  check (event_type in ('shift_in', 'shift_out', 'break_start', 'break_end'));

-- Staff edits are a new trusted punch source; the editor goes in confirmed_by.
alter table public.daymark_punches drop constraint daymark_punches_source_check;
alter table public.daymark_punches add constraint daymark_punches_source_check
  check (source in ('device', 'auto_close', 'punch_fix', 'supervisor', 'staff_edit'));
alter table public.daymark_punches drop constraint daymark_punches_verification_method_check;
alter table public.daymark_punches add constraint daymark_punches_verification_method_check
  check (verification_method in ('gps_selfie', 'supervisor', 'punch_fix', 'staff_edit'));

-- What a punch means to the person: Start, Break start, Break end or Finish.
create or replace function private.clock_event(event_type text, is_break boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when is_break and event_type = 'shift_out' then 'break_start'
    when is_break and event_type = 'shift_in' then 'break_end'
    else event_type
  end;
$$;

create or replace function private.clock_block_reason(person uuid, event_type text, at timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev text := clock_block_reason.event_type;
  p public.daymark_profiles%rowtype;
  pl public.daymark_placements%rowtype;
  site public.daymark_sites%rowtype;
  local_ts timestamp := at at time zone 'Australia/Darwin';
  last_event text;
  last_break boolean;
  last_at timestamptz;
  prev_date date;
  open_date date;
begin
  if ev is null or ev not in ('shift_in', 'shift_out', 'break_start', 'break_end') then
    return 'Pick Start, Break or Finish.';
  end if;
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
  if pl.status = 'target_reached' and ev = 'shift_in' then
    return 'You''ve reached your target hours. Your supervisor will confirm what happens next.';  -- R5.11.1, A5
  end if;

  select s.* into site from public.daymark_sites s where s.id = pl.site_id;
  -- Always on (Dilip, 26 Sep): no weekend, office-hours or closure-day block.

  if ev = 'shift_in' and local_ts::date < pl.start_date then
    return 'Your placement starts ' || private.fmt_day(pl.start_date) || '.';
  end if;
  if ev = 'shift_in' and local_ts::date > pl.planned_end_date then
    return 'Your planned end date has passed. Ask your supervisor to extend your placement.';  -- review rule 4
  end if;

  select x.event_type, x.is_break, x.occurred_at into last_event, last_break, last_at
  from public.daymark_punches x
  where x.user_id = person and x.event_type in ('shift_in', 'shift_out')           -- R5.1.4 old breaks ignored
  order by x.occurred_at desc, x.source = 'auto_close' desc, x.created_at desc
  limit 1;
  if ev = 'break_end' and not (last_event = 'shift_out' and last_break
                               and (last_at at time zone 'Australia/Darwin')::date = local_ts::date) then
    return 'You''re not on a break.';
  end if;
  if ev = 'shift_in' and last_event = 'shift_in' then
    return 'You''re already clocked in. Clock out first.';                       -- R5.1.5
  end if;
  if ev in ('shift_out', 'break_start') and last_event is distinct from 'shift_in' then
    return 'Clock in before you clock out.';                                     -- R5.1.5
  end if;
  if ev = 'break_start' and (local_ts::time < '10:00' or local_ts::time >= '14:00') then
    return 'Breaks start between 10 am and 2 pm.';
  end if;

  if ev = 'shift_out' then
    -- Finish needs the work log for the shift being closed (Dilip, 5 Oct). Breaks never do.
    select s.work_date into open_date from public.daymark_shifts s
    where s.placement_id = pl.id and s.clock_out_at is null
    order by s.clock_in_at desc limit 1;
    open_date := coalesce(open_date, local_ts::date);
    if not exists (select 1 from public.daymark_work_logs w where w.placement_id = pl.id and w.work_date = open_date) then
      return 'Write your work log for ' || private.fmt_day(open_date) || ' to clock out.';
    end if;
  end if;

  if ev = 'shift_in' then
    -- R5.1.6 the log for the previous shift date (before today) must exist: the safety net for a
    -- day that was auto-closed or ended on a break.
    select max(s.work_date) into prev_date from public.daymark_shifts s
    where s.placement_id = pl.id and s.work_date < local_ts::date;
    if prev_date is not null and not exists (
         select 1 from public.daymark_work_logs w where w.placement_id = pl.id and w.work_date = prev_date) then
      return 'Write your work log for ' || private.fmt_day(prev_date) || ' to clock in.';
    end if;

    -- R5.1.8 an unscheduled first shift of the day needs room under the site's hard capacity.
    if not exists (
         select 1 from public.daymark_scheduled_days d
         where d.placement_id = pl.id and d.work_date = local_ts::date and d.status = 'scheduled')
       and not exists (
         select 1 from public.daymark_shifts s where s.placement_id = pl.id and s.work_date = local_ts::date)
       and (select count(*) from public.daymark_scheduled_days d
            where d.site_id = pl.site_id and d.work_date = local_ts::date and d.status = 'scheduled') >= site.hard_capacity then
      return 'The office already has ' || site.hard_capacity || ' interns booked today, so there''s no room for an '
        || 'unscheduled shift. You can clock in on your scheduled days.';
    end if;
  end if;
  -- Clock as often as needed (Dilip, 5 Oct): no more 60-second wait between punches.
  return null;
end;
$$;

create or replace function private.punch_rule_error(p public.daymark_punches)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  site public.daymark_sites%rowtype;
  max_accuracy integer;
  metres double precision;
  reason text;
begin
  if p.event_type not in ('shift_in', 'shift_out') then
    return 'Use Start, Break and Finish.';                                       -- R5.1.4
  end if;
  if p.source in ('auto_close', 'punch_fix', 'staff_edit') then
    return null;                                                                 -- R5.1.7 trusted punches
  end if;
  if p.source = 'device' and (p.photo_path is null or p.latitude is null or p.longitude is null) then
    return 'A clock-in needs a selfie and your location.';                      -- R5.1.3
  end if;

  reason := private.clock_block_reason(p.user_id, private.clock_event(p.event_type, p.is_break), p.occurred_at);
  if reason is not null or p.source <> 'device' then
    return reason;
  end if;

  select s.max_accuracy_m into max_accuracy from public.daymark_settings s where s.id = 1;
  if p.accuracy_m is null or p.accuracy_m > max_accuracy then
    return 'Your location is too rough (± ' || coalesce(round(p.accuracy_m)::text || ' m', 'unknown')
      || '). Step outside or near a window and try again.';
  end if;

  site := private.site_for(p.user_id);
  metres := private.distance_metres(p.latitude, p.longitude, site.latitude, site.longitude);
  if metres > site.radius_m then
    return 'You''re ' || private.format_distance(metres) || ' from the office. Move closer to clock in.';  -- R5.1.2
  end if;
  return null;
end;
$$;

-- Location and selfie are both required to clock (Dilip, 5 Oct): no supervisor route any more.
create or replace function private.require_clocking_consent(person uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not (private.has_consent(person, 'location') and private.has_consent(person, 'selfie')) then
    raise exception 'Allow location and selfie to clock in. You can change this under Me → Privacy.'
      using errcode = 'P0001', hint = 'consent';
  end if;
end;
$$;

create or replace function private.start_clock(event_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  reason text;
  gestures text[] := array[
    'Hold up three fingers', 'Give a thumbs up', 'Touch your left ear', 'Touch your right ear',
    'Hold up two fingers', 'Put your hand flat under your chin', 'Point at the camera', 'Wave with an open hand'
  ];
  row public.daymark_clock_challenges%rowtype;
begin
  reason := private.clock_block_reason(me, start_clock.event_type, private.clock_now());
  if reason is not null then
    raise exception '%', reason using errcode = 'P0001';
  end if;
  perform private.require_clocking_consent(me);

  insert into public.daymark_clock_challenges (person_id, event_type, gesture, issued_at, expires_at)
  values (me, start_clock.event_type, gestures[1 + floor(random() * array_length(gestures, 1))::int],
          private.clock_now(), private.clock_now() + interval '90 seconds')
  returning * into row;

  return jsonb_build_object(
    'challenge_id', row.id, 'event_type', row.event_type, 'gesture', row.gesture,
    'expires_at', row.expires_at, 'photo_path', me || '/' || row.id || '.jpg'
  );
end;
$$;

create or replace function private.clock_punch(
  challenge_id uuid,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  client_reported_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  ch public.daymark_clock_challenges%rowtype;
  path text;
  saved public.daymark_punches%rowtype;
begin
  perform private.require_clocking_consent(me);

  select * into ch from public.daymark_clock_challenges c
  where c.id = clock_punch.challenge_id and c.person_id = me
  for update;
  if not found or ch.used_at is not null or private.clock_now() > ch.expires_at then
    raise exception 'That timed out. Tap the button again.' using errcode = 'P0001';
  end if;

  path := me || '/' || ch.id || '.jpg';
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'daymark-photos' and o.name = path and o.owner_id = me::text
      and o.created_at between ch.issued_real_at and ch.issued_real_at + interval '3 minutes'
  ) then
    raise exception 'We didn''t get your selfie. Take it again.' using errcode = 'P0001';
  end if;

  update public.daymark_clock_challenges set used_at = private.clock_now() where id = ch.id;

  insert into public.daymark_punches (
    user_id, event_type, is_break, latitude, longitude, accuracy_m, photo_path, source,
    client_reported_at, challenge_id, user_agent
  ) values (
    me,
    case ch.event_type when 'break_start' then 'shift_out' when 'break_end' then 'shift_in' else ch.event_type end,
    ch.event_type in ('break_start', 'break_end'),
    clock_punch.latitude, clock_punch.longitude, clock_punch.accuracy_m, path, 'device',
    clock_punch.client_reported_at, ch.id, private.request_user_agent()
  )
  returning * into saved;

  return to_jsonb(saved) || jsonb_build_object('clock_event', ch.event_type);
end;
$$;

-- The supervisor-confirmation route is gone (Dilip, 5 Oct). Punches already waiting for a
-- supervisor keep their attendance request and its approve/decline flow.
drop function public.request_supervisor_confirmation(text);
drop function private.request_supervisor_confirmation(text);

-- Home: the state (out, in, on a break) and what each next action would say.
create or replace function private.clock_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  now_ts timestamptz := private.clock_now();
  today date := private.darwin_today();
  pl public.daymark_placements%rowtype;
  last_event text;
  last_break boolean;
  last_at timestamptz;
  state text;
  next_event text;
  reason text;
  open_shift public.daymark_shifts%rowtype;
  day public.daymark_scheduled_days%rowtype;
begin
  pl := private.live_placement(me);
  if pl.id is null then
    select * into pl from public.daymark_placements p where p.id = private.current_placement(me);
  end if;

  select x.event_type, x.is_break, x.occurred_at into last_event, last_break, last_at
  from public.daymark_punches x
  where x.user_id = me and x.event_type in ('shift_in', 'shift_out')
  order by x.occurred_at desc, x.source = 'auto_close' desc, x.created_at desc
  limit 1;
  state := case
    when last_event = 'shift_in' then 'in'
    when last_event = 'shift_out' and last_break and (last_at at time zone 'Australia/Darwin')::date = today then 'break'
    else 'out'
  end;
  next_event := case state when 'in' then 'shift_out' when 'break' then 'break_end' else 'shift_in' end;
  reason := private.clock_block_reason(me, next_event, now_ts);

  select * into open_shift from public.daymark_shifts s
  where s.placement_id = pl.id and s.clock_out_at is null
  order by s.clock_in_at desc limit 1;

  select * into day from public.daymark_scheduled_days d
  where d.placement_id = pl.id and d.work_date = today and d.status in ('scheduled', 'leave');

  return jsonb_build_object(
    'server_now', now_ts,
    'today', today,
    'state', state,
    'next_event', next_event,
    'open_since', case when state = 'in' then last_at end,
    'break_since', case when state = 'break' then last_at end,
    'open_work_date', open_shift.work_date,
    'blocked', reason,
    'block_code', private.clock_block_code(reason),
    -- Every action the state allows, with its refusal (null = allowed).
    'actions', case state
      when 'in' then jsonb_build_object(
        'break_start', private.clock_block_reason(me, 'break_start', now_ts),
        'shift_out', private.clock_block_reason(me, 'shift_out', now_ts))
      when 'break' then jsonb_build_object('break_end', reason)
      else jsonb_build_object('shift_in', reason)
    end,
    'consent', private.my_consent(),
    'needs_consent', not (private.has_consent(me, 'location') and private.has_consent(me, 'selfie')),
    -- The office on the clock screen's drawn map (no third-party map tiles).
    'site', (select jsonb_build_object('name', s.name, 'latitude', s.latitude, 'longitude', s.longitude,
                                       'radius_m', s.radius_m)
             from public.daymark_sites s where s.id = pl.site_id),
    'scheduled', case when day.id is null then null else jsonb_build_object(
      'start', day.start_time, 'end', day.end_time, 'planned_minutes', day.planned_minutes, 'status', day.status,
      'leave_kind', day.leave_kind) end,
    'placement', case when pl.id is null then null else jsonb_build_object(
      'id', pl.id, 'status', pl.status, 'start_date', pl.start_date, 'planned_end_date', pl.planned_end_date,
      'ended_on', pl.ended_on, 'break_minutes', pl.break_minutes,
      'read_only', pl.status in ('completed', 'withdrawn'),
      'delete_on', case when pl.ended_on is not null then private.retention_date(pl.ended_on) end) end
  );
end;
$$;

create or replace function private.clock_block_code(reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when reason is null then null
    when reason ilike '%work log%' then 'work_log'
    when reason like '%placement has ended%' then 'read_only'
    when reason ilike '%full%' or reason like '%no room%' then 'full'
    when reason like '%paused%' then 'paused'
    when reason like '%don''t have a placement%' then 'no_placement'
    when reason like '%target hours%' then 'target_reached'
    when reason like 'Your placement starts%' then 'not_started'
    when reason like '%end date has passed%' then 'past_end'
    when reason like 'Breaks start%' then 'break_window'
    else 'sequence'
  end;
$$;

-- The office board shows an intern on a break as "On a break", not "Done".
create or replace function private.today_board(site uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  staff boolean := private.is_staff();
  s public.daymark_sites%rowtype;
  today date := private.darwin_today();
  now_ts timestamptz := private.clock_now();
  grace interval := make_interval(mins => (select g.grace_minutes from public.daymark_settings g where g.id = 1));
  n integer;
  people jsonb;
begin
  select * into s from public.daymark_sites x where x.id = private.my_site(site);
  if s.id is null or (not staff and s.id is distinct from (private.live_placement(me)).site_id) then
    raise exception 'You don''t have access to this office''s board.' using errcode = '42501';
  end if;

  select count(*) into n from public.daymark_scheduled_days d
  where d.site_id = s.id and d.work_date = today and d.status = 'scheduled';

  with days as (
    select d.*, p.intern_id, p.supervisor_id,
           row_number() over (partition by d.status order by d.created_at, d.id) as seq
    from public.daymark_scheduled_days d
    join public.daymark_placements p on p.id = d.placement_id
    where d.site_id = s.id and d.work_date = today and d.status in ('scheduled', 'leave')
  ), punched as (
    select x.user_id, max(p.supervisor_id::text)::uuid as supervisor_id,
           min(x.occurred_at) filter (where x.event_type = 'shift_in') as first_in,
           (array_agg(x.event_type order by x.occurred_at desc, x.created_at desc))[1] as last_event,
           (array_agg(x.is_break order by x.occurred_at desc, x.created_at desc))[1] as last_break
    from public.daymark_punches x
    join public.daymark_placements p on p.id = x.placement_id
    where p.site_id = s.id and x.event_type in ('shift_in', 'shift_out')
      and x.occurred_at >= private.darwin_at(today, '00:00') and x.occurred_at < private.darwin_at(today + 1, '00:00')
    group by x.user_id
  ), rows as (
    select coalesce(d.intern_id, pu.user_id) as person_id,
           coalesce(d.supervisor_id, pu.supervisor_id) as supervisor_id,
           d.status as day_status, d.start_time, d.end_time, d.seq, pu.first_in, pu.last_event, pu.last_break
    from days d
    full join punched pu on pu.user_id = d.intern_id
  ), shaped as (
    select r.*, pr.display_name,
      case
        when r.day_status = 'leave' then 'leave'
        when r.last_event = 'shift_in' then 'in'
        when r.last_event = 'shift_out' and r.last_break then 'break'
        when r.last_event = 'shift_out' then 'done'
        when now_ts >= private.darwin_at(today, r.end_time) then 'no_show'
        when now_ts > private.darwin_at(today, r.start_time) + grace then 'late'
        else 'not_in_yet'
      end as status,
      (r.start_time is not null and r.first_in > private.darwin_at(today, r.start_time) + grace) as late,
      (r.start_time is null) as unscheduled,
      (r.day_status = 'scheduled' and r.seq > s.standard_capacity) as extra,
      (private.is_admin() or r.supervisor_id = me) as mine
    from rows r
    join public.daymark_profiles pr on pr.id = r.person_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'display_name', x.display_name,
      'initials', upper(left(split_part(x.display_name, ' ', 1), 1) || left(split_part(x.display_name, ' ', 2), 1)),
      'status', x.status,
      'unscheduled', x.unscheduled,
      'me', x.person_id = me
    )
    || case when staff and x.mine then jsonb_build_object(
         'person_id', x.person_id, 'since', x.first_in, 'start', x.start_time, 'end', x.end_time,
         'late', x.late, 'extra', x.extra)
       else '{}'::jsonb end
    order by x.display_name), '[]')
  into people
  from shaped x;

  return jsonb_build_object(
    'date', today,
    'site', jsonb_build_object('id', s.id, 'name', s.name, 'standard_capacity', s.standard_capacity),
    'count', case when staff then n else least(n, s.standard_capacity) end,
    'label', private.capacity_label(n, s.standard_capacity, staff),
    'people', people
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Assigned break per intern. On days over the threshold (5 h) the unpaid break is the gaps
-- between sessions, topped up to the intern's break. Roster planned minutes use the same break.
-- ---------------------------------------------------------------------------
alter table public.daymark_placements
  add column break_minutes integer not null default 30 check (break_minutes between 0 and 120);

drop function private.planned_length(integer);
create or replace function private.planned_length(minutes integer, break_minutes integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select minutes - case when minutes > 300 then break_minutes else 0 end;   -- R5.2.4
$$;

-- planned_minutes was generated with a fixed 30; now a trigger fills it from the placement's break.
alter table public.daymark_scheduled_days alter column planned_minutes drop expression;

create or replace function private.set_planned_minutes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.planned_minutes := private.planned_length(
    (extract(epoch from (new.end_time - new.start_time)) / 60)::integer,
    coalesce((select p.break_minutes from public.daymark_placements p where p.id = new.placement_id), 30));
  return new;
end;
$$;

create trigger daymark_scheduled_days_planned
  before insert or update of start_time, end_time, placement_id, planned_minutes on public.daymark_scheduled_days
  for each row execute function private.set_planned_minutes();

-- A changed break re-plans today and later; past days keep the hours they were planned with.
create or replace function private.on_placement_break_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d date;
begin
  update public.daymark_scheduled_days s set planned_minutes = null
  where s.placement_id = new.id and s.work_date >= private.darwin_today();
  for d in
    select r.work_date from public.daymark_day_results r
    where r.placement_id = new.id and r.work_date >= private.darwin_today()
  loop
    perform private.recompute_day(new.id, d);
  end loop;
  return null;
end;
$$;

create trigger daymark_placements_break_changed
  after update of break_minutes on public.daymark_placements
  for each row
  when (old.break_minutes is distinct from new.break_minutes)
  execute function private.on_placement_break_changed();

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
  assigned_break integer;
  n_shifts integer;
  first_in timestamptz;
  last_out timestamptz;
  last_open boolean;
  last_auto boolean;
  raw_seconds numeric;
  gap_minutes integer;
  approved integer;
  staff_edited boolean;
begin
  select * into st from public.daymark_settings s where s.id = 1;
  select p.break_minutes into assigned_break from public.daymark_placements p where p.id = placement;
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
         coalesce(floor(sum(extract(epoch from greatest(c.gap, interval '0'))) / 60), 0)::integer
  into raw_seconds, gap_minutes
  from c;

  r.placement_id := placement;
  r.work_date := work_date;
  r.raw := floor(raw_seconds / 60)::integer;                                        -- R5.4.1
  -- R5.4.2 (Dilip, 5 Oct): breaks taken are unpaid gaps; a long day tops them up to the assigned break.
  r.break := case when r.raw > st.break_threshold_minutes
                  then greatest(0, coalesce(assigned_break, st.break_minutes) - gap_minutes) else 0 end;
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
  -- A staff time edit is the approval (Dilip, 5 Oct): that day's time beyond the roster counts.
  -- ponytail: day-level, so a later self-clocked session that day counts too. Upgrade: per-shift.
  select exists (
    select 1 from public.daymark_shifts s
    join public.daymark_punches x on x.id in (s.in_punch_id, s.out_punch_id)
    where s.placement_id = placement and s.work_date = compute_day.work_date and x.source = 'staff_edit'
  ) into staff_edited;
  if staff_edited then
    r.approved_ot := r.overtime;
  end if;
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

-- save_placement takes break_minutes (blank: the default break from Settings).
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
  if v_start is null or v_end is null or v_end < v_start then
    raise exception 'The planned end date must be on or after the start date.' using errcode = '22023';
  end if;
  if v_target is null or v_target not between 60 and 120000 then
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
      break_minutes = coalesce(v_break, q.break_minutes),
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

-- ---------------------------------------------------------------------------
-- 5. Staff edit clock times: the admin, or the intern's supervisor, replaces a clock-in and/or
-- clock-out (originals are kept, like a punch fix) or adds a missing session. Audited; the intern
-- is told. The editor is stored in confirmed_by.
-- ---------------------------------------------------------------------------
create or replace function private.staff_edit_times(
  placement uuid,
  work_date date,
  clock_in time,
  clock_out time,
  replaces_in uuid,
  replaces_out uuid,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype := private.require_placement_manager(placement);
  me uuid := (select auth.uid());
  clean text := btrim(reason);
  site public.daymark_sites%rowtype;
  req public.daymark_requests%rowtype;
  err text;
  before_times jsonb;
  saved jsonb;
  times text;
begin
  if clean is null or char_length(clean) not between 5 and 200 then
    raise exception 'Give a reason of 5 to 200 characters.' using errcode = '22023';
  end if;
  if clock_in is null and clock_out is null then
    raise exception 'Enter a clock-in or a clock-out time.' using errcode = '22023';
  end if;
  if work_date is null or work_date < pl.start_date then
    raise exception 'Pick a day inside the placement.' using errcode = '22023';
  end if;

  -- Same checks as an intern's punch fix: in the past, out after in, the punches are theirs on
  -- that day, no overlap with another session. ponytail: no overnight edits (as punch fixes).
  select s.* into site from public.daymark_sites s where s.id = pl.site_id;
  req.intern_id := pl.intern_id;
  req.payload := jsonb_build_object('date', work_date, 'clock_in', clock_in, 'clock_out', clock_out,
    'replaces_in_punch_id', replaces_in, 'replaces_out_punch_id', replaces_out);
  err := private.punch_fix_error(req, site);
  if err is not null then
    raise exception '%', err using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'event_type', x.event_type, 'occurred_at', x.occurred_at)
                            order by x.occurred_at), '[]'::jsonb)
  into before_times
  from public.daymark_punches x where x.id in (replaces_in, replaces_out);

  with ins as (
    insert into public.daymark_punches (user_id, placement_id, event_type, is_break, occurred_at, source,
                                        verification_method, replaces_punch_id, confirmed_by, confirmed_at)
    select pl.intern_id, pl.id, x.event_type,
           coalesce((select o.is_break from public.daymark_punches o where o.id = x.replaces), false),
           private.darwin_at(work_date, x.t), 'staff_edit', 'staff_edit', x.replaces, me, private.clock_now()
    from (values ('shift_in', clock_in, replaces_in), ('shift_out', clock_out, replaces_out)) x (event_type, t, replaces)
    where x.t is not null
    order by x.t
    returning *
  )
  select jsonb_agg(to_jsonb(ins) order by ins.occurred_at) into saved from ins;

  perform private.audit('staff_edit_times', 'daymark_placements', pl.id::text,
    jsonb_build_object('work_date', work_date, 'punches', before_times),
    jsonb_build_object('work_date', work_date, 'clock_in', clock_in, 'clock_out', clock_out, 'reason', clean));

  times := concat_ws(' and ',
    case when clock_in is not null then 'clock-in ' || private.fmt_clock(clock_in) end,
    case when clock_out is not null then 'clock-out ' || private.fmt_clock(clock_out) end);
  perform private.notify(pl.intern_id, 'times', 'Your clock times changed',
    coalesce((select x.display_name from public.daymark_profiles x where x.id = me), 'Your supervisor')
      || ' set your ' || times || ' on ' || private.fmt_day(work_date) || '. Reason: ' || clean,
    '/clock/schedule');
  return jsonb_build_object('punches', saved);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Catch-up: the intern picks free office days; each becomes an extra-day request.
-- ---------------------------------------------------------------------------
drop function public.catch_up_options(uuid);
drop function public.submit_catch_up(uuid, text);
drop function private.submit_catch_up(uuid, text);
drop function private.catch_up_plan(uuid);

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
                           pl.planned_end_date, interval '1 day') g(d)
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

-- One transaction: every picked day becomes an extra-day request, checked like any other.
create or replace function private.submit_catch_up_days(placement uuid, days jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  created jsonb := '[]';
begin
  if not exists (select 1 from public.daymark_placements p where p.id = placement and p.intern_id = (select auth.uid())) then
    raise exception 'Only the intern sends their catch-up requests.' using errcode = '42501';
  end if;
  if jsonb_typeof(days) is distinct from 'array' or jsonb_array_length(days) not between 1 and 20 then
    raise exception 'Pick between 1 and 20 days.' using errcode = '22023';
  end if;
  if (select count(distinct x ->> 'date') from jsonb_array_elements(days) x) <> jsonb_array_length(days) then
    raise exception 'Pick each day once.' using errcode = '22023';
  end if;
  for item in select * from jsonb_array_elements(days) loop
    created := created || private.create_request('extra_day',
      jsonb_build_object('date', item ->> 'date', 'start', item ->> 'start', 'end', item ->> 'end'), 'Catch-up');
  end loop;
  return jsonb_build_object('requests', created);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Collection notice v1.2: breaks take a selfie and location too, and both are required to clock.
-- Publishing makes it current, so every intern acknowledges it before their next clock-in.
-- ---------------------------------------------------------------------------
do $$
declare
  current_version text := (select s.notice_version from public.daymark_settings s where s.id = 1);
  n public.daymark_notices%rowtype;
  body text;
  new_version text := '1.2';
begin
  select * into n from public.daymark_notices x where x.version = current_version;
  body := n.body;
  body := replace(body, '- Location, only when you tap Clock in or Clock out:',
    '- Location, only when you tap Clock in, Start break, End break or Clock out:');
  body := replace(body, '- Selfie, only when you tap Clock in or Clock out:',
    '- Selfie, only when you tap Clock in, Start break, End break or Clock out:');
  body := replace(body,
    'Location and selfie are optional. If you don''t agree, you clock in by asking your supervisor to confirm you''re at the office, and those hours count once they confirm. Saying no will not affect your placement or assessment.',
    'You need to allow location and a selfie to clock in, take a break or clock out. If you don''t, you can''t use DGK Clock to record hours; talk to the DGK admin.');
  body := replace(body,
    'refuses a clock-in that is outside the office area.',
    'refuses a clock-in that is outside the office area, and a clock-out before that day''s work log is written.');
  if body not like '%You need to allow location and a selfie%' or body not like '%Start break, End break%' then
    raise exception 'The collection notice wording changed; update the location, selfie and "If you say no" text by hand.';
  end if;

  if exists (select 1 from public.daymark_notices x where x.version = new_version) then
    new_version := '1.2-' || to_char(private.darwin_today(), 'YYYYMMDD');
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

-- ---------------------------------------------------------------------------
-- Public wrappers and grants
-- ---------------------------------------------------------------------------
create or replace function public.staff_edit_times(
  placement uuid, work_date date, clock_in time default null, clock_out time default null,
  replaces_in uuid default null, replaces_out uuid default null, reason text default null
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.staff_edit_times(placement, work_date, clock_in, clock_out, replaces_in, replaces_out, reason); $$;

create or replace function public.catch_up_slots(placement uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.catch_up_slots(placement); $$;

create or replace function public.submit_catch_up_days(placement uuid, days jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.submit_catch_up_days(placement, days); $$;

revoke all on function private.clock_event(text, boolean) from public, anon;
revoke all on function private.clock_block_code(text) from public, anon;
revoke all on function private.planned_length(integer, integer) from public, anon;
revoke all on function private.set_planned_minutes() from public, anon, authenticated;
revoke all on function private.on_placement_break_changed() from public, anon, authenticated;
revoke all on function private.staff_edit_times(uuid, date, time, time, uuid, uuid, text) from public, anon;
revoke all on function private.catch_up_slots(uuid) from public, anon;
revoke all on function private.submit_catch_up_days(uuid, jsonb) from public, anon;
revoke all on function public.staff_edit_times(uuid, date, time, time, uuid, uuid, text) from public, anon;
revoke all on function public.catch_up_slots(uuid) from public, anon;
revoke all on function public.submit_catch_up_days(uuid, jsonb) from public, anon;

grant execute on function private.clock_event(text, boolean) to authenticated;
grant execute on function private.clock_block_code(text) to authenticated;
grant execute on function private.planned_length(integer, integer) to authenticated;
grant execute on function private.staff_edit_times(uuid, date, time, time, uuid, uuid, text) to authenticated;
grant execute on function private.catch_up_slots(uuid) to authenticated;
grant execute on function private.submit_catch_up_days(uuid, jsonb) to authenticated;
grant execute on function public.staff_edit_times(uuid, date, time, time, uuid, uuid, text) to authenticated;
grant execute on function public.catch_up_slots(uuid) to authenticated;
grant execute on function public.submit_catch_up_days(uuid, jsonb) to authenticated;

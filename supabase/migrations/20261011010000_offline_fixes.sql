-- Offline clock fixes from code review (D35 follow-up):
-- 1. A selfie can't be reused: an offline id that is a live clock's challenge id, or whose photo path is
--    already on another punch, is refused. The gesture must be one the app asks for.
-- 2. Offline clocks can be sent up to 7 days late (the same week the supervisor has to confirm them).
-- 3. A typed-in time sent later lands on the day it was typed for (submit_offline_typed), not on today.

-- ---------------------------------------------------------------------------
-- 1. One gesture list for the live challenge and offline clocks
-- ---------------------------------------------------------------------------
create or replace function private.clock_gestures()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'Hold up three fingers', 'Give a thumbs up', 'Touch your left ear', 'Touch your right ear',
    'Hold up two fingers', 'Put your hand flat under your chin', 'Point at the camera', 'Wave with an open hand'
  ]::text[];
$$;
revoke all on function private.clock_gestures() from public, anon, authenticated;

-- Copied from 20261008010000_flexible_clock_absent.sql; only the gesture list moved to clock_gestures().
create or replace function private.start_clock(event_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  reason text;
  gestures text[] := private.clock_gestures();
  row public.daymark_clock_challenges%rowtype;
begin
  reason := private.clock_block_reason(me, start_clock.event_type, private.clock_now());
  if reason is not null then
    raise exception '%', reason using errcode = 'P0001';
  end if;
  perform private.require_clocking_consent(me);
  if start_clock.event_type = 'shift_in' then
    perform private.require_day_kind(me);
  end if;

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

-- ---------------------------------------------------------------------------
-- 2. Offline clocks: no reused selfie, a known gesture, up to 7 days late
-- (Copied from 20261009010000_offline_clock.sql; the changes are marked "review".)
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

  -- review: the selfie path is built from the offline id, so a live clock's challenge id (or any id whose
  -- photo is already on a punch) would reuse an old selfie for a new clock.
  if exists (select 1 from public.daymark_clock_challenges c where c.id = submit_offline_punch.offline_id)
     or exists (select 1 from public.daymark_punches x where x.photo_path = path) then
    raise exception 'That selfie was already used for another clock.' using errcode = '42501';
  end if;

  if action is null or action not in ('shift_in', 'break_start', 'break_end', 'shift_out') then
    raise exception 'Use Start, Break and Finish.' using errcode = '22023';
  end if;
  if gesture is not null and not (gesture = any (private.clock_gestures())) then                  -- review
    raise exception 'That gesture isn''t one DGK Clock asks for. Update the app and clock again.' using errcode = '22023';
  end if;
  if occurred_at is null or occurred_at > private.clock_now() + interval '2 minutes' then
    raise exception 'That clock''s time is in the future. Check your phone''s clock.' using errcode = '22023';
  end if;
  if occurred_at < private.clock_now() - interval '7 days' then                                   -- review: was 2 days
    raise exception 'That offline clock is more than 7 days old. Ask your supervisor to add the time.' using errcode = '22023';
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

-- ---------------------------------------------------------------------------
-- 3. Typed-in times sent later: the phone sends the full timestamp, so the time lands on its own day.
-- report_missed_time stays for online use (today only).
-- ---------------------------------------------------------------------------
create or replace function private.submit_offline_typed(offline_id uuid, event text, at timestamptz, note text, day_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  pl public.daymark_placements%rowtype := private.live_placement(me);
  existing public.daymark_punches%rowtype;
  on_date date := (submit_offline_typed.at at time zone 'Australia/Darwin')::date;
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
  if submit_offline_typed.offline_id is null then
    raise exception 'That typed-in time has no id.' using errcode = '22023';
  end if;

  -- Sent twice (a retry after a dropped reply): hand back the first one.
  select * into existing from public.daymark_punches x where x.offline_id = submit_offline_typed.offline_id;
  if found then
    if existing.user_id <> me then
      raise exception 'That typed-in time belongs to someone else.' using errcode = '42501';
    end if;
    return jsonb_build_object('punch_id', existing.id, 'occurred_at', existing.occurred_at);
  end if;

  if event is null or event not in ('shift_in', 'break_end') then
    raise exception 'Pick when you arrived or when your break ended.' using errcode = '22023';
  end if;
  if submit_offline_typed.at is null then
    raise exception 'Enter the time.' using errcode = '22023';
  end if;
  if char_length(coalesce(clean, '')) > 200 then
    raise exception 'Keep the note under 200 characters.' using errcode = '22023';
  end if;
  if submit_offline_typed.at > private.clock_now() + interval '2 minutes' then
    raise exception 'That time hasn''t happened yet.' using errcode = '22023';
  end if;
  if submit_offline_typed.at < private.clock_now() - interval '7 days' then
    raise exception 'That time is more than 7 days ago. Ask your supervisor to add the time.' using errcode = '22023';
  end if;
  perform private.require_clocking_consent(me);

  -- Same rule as report_missed_time: the typed time comes after the last clock. The punch rules
  -- trigger then checks the order (no clock-in while clocked in, a break end only on a break).
  -- ponytail: a time typed for an earlier day is refused once a later clock exists; the supervisor adds it
  -- on Timesheets. Upgrade path: slot it between punches and re-check the day's sequence.
  select max(x.occurred_at) into last_at from public.daymark_punches x
  where x.user_id = me and x.event_type in ('shift_in', 'shift_out');
  if last_at is not null and submit_offline_typed.at <= last_at then
    raise exception 'Pick a time after your last clock (% on %).',
      private.fmt_clock((last_at at time zone 'Australia/Darwin')::time),
      private.fmt_day((last_at at time zone 'Australia/Darwin')::date)
      using errcode = '22023';
  end if;

  -- The first clock-in of that day carries the day's kind.
  if event = 'shift_in' and not exists (
    select 1 from public.daymark_day_kinds d where d.placement_id = pl.id and d.work_date = on_date
  ) then
    if day_kind is null then
      raise exception 'Pick Full day or Work-based before you clock in.' using errcode = 'P0001', hint = 'day_kind';
    end if;
    perform private.save_day_kind(pl, on_date, day_kind);
  end if;

  insert into public.daymark_punches (user_id, event_type, is_break, source, occurred_at, verification_method,
                                      offline_id, user_agent)
  values (me, 'shift_in', event = 'break_end', 'supervisor', submit_offline_typed.at, 'supervisor',
          submit_offline_typed.offline_id, private.request_user_agent())
  returning id into punch;

  what := case event when 'shift_in' then 'arrived at ' else 'ended their break at ' end
          || private.fmt_clock((submit_offline_typed.at at time zone 'Australia/Darwin')::time)
          || ' on ' || private.fmt_day(on_date);
  perform private.request_punch_confirmation(pl, punch, 'shift_in', 'Typed in (offline): ' || what || coalesce('. ' || clean, ''),
    name || ' typed in a time', name || ' ' || what || '.');
  return jsonb_build_object('punch_id', punch, 'occurred_at', submit_offline_typed.at);
end;
$$;

create or replace function public.submit_offline_typed(
  offline_id uuid, event text, at timestamptz, note text default null, day_kind text default null
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.submit_offline_typed(offline_id, event, at, note, day_kind); $$;

revoke all on function private.submit_offline_typed(uuid, text, timestamptz, text, text) from public, anon;
revoke all on function public.submit_offline_typed(uuid, text, timestamptz, text, text) from public, anon;
grant execute on function private.submit_offline_typed(uuid, text, timestamptz, text, text) to authenticated;
grant execute on function public.submit_offline_typed(uuid, text, timestamptz, text, text) to authenticated;

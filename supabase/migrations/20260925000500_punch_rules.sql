-- Phase 1: new punch rules (R5.1.1–R5.1.5, R5.1.7) and the security review's clocking
-- controls: server time, single-use challenges with a gesture, selfie ownership, accuracy
-- cap, one punch per minute, fraud flags, no third-party geocoding.

drop trigger if exists daymark_punches_sequence on public.daymark_punches;
drop function if exists private.enforce_punch_sequence();
drop policy if exists "Staff can insert their own punches" on public.daymark_punches;
drop policy if exists "Admins can delete clock photos" on storage.objects;  -- D12

create table public.daymark_clock_challenges (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.daymark_profiles (id) on delete cascade,
  event_type text not null check (event_type in ('shift_in', 'shift_out')),
  gesture text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create index daymark_clock_challenges_person_idx on public.daymark_clock_challenges (person_id, issued_at desc);

alter table public.daymark_clock_challenges enable row level security;
create policy "People read their own challenges" on public.daymark_clock_challenges
  for select to authenticated using (person_id = (select auth.uid()));
revoke all on table public.daymark_clock_challenges from public, anon, authenticated;
grant select on table public.daymark_clock_challenges to authenticated;
grant all on table public.daymark_clock_challenges to service_role;

alter table public.daymark_punches
  alter column latitude drop not null,
  alter column longitude drop not null,
  alter column photo_path drop not null,
  add column source text not null default 'device'
    check (source in ('device', 'auto_close', 'punch_fix', 'supervisor')),
  add column verification_method text
    check (verification_method in ('gps_selfie', 'supervisor', 'punch_fix')),
  add column replaces_punch_id uuid references public.daymark_punches (id) on delete cascade,
  add column distance_m double precision,
  add column client_reported_at timestamptz,
  add column flags text[] not null default '{}',
  add column challenge_id uuid unique references public.daymark_clock_challenges (id) on delete set null,
  add column user_agent text,
  add constraint daymark_punches_device_evidence check (
    source <> 'device' or (photo_path is not null and latitude is not null and longitude is not null)
  );

create index daymark_punches_replaces_idx on public.daymark_punches (replaces_punch_id);

-- ponytail: one site today; Phase 2 reads the site from the intern's placement.
create or replace function private.site_for(person uuid)
returns public.daymark_sites
language sql
stable
security definer
set search_path = ''
as $$
  select s.* from public.daymark_sites s where s.active order by s.created_at limit 1;
$$;

create or replace function private.format_distance(metres double precision)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when metres < 1000 then round(metres)::text || ' m'
              else trim(to_char(round(metres / 100.0) / 10, 'FM999990.0')) || ' km' end;
$$;

-- Why this person can't make this punch at this time (not location), or null.
create or replace function private.clock_block_reason(person uuid, event_type text, at timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.daymark_profiles%rowtype;
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

  site := private.site_for(person);
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
    return 'Breaks are no longer clocked. Just clock in and out.';               -- R5.1.4
  end if;
  if p.source in ('auto_close', 'punch_fix') then
    return null;                                                                 -- R5.1.7 trusted system punches
  end if;
  if p.source = 'device' and (p.photo_path is null or p.latitude is null or p.longitude is null) then
    return 'A clock-in needs a selfie and your location.';                      -- R5.1.3
  end if;

  reason := private.clock_block_reason(p.user_id, p.event_type, p.occurred_at);
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

-- Fraud signals: flag, don't block (review rule 9).
create or replace function private.punch_flags(p public.daymark_punches)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when p.accuracy_m <= 3 then 'suspicious_accuracy' end,
    case when p.accuracy_m > 50 then 'low_accuracy' end,
    case when exists (
      select 1 from public.daymark_punches x
      where x.user_id = p.user_id and x.source = 'device'
        and (x.occurred_at at time zone 'Australia/Darwin')::date <> (p.occurred_at at time zone 'Australia/Darwin')::date
        and round(x.latitude::numeric, 5) = round(p.latitude::numeric, 5)
        and round(x.longitude::numeric, 5) = round(p.longitude::numeric, 5)
    ) then 'repeat_coords' end,
    case when p.user_agent !~* '(android|iphone|ipad|ipod|mobile)' then 'desktop_ua' end,
    case when p.user_agent is not null
      and exists (select 1 from public.daymark_punches x where x.user_id = p.user_id and x.source = 'device')
      and not exists (select 1 from public.daymark_punches x where x.user_id = p.user_id and x.user_agent = p.user_agent)
      then 'new_device' end
  ], null);
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

create trigger daymark_punches_rules
  before insert on public.daymark_punches
  for each row execute function private.punch_rules();

create or replace function private.require_clocking_consent(person uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not (private.has_consent(person, 'location') and private.has_consent(person, 'selfie')) then
    raise exception 'Choose how you''ll clock in first: allow location and selfie, or ask your supervisor to confirm you.'
      using errcode = 'P0001', hint = 'consent';
  end if;
end;
$$;

-- Step 1: check the person may clock now, then issue a 90-second single-use challenge.
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
  if start_clock.event_type not in ('shift_in', 'shift_out') then
    raise exception 'Breaks are no longer clocked. Just clock in and out.' using errcode = 'P0001';
  end if;
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

-- Step 2: after the live selfie is uploaded to <me>/<challenge>.jpg, record the punch.
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
    raise exception 'That clock-in timed out. Tap Clock in again.' using errcode = 'P0001';
  end if;

  path := me || '/' || ch.id || '.jpg';
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'daymark-photos' and o.name = path and o.owner_id = me::text
      and o.created_at between ch.issued_at and ch.issued_at + interval '3 minutes'
  ) then
    raise exception 'We didn''t get your selfie. Take it again.' using errcode = 'P0001';
  end if;

  update public.daymark_clock_challenges set used_at = private.clock_now() where id = ch.id;

  insert into public.daymark_punches (
    user_id, event_type, latitude, longitude, accuracy_m, photo_path, source,
    client_reported_at, challenge_id, user_agent
  ) values (
    me, ch.event_type, clock_punch.latitude, clock_punch.longitude, clock_punch.accuracy_m, path, 'device',
    clock_punch.client_reported_at, ch.id, private.request_user_agent()
  )
  returning * into saved;

  return to_jsonb(saved);
end;
$$;

create or replace function public.start_clock(event_type text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.start_clock(event_type); $$;

create or replace function public.clock_punch(
  challenge_id uuid, latitude double precision, longitude double precision,
  accuracy_m double precision, client_reported_at timestamptz default null
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.clock_punch(challenge_id, latitude, longitude, accuracy_m, client_reported_at); $$;

revoke insert, update, delete on table public.daymark_punches from anon, authenticated;

revoke all on function private.site_for(uuid) from public, anon;
revoke all on function private.format_distance(double precision) from public, anon;
revoke all on function private.clock_block_reason(uuid, text, timestamptz) from public, anon;
revoke all on function private.punch_rule_error(public.daymark_punches) from public, anon;
revoke all on function private.punch_flags(public.daymark_punches) from public, anon, authenticated;
revoke all on function private.punch_rules() from public, anon, authenticated;
revoke all on function private.require_clocking_consent(uuid) from public, anon;
revoke all on function private.start_clock(text) from public, anon;
revoke all on function private.clock_punch(uuid, double precision, double precision, double precision, timestamptz) from public, anon;
revoke all on function public.start_clock(text) from public, anon;
revoke all on function public.clock_punch(uuid, double precision, double precision, double precision, timestamptz) from public, anon;
grant execute on function private.site_for(uuid) to authenticated;
grant execute on function private.format_distance(double precision) to authenticated;
grant execute on function private.clock_block_reason(uuid, text, timestamptz) to authenticated;
grant execute on function private.punch_rule_error(public.daymark_punches) to authenticated;
grant execute on function private.require_clocking_consent(uuid) to authenticated;
grant execute on function private.start_clock(text) to authenticated;
grant execute on function private.clock_punch(uuid, double precision, double precision, double precision, timestamptz) to authenticated;
grant execute on function public.start_clock(text) to authenticated;
grant execute on function public.clock_punch(uuid, double precision, double precision, double precision, timestamptz) to authenticated;

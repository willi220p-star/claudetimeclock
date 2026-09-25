-- Test helpers shared by every pgTAP file. Runs first (files run in name order) and is
-- committed on purpose so later files can use it. `supabase db reset` removes it.
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

-- A person with a login. Local test password only.
create or replace function tests.create_person(
  p_email text,
  p_intern boolean default true,
  p_supervisor boolean default false,
  p_admin boolean default false,
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email,
    extensions.crypt('Password-1234', extensions.gen_salt('bf', 4)), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );
  insert into public.daymark_profiles (id, login_id, display_name, is_intern, is_supervisor, is_admin, contact_email)
  values (uid, 't' || left(replace(uid::text, '-', ''), 12), coalesce(p_name, split_part(p_email, '@', 1)),
          p_intern, p_supervisor, p_admin, p_email);
  return uid;
end;
$$;

-- Act as a signed-in person for the rest of the transaction.
create or replace function tests.as_person(p_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_id::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- Freeze the business clock (read by private.clock_now()) for this transaction.
create or replace function tests.at(p_ts text)
returns void
language sql
as $$
  select set_config('daymark.test_now', p_ts, true);
$$;


-- Give every clocking consent as the person.
create or replace function tests.consent_all(p_person uuid)
returns void
language plpgsql
as $$
begin
  perform tests.as_person(p_person);
  perform public.record_consent('collection_notice', 'acknowledged');
  perform public.record_consent('location', 'granted');
  perform public.record_consent('selfie', 'granted');
  perform set_config('role', 'postgres', true);
end;
$$;

-- The whole device clocking flow at a frozen time: challenge, selfie upload, punch.
create or replace function tests.clock(
  p_person uuid,
  p_event text,
  p_at text,
  p_lat double precision default -12.4785082,
  p_lng double precision default 130.9854825,
  p_acc double precision default 10,
  p_photo boolean default true
)
returns jsonb
language plpgsql
as $$
declare
  challenge jsonb;
  result jsonb;
begin
  perform tests.at(p_at);
  perform tests.as_person(p_person);
  challenge := public.start_clock(p_event);
  perform set_config('role', 'postgres', true);
  if p_photo then
    insert into storage.objects (bucket_id, name, owner, owner_id, created_at)
    values ('daymark-photos', p_person || '/' || (challenge ->> 'challenge_id') || '.jpg',
            p_person, p_person::text, now());
  end if;
  perform tests.as_person(p_person);
  result := public.clock_punch((challenge ->> 'challenge_id')::uuid, p_lat, p_lng, p_acc, '2020-01-01 00:00+00');
  perform set_config('role', 'postgres', true);
  return result;
end;
$$;

-- Metres north of the office as a latitude (haversine along a meridian is exact).
create or replace function tests.north(p_metres double precision)
returns double precision
language sql
immutable
as $$
  select -12.4785082 + p_metres / (6371000 * pi() / 180);
$$;

-- A supervisor shared by test placements.
create or replace function tests.supervisor()
returns uuid
language plpgsql
as $$
declare
  sid uuid;
begin
  select p.id into sid from public.daymark_profiles p where p.contact_email = 'test.supervisor@test.dev';
  if sid is null then
    sid := tests.create_person('test.supervisor@test.dev', false, true, false, 'Test Supervisor');
  end if;
  return sid;
end;
$$;

-- An intern with a live placement and a weekly pattern (weekdays as ISO numbers).
-- Each call gets its own copy of the Regus site unless p_site is given, so capacity
-- only matters in tests that share a site on purpose.
create or replace function tests.create_intern(
  p_email text,
  p_site uuid default null,
  p_weekdays int[] default '{1,2,3,4,5}',
  p_start date default '2026-09-28',
  p_end date default '2026-12-18',
  p_from time default '09:00',
  p_to time default '17:00',
  p_target integer default 24000
)
returns uuid
language plpgsql
as $$
declare
  iid uuid := tests.create_person(p_email);
  site uuid := p_site;
  pl uuid;
  ver uuid;
begin
  if site is null then
    insert into public.daymark_sites (name, address, latitude, longitude)
    values ('Test site ' || p_email, 'Test address', -12.4785082, 130.9854825)
    returning id into site;
  end if;
  insert into public.daymark_placements (intern_id, supervisor_id, site_id, university, course,
    start_date, planned_end_date, original_end_date, target_minutes)
  values (iid, tests.supervisor(), site, 'Charles Darwin University', 'Bachelor of Business',
    p_start, p_end, p_end, p_target)
  returning id into pl;
  insert into public.daymark_pattern_versions (placement_id, effective_from) values (pl, p_start) returning id into ver;
  insert into public.daymark_pattern_days (pattern_version_id, weekday, start_time, end_time)
  select ver, w, p_from, p_to from unnest(p_weekdays) w;
  perform private.regenerate(pl, p_start, false);
  return iid;
end;
$$;

-- Tests that count across all placements run without the local seed (removed inside the test's
-- own transaction, so the rollback brings it back).
create or replace function tests.without_seed()
returns void
language sql
as $$
  delete from public.daymark_placements p using public.daymark_profiles x
  where x.id = p.intern_id and x.contact_email like '%@dgk.test';
$$;

grant execute on all functions in schema tests to anon, authenticated;

select plan(1);
select has_function('tests', 'create_person', 'test helpers are installed');
select * from finish();

-- Phase 3 helpers ------------------------------------------------------------------------

-- A shift from Darwin wall-clock times ('2026-10-14 09:00'). Trusted system punches
-- (punch_fix by default) skip the device flow, so hours tests can use any time.
create or replace function tests.shift(p_person uuid, p_in text, p_out text default null, p_source text default 'punch_fix')
returns void
language plpgsql
as $$
begin
  insert into public.daymark_punches (user_id, event_type, source, occurred_at)
  values (p_person, 'shift_in', p_source, (p_in || '+09:30')::timestamptz);
  if p_out is not null then
    insert into public.daymark_punches (user_id, event_type, source, occurred_at)
    values (p_person, 'shift_out', p_source, (p_out || '+09:30')::timestamptz);
  end if;
end;
$$;

create or replace function tests.placement(p_person uuid)
returns uuid
language sql
stable
as $$
  select private.current_placement(p_person);
$$;

-- The stored day result for a person's placement on a date.
create or replace function tests.day(p_person uuid, p_date date)
returns public.daymark_day_results
language sql
stable
as $$
  select r.* from public.daymark_day_results r
  where r.placement_id = tests.placement(p_person) and r.work_date = p_date;
$$;

grant execute on all functions in schema tests to anon, authenticated;

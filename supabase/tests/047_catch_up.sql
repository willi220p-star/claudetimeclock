begin;
select plan(13);

insert into public.daymark_sites (id, name, address, latitude, longitude)
values ('00000000-0000-0000-0000-0000000e0047', 'Catch-up site', 'Test', -12.4785082, 130.9854825);
-- Mondays 9:00–1:00 (240 min, no break) from 28 Sep; nothing clocked → two no-shows by Wed 7 Oct.
-- Tuesdays are full (3/3) at this site.
create temp table ids as
select tests.create_intern('cu@test.dev', '00000000-0000-0000-0000-0000000e0047', '{1}', '2026-09-28', '2026-10-30', '09:00', '13:00') as i,
       tests.create_intern('cf1@test.dev', '00000000-0000-0000-0000-0000000e0047', '{2}', '2026-09-28', '2026-10-30') as f1,
       tests.create_intern('cf2@test.dev', '00000000-0000-0000-0000-0000000e0047', '{2}', '2026-09-28', '2026-10-30') as f2,
       tests.create_intern('cf3@test.dev', '00000000-0000-0000-0000-0000000e0047', '{2}', '2026-09-28', '2026-10-30') as f3,
       tests.create_intern('cok@test.dev') as ok_intern;
grant select on ids to authenticated;
create temp table out (k text primary key, v jsonb);
grant all on out to authenticated;
select tests.at('2026-10-07 10:00+09:30');

-- The intern sees free office days to pick from (Dilip, 5 Oct): no "longer days" plan any more.
select hasnt_function('public', 'catch_up_options', array['uuid'], 'the old two-option plan is gone');
select tests.as_person((select i from ids));
insert into out values ('slots', public.catch_up_slots(private.current_placement((select i from ids))));
reset role;
select is(((select v from out where k = 'slots') ->> 'owed_minutes')::int, 480, 'two missed Mondays owe 8h');
select is((select v -> 'usual' from out where k = 'slots'), '{"start":"09:00","end":"13:00"}'::jsonb, 'with their usual times');
select is((select v #>> '{days,0}' from out where k = 'slots')::jsonb, '{"date":"2026-10-09","free":3}'::jsonb,
  'the first free day is Friday (Thursday 9:00 am is under 24 hours away), with its free spots');
select ok(not exists (select 1 from out, jsonb_array_elements(v -> 'days') x
                      where k = 'slots' and extract(isodow from (x ->> 'date')::date) = 2), 'full Tuesdays are never offered');
select ok(not exists (select 1 from out, jsonb_array_elements(v -> 'days') x
                      where k = 'slots' and extract(isodow from (x ->> 'date')::date) in (1, 6, 7)),
  'nor their rostered Mondays or weekends');

-- Picked days become extra-day requests in one go, for the supervisor to approve
select tests.as_person((select i from ids));
insert into out values ('sent', public.submit_catch_up_days(private.current_placement((select i from ids)),
  '[{"date":"2026-10-09","start":"09:00","end":"13:00"},{"date":"2026-10-14","start":"09:00","end":"17:00"}]'));
reset role;
select is((select count(*)::int from public.daymark_requests where intern_id = (select i from ids) and type = 'extra_day'
           and status = 'pending_supervisor' and reason = 'Catch-up'), 2, 'two extra-day requests wait for the supervisor');
select tests.as_person((select i from ids));
select ok(not exists (select 1 from jsonb_array_elements(public.catch_up_slots(private.current_placement((select i from ids))) -> 'days') x
                      where x ->> 'date' in ('2026-10-09', '2026-10-14')), 'days already asked for drop off the list');
select throws_ok($$select public.submit_catch_up_days(private.current_placement((select i from ids)), '[]')$$,
  '22023', 'Pick between 1 and 20 days.', 'at least one day');
select throws_ok($$select public.submit_catch_up_days(private.current_placement((select i from ids)),
  '[{"date":"2026-10-15","start":"09:00","end":"13:00"},{"date":"2026-10-15","start":"13:00","end":"17:00"}]')$$,
  '22023', 'Pick each day once.', 'each day once');
select throws_ok($$select public.submit_catch_up_days(private.current_placement((select i from ids)),
  '[{"date":"2026-10-08","start":"09:00","end":"13:00"}]')$$,
  'P0001', null, 'each day is checked like any extra-day request (here: under 24 hours'' notice)');
reset role;

-- Only the intern sends them; nothing owed means nothing to catch up
select tests.as_person(tests.supervisor());
select throws_ok($$select public.submit_catch_up_days(private.current_placement((select i from ids)),
  '[{"date":"2026-10-16","start":"09:00","end":"13:00"}]')$$, '42501', null, 'only the intern sends their catch-up days');
reset role;
select tests.at('2026-09-28 08:00+09:30');
select tests.as_person((select ok_intern from ids));
select is((public.catch_up_slots(private.current_placement((select ok_intern from ids))) ->> 'owed_minutes')::int, 0,
  'no balance, nothing owed');
reset role;

select * from finish();
rollback;

begin;
select plan(34);

create temp table ids as
select tests.create_intern('pa@test.dev') as a,
       tests.create_intern('pb@test.dev') as b,
       tests.create_intern('pc@test.dev') as c,
       tests.create_intern('pd@test.dev') as d,
       tests.create_intern('pe@test.dev') as e,
       tests.create_person('ps@test.dev', false, true, false) as sup;
grant select on ids to authenticated;
select tests.consent_all(a) from ids;
select tests.consent_all(b) from ids;
select tests.consent_all(d) from ids;
select tests.consent_all(e) from ids;
select tests.consent_all(sup) from ids;

-- R5.1.2 lifted (Dilip, 26 Sep): the office-hours window, weekends and closure days no longer
-- block clocking. Separate interns, so `a` stays fresh for the geofence tests below.
create temp table always_on as
select tests.create_intern('paw@test.dev') as early,
       tests.create_intern('pwe@test.dev') as weekend,
       tests.create_intern('pcl@test.dev') as closure;
grant select on always_on to authenticated;
select tests.consent_all(early) from always_on;
select tests.consent_all(weekend) from always_on;
select tests.consent_all(closure) from always_on;
insert into public.daymark_closure_days (day, name) values ('2026-10-21', 'Test closure');
select lives_ok($$select tests.clock((select early from always_on), 'shift_in', '2026-10-14 06:59:59+09:30')$$,
  'clocking before 7am now works');
select lives_ok($$select tests.clock((select weekend from always_on), 'shift_in', '2026-10-17 10:00+09:30')$$,
  'clocking on a Saturday now works');
select lives_ok($$select tests.clock((select closure from always_on), 'shift_in', '2026-10-21 10:00+09:30')$$,
  'clocking on a closure day now works');

-- R5.1.2 geofence and review accuracy cap
select throws_ok($$select tests.clock((select a from ids), 'shift_in', '2026-10-14 09:00+09:30', p_acc => 151)$$,
  'P0001', 'Your location is too rough (± 151 m). Step outside or near a window and try again.', 'accuracy over 150 m is rejected');
select throws_like($$select tests.clock((select a from ids), 'shift_in', '2026-10-14 09:00+09:30', tests.north(200.1))$$,
  '%m from the office. Move closer to clock in.', '200.1 m is outside the radius');
select lives_ok($$select tests.clock((select a from ids), 'shift_in', '2026-10-14 09:00+09:30', tests.north(199.9))$$,
  '199.9 m is inside the radius');

-- Server time only, place from the site row
select is((select occurred_at from public.daymark_punches where user_id = (select a from ids)),
  '2026-10-14 09:00+09:30'::timestamptz, 'occurred_at is the server clock');
select is((select client_reported_at from public.daymark_punches where user_id = (select a from ids)),
  '2020-01-01 00:00+00'::timestamptz, 'the client time is kept only for forensics');
select is((select place_name from public.daymark_punches where user_id = (select a from ids)), 'Test site pa@test.dev',
  'place name comes from the site, not a geocoder');
select is((select round(distance_m::numeric, 1) from public.daymark_punches where user_id = (select a from ids)), 199.9,
  'distance is stored');
select is((select verification_method from public.daymark_punches where user_id = (select a from ids)), 'gps_selfie',
  'device punches are verified by GPS and selfie');

-- R5.1.5 alternation
select throws_ok($$select tests.clock((select a from ids), 'shift_in', '2026-10-14 09:05+09:30')$$,
  'P0001', 'You''re already clocked in. Clock out first.', 'a second shift_in is rejected');
select lives_ok($$select tests.clock((select a from ids), 'shift_out', '2026-10-14 19:00:00+09:30')$$,
  '19:00:00 is still inside the window');
select throws_ok($$select tests.clock((select a from ids), 'shift_out', '2026-10-15 10:00+09:30')$$,
  'P0001', 'Clock in before you clock out.', 'shift_out needs an open shift');

-- Flags (review rule 9). R5.1.6: the log for 14 Oct comes first.
select tests.as_person((select a from ids));
select public.save_work_log('2026-10-14', 'Set up the reception desk');
reset role;
select lives_ok($$select tests.clock((select a from ids), 'shift_in', '2026-10-15 09:00+09:30', tests.north(199.9))$$,
  'same coordinates on a later day are accepted');
select ok((select 'repeat_coords' = any(flags) from public.daymark_punches where user_id = (select a from ids)
           order by occurred_at desc limit 1), 'identical coordinates on another day are flagged');
select tests.clock((select b from ids), 'shift_in', '2026-10-14 09:00+09:30', p_acc => 2);
select ok((select 'suspicious_accuracy' = any(flags) from public.daymark_punches where user_id = (select b from ids)),
  'accuracy of 3 m or better is flagged');
select set_config('request.headers', '{"user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}', true);
select tests.clock((select e from ids), 'shift_in', '2026-10-14 09:00+09:30');
select ok((select 'desktop_ua' = any(flags) from public.daymark_punches where user_id = (select e from ids)),
  'desktop browsers are flagged');
select set_config('request.headers', '', true);

-- Rate limit (review rule 8)
select throws_ok($$select tests.clock((select b from ids), 'shift_out', '2026-10-14 09:00:30+09:30')$$,
  'P0001', 'You just clocked. Wait a minute and try again.', 'one punch per minute');

-- R5.1.1 who can clock
select throws_ok($$select tests.clock((select sup from ids), 'shift_in', '2026-10-14 09:00+09:30')$$,
  'P0001', 'Only interns clock in.', 'supervisors do not clock in');
update public.daymark_profiles set active = false where id = (select d from ids);
select throws_ok($$select tests.clock((select d from ids), 'shift_in', '2026-10-14 09:00+09:30')$$,
  'P0001', 'Your login is paused. Ask the DGK admin to turn it back on.', 'paused logins cannot clock');
update public.daymark_profiles set active = true where id = (select d from ids);

-- Consent gate (review rule 11)
select tests.at('2026-10-14 09:00+09:30');
select tests.as_person((select c from ids));
select throws_ok($$select public.start_clock('shift_in')$$, 'P0001',
  'Choose how you''ll clock in first: allow location and selfie, or ask your supervisor to confirm you.', 'clocking needs consent');
reset role;

-- Challenge and selfie checks (review rules 5 and 7)
select tests.at('2026-10-14 09:00+09:30');
select tests.as_person((select d from ids));
create temp table ch as select public.start_clock('shift_in') as j;
reset role;
grant select on ch to authenticated;
select ok((select (j ->> 'gesture') is not null and (j ->> 'expires_at')::timestamptz = '2026-10-14 09:01:30+09:30' from ch),
  'a challenge has a gesture and a 90-second expiry');
select tests.as_person((select d from ids));
select throws_ok($$select public.clock_punch((select (j ->> 'challenge_id')::uuid from ch), -12.4785082, 130.9854825, 10, null)$$,
  'P0001', 'We didn''t get your selfie. Take it again.', 'a selfie must be uploaded');
reset role;
insert into storage.objects (bucket_id, name, owner, owner_id, created_at)
select 'daymark-photos', (select d from ids) || '/' || (j ->> 'challenge_id') || '.jpg', (select e from ids), (select e from ids)::text, now() from ch;
select tests.as_person((select d from ids));
select throws_ok($$select public.clock_punch((select (j ->> 'challenge_id')::uuid from ch), -12.4785082, 130.9854825, 10, null)$$,
  'P0001', 'We didn''t get your selfie. Take it again.', 'the selfie must be uploaded by the person clocking');
reset role;
select tests.as_person((select e from ids));
select throws_ok($$select public.clock_punch((select (j ->> 'challenge_id')::uuid from ch), -12.4785082, 130.9854825, 10, null)$$,
  'P0001', 'That clock-in timed out. Tap Clock in again.', 'another person''s challenge is refused');
reset role;
update storage.objects set owner = (select d from ids), owner_id = (select d from ids)::text,
  created_at = now() - interval '1 second' where name like (select d from ids) || '/%';
select tests.at('2026-10-14 09:00:20+09:30');
select tests.as_person((select d from ids));
select throws_ok($$select public.clock_punch((select (j ->> 'challenge_id')::uuid from ch), -12.4785082, 130.9854825, 10, null)$$,
  'P0001', 'We didn''t get your selfie. Take it again.', 'a photo older than the challenge is refused');
reset role;
update storage.objects set created_at = now() where name like (select d from ids) || '/%';
select tests.at('2026-10-14 09:01:31+09:30');
select tests.as_person((select d from ids));
select throws_ok($$select public.clock_punch((select (j ->> 'challenge_id')::uuid from ch), -12.4785082, 130.9854825, 10, null)$$,
  'P0001', 'That clock-in timed out. Tap Clock in again.', 'challenges expire after 90 seconds');
reset role;
select tests.at('2026-10-14 09:01:00+09:30');
select tests.as_person((select d from ids));
select lives_ok($$select public.clock_punch((select (j ->> 'challenge_id')::uuid from ch), -12.4785082, 130.9854825, 10, null)$$,
  'a fresh challenge with its own selfie clocks in');
select tests.at('2026-10-14 09:03:00+09:30');
select throws_ok($$select public.clock_punch((select (j ->> 'challenge_id')::uuid from ch), -12.4785082, 130.9854825, 10, null)$$,
  'P0001', 'That clock-in timed out. Tap Clock in again.', 'a challenge works once');

-- R5.1.4, R5.1.3, R5.1.7 and write access
select throws_ok($$insert into public.daymark_punches (user_id, event_type) values ((select d from ids), 'shift_out')$$,
  '42501', null, 'interns cannot insert punches directly');
reset role;
select throws_ok($$insert into public.daymark_punches (user_id, event_type, latitude, longitude, photo_path)
                   values ((select b from ids), 'break_in', -12.4785082, 130.9854825, (select b from ids) || '/' || gen_random_uuid() || '.jpg')$$,
  'P0001', 'Breaks are no longer clocked. Just clock in and out.', 'break punches are rejected');
select throws_ok($$insert into public.daymark_punches (user_id, event_type, source) values ((select b from ids), 'shift_out', 'device')$$,
  'P0001', 'A clock-in needs a selfie and your location.', 'device punches need a selfie and GPS');
select lives_ok($$insert into public.daymark_punches (user_id, event_type, source, occurred_at)
                  values ((select b from ids), 'shift_out', 'auto_close', '2026-10-14 09:00+09:30')$$,
  'system punches need no selfie or GPS');

select * from finish();
rollback;

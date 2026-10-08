begin;
select plan(17);

-- Offline clock fixes from code review: no reused selfie, a known gesture, a 7-day window,
-- and typed-in times sent later land on their own day.
create temp table ids as
select tests.create_intern('fix.a@test.dev') as a,
       tests.create_intern('fix.b@test.dev') as b,
       tests.create_intern('fix.c@test.dev') as c,
       gen_random_uuid() as kb1, gen_random_uuid() as t1;
grant select on ids to authenticated;
select tests.consent_all(a) from ids;
select tests.consent_all(b) from ids;
select tests.consent_all(c) from ids;

-- Tuesday 20 Oct: A clocks in live at 9:00 (challenge, selfie a/<challenge>.jpg, punch).
select tests.clock((select a from ids), 'shift_in', '2026-10-20 09:00+09:30');
create temp table live as select id, gesture from public.daymark_clock_challenges where person_id = (select a from ids);
grant select on live to authenticated;
select ok((select gesture from live) = any (private.clock_gestures()), 'the live challenge still picks from the gesture list');

select tests.at('2026-10-20 13:00+09:30');
select tests.as_person((select a from ids));
select throws_ok($$select public.submit_offline_punch((select id from live), 'break_start', '2026-10-20 12:00+09:30',
  -12.4785, 130.9855, 12, 'Give a thumbs up', null)$$, '42501', 'That selfie was already used for another clock.',
  'a live clock''s challenge id can''t be sent as an offline clock');
reset role;
delete from public.daymark_clock_challenges where id = (select id from live);
select tests.as_person((select a from ids));
select throws_ok($$select public.submit_offline_punch((select id from live), 'break_start', '2026-10-20 12:00+09:30',
  -12.4785, 130.9855, 12, 'Give a thumbs up', null)$$, '42501', 'That selfie was already used for another clock.',
  'a photo already on a punch can''t be reused, even with its challenge gone');
select throws_ok($$select public.submit_offline_punch(gen_random_uuid(), 'break_start', '2026-10-20 12:00+09:30',
  -12.4785, 130.9855, 12, 'Do a backflip', null)$$, '22023', null, 'only the app''s gestures');
reset role;

-- B sends a clock that waited 6 days; one that waited 8 days is too old.
insert into storage.objects (bucket_id, name, owner, owner_id, created_at)
select 'daymark-photos', b || '/' || kb1 || '.jpg', b, b::text, now() from ids;
select tests.as_person((select b from ids));
select lives_ok($$select public.submit_offline_punch((select kb1 from ids), 'shift_in', '2026-10-14 09:00+09:30',
  -12.4785, 130.9855, 12, 'Point at the camera', 'full_day')$$, 'a 6-day-old offline clock is accepted');
select throws_ok($$select public.submit_offline_punch(gen_random_uuid(), 'shift_in', '2026-10-12 09:00+09:30',
  -12.4785, 130.9855, 12, null, 'full_day')$$, '22023',
  'That offline clock is more than 7 days old. Ask your supervisor to add the time.', 'an 8-day-old one is refused');
reset role;

-- C typed in yesterday's arrival with no signal; the phone sends it today.
select tests.as_person((select c from ids));
select throws_ok($$select public.submit_offline_typed((select t1 from ids), 'shift_in', '2026-10-19 09:00+09:30')$$,
  'P0001', 'Pick Full day or Work-based before you clock in.', 'a typed arrival carries that day''s kind');
select lives_ok($$select public.submit_offline_typed((select t1 from ids), 'shift_in', '2026-10-19 09:00+09:30',
  'No signal in the car park', 'full_day')$$, 'a typed time from yesterday is accepted');
select is((public.submit_offline_typed((select t1 from ids), 'shift_in', '2026-10-19 09:00+09:30') ->> 'punch_id')::uuid,
  (select id from public.daymark_punches where offline_id = (select t1 from ids)), 'sending it again returns the same punch');
select throws_ok($$select public.submit_offline_typed(gen_random_uuid(), 'break_end', '2026-10-12 12:30+09:30')$$,
  '22023', null, 'nothing typed more than 7 days ago');
reset role;

select is((select string_agg(occurred_at::text || '/' || source || '/' || coalesce(confirmed_at::text, 'waiting'), ',')
           from public.daymark_punches where user_id = (select c from ids)),
  (timestamptz '2026-10-19 09:00+09:30')::text || '/supervisor/waiting', 'one punch, at the typed time, waiting');
select is((select work_date || ' ' || kind from public.daymark_day_kinds where placement_id = tests.placement((select c from ids))),
  '2026-10-19 full_day', 'the day kind is for yesterday');
select is((select reason from public.daymark_requests where intern_id = (select c from ids) and type = 'attendance'),
  'Typed in (offline): arrived at 9:00 am on Mon 19 Oct. No signal in the car park', 'the request names the day');

insert into public.daymark_punches (user_id, event_type, source, occurred_at)
select c, 'shift_out', 'punch_fix', '2026-10-19 17:00+09:30' from ids;
select is((tests.day((select c from ids), '2026-10-19')).counted, 0, 'yesterday counts 0 until confirmed');

select tests.at('2026-10-20 14:00+09:30');
select tests.as_person(tests.supervisor());
select lives_ok($$select public.decide_request(r.id, 'approve', null, null) from public.daymark_requests r
  where r.intern_id = (select c from ids) and r.type = 'attendance'$$, 'the supervisor confirms it');
reset role;
select is((tests.day((select c from ids), '2026-10-19')).counted, 450, 'confirmed, yesterday counts (9:00 to 5:00 less the unclocked break)');

-- Someone else can't reuse C's id.
select tests.as_person((select b from ids));
select throws_ok($$select public.submit_offline_typed((select t1 from ids), 'break_end', '2026-10-20 12:30+09:30')$$,
  '42501', null, 'a typed-in id belongs to one intern');
reset role;

select * from finish();
rollback;

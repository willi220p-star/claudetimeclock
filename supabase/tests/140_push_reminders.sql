begin;
select plan(21);

-- Push reminders (Dilip, 8 Oct; D36).
create temp table ids as
select tests.create_intern('push.a@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as a,
       tests.create_intern('push.b@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as b,
       tests.create_intern('push.c@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as c;
grant select on ids to authenticated;
select tests.without_seed();
select tests.consent_all(a) from ids;
select tests.consent_all(b) from ids;
select tests.consent_all(c) from ids;

-- Phones: people save and remove only their own.
select tests.as_person((select a from ids));
select lives_ok($$select public.save_push_subscription('https://push.example/a1', 'key-a', 'auth-a')$$, 'an intern turns reminders on');
select throws_ok($$select public.save_push_subscription('http://push.example/x', 'k', 'a')$$, '22023', null,
  'only https push services');
reset role;
select tests.as_person((select b from ids));
select lives_ok($$select public.delete_push_subscription('https://push.example/a1')$$, 'deleting someone else''s phone is a no-op');
select is((select count(*)::int from public.daymark_push_subscriptions), 0, 'and they can''t see it');
reset role;
select is((select count(*)::int from public.daymark_push_subscriptions where person_id = (select a from ids)), 1, 'A''s phone stays');
select tests.as_person((select c from ids));
select public.save_push_subscription('https://push.example/c1', 'key-c', 'auth-c');
reset role;

-- Monday 12 Oct, 9:12 am: A and B haven't clocked in, C has.
select tests.clock((select c from ids), 'shift_in', '2026-10-12 08:55+09:30');
select tests.at('2026-10-12 09:05+09:30');
select is(private.job_reminders(), 0, 'nothing before 10 minutes past the start');
select tests.at('2026-10-12 09:12+09:30');
select is(private.job_reminders(), 2, 'A and B are reminded to clock in');
select is(private.job_reminders(), 0, 'once a day');
select is((select title from public.daymark_notifications where person_id = (select a from ids) and kind = 'reminder'),
  'Time to clock in', 'in-app too');
select is((select count(*)::int from public.daymark_push_outbox o where o.person_id = (select a from ids)), 1,
  'A has a phone, so the reminder is queued to push');
select is((select count(*)::int from public.daymark_push_outbox o where o.person_id = (select b from ids)), 0,
  'B has no phone: in-app only');
select is((select send_after from public.daymark_push_outbox o where o.person_id = (select a from ids)),
  '2026-10-12 09:12+09:30'::timestamptz, 'sent straight away in the day');

-- C takes a break at noon; the 30-minute break is up at 12:30.
select tests.clock((select c from ids), 'break_start', '2026-10-12 12:00+09:30');
select tests.at('2026-10-12 12:25+09:30');
select is(private.job_reminders(), 0, 'no reminder inside the break');
select tests.at('2026-10-12 12:31+09:30');
select is(private.job_reminders(), 1, 'the break ran long');
select is((select body from public.daymark_notifications where person_id = (select c from ids) and title = 'Your break is up'),
  'Your 30-minute break is up. Tap End break when you''re back.', 'says how long');
select tests.clock((select c from ids), 'break_end', '2026-10-12 12:40+09:30');

-- 5:16 pm: C is still clocked in after a 5:00 pm finish.
select tests.at('2026-10-12 17:16+09:30');
select is(private.job_reminders(), 1, 'forgot to clock out');
select is((select count(*)::int from public.daymark_reminders_sent where person_id = (select c from ids)), 2, 'C got two reminders today');

-- Quiet hours: a notification at 10 pm waits until 7 am.
select is(private.push_send_after('2026-10-12 22:00+09:30'), '2026-10-13 07:00+09:30'::timestamptz, '10 pm waits for 7 am');
select is(private.push_send_after('2026-10-13 06:10+09:30'), '2026-10-13 07:00+09:30'::timestamptz, '6 am waits for 7 am');
select is(private.push_send_after('2026-10-13 07:30+09:30'), '2026-10-13 07:30+09:30'::timestamptz, 'daytime goes now');

-- Deleting the person (private.erase_person) removes their phones with them.
select private.erase_person((select a from ids), 'test', '{}'::jsonb);
select is((select count(*)::int from public.daymark_push_subscriptions where endpoint = 'https://push.example/a1'), 0,
  'phones go with the person');

select * from finish();
rollback;

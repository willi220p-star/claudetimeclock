begin;
select plan(12);

-- Evening-before reminder and supervisor digest (Dilip, 9 Oct; D39).
create temp table ids as
select tests.create_intern('eve.a@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as a,
       tests.create_intern('eve.b@test.dev', null, '{1,2,3,4,5}', '2026-10-12', '2026-12-18', '13:00', '17:00') as b,
       tests.create_person('eve.admin@test.dev', false, false, true) as admin;
select tests.without_seed();
select tests.consent_all(a) from ids;
select tests.consent_all(b) from ids;

-- Sunday 11 Oct, 7:30 pm: too early. 8:00 pm: A (9:00 am Monday) is told; B (1:00 pm) is not.
select tests.at('2026-10-11 19:30+09:30');
select is(private.job_reminders(), 0, 'nothing before 8 pm');
select tests.at('2026-10-11 20:05+09:30');
select is(private.job_reminders(), 1, 'one intern has a morning shift tomorrow');
select is((select body from public.daymark_notifications where person_id = (select a from ids) and kind = 'reminder_tomorrow'),
  'Tomorrow you start at 9:00 am. See you then.', 'says the start');
select is((select count(*)::int from public.daymark_notifications where person_id = (select b from ids) and kind = 'reminder_tomorrow'),
  0, 'an afternoon start isn''t a morning shift');
select is(private.job_reminders(), 0, 'once');

-- Monday 12 Oct: nobody is late at 8:05 (A starts at 9:00); at 9:30 A is, so the supervisor and admin hear.
select tests.at('2026-10-12 08:05+09:30');
select is(private.job_reminders(), 0, 'no digest when nobody is late and nothing waits');
select tests.at('2026-10-12 09:30+09:30');
-- Seeded admins (admin@dgk.test) get one too, so only these two are checked by name.
select cmp_ok(private.job_reminders(), '>=', 2, 'staff get a morning summary');
select is((select count(*)::int from public.daymark_notifications where kind = 'digest'
  and person_id in (tests.supervisor(), (select admin from ids))), 2, 'the supervisor and this admin both have one');
select is((select body from public.daymark_notifications where person_id = tests.supervisor() and kind = 'digest'),
  '1 not clocked in yet.', 'the supervisor sees their late intern');
select is((select count(*)::int from public.daymark_notifications where kind = 'digest' and person_id = tests.supervisor()), 1, 'once a day') from (select private.job_reminders()) x;

-- Unticked: Tuesday's summary isn't sent.
select tests.as_person((select admin from ids));
select public.save_push_kinds('{reminder_shift}');
reset role;
select tests.at('2026-10-13 09:30+09:30');
select is(private.job_reminders(), 0, 'an unticked summary isn''t sent');
select is(private.push_worthy('digest'), false, 'and isn''t pushed');

select * from finish();
rollback;

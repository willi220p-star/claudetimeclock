begin;
select plan(28);

-- 8 Oct requests (Dilip): day kind before clock-in, typed-in times, staff breaks, absent days,
-- deleting notifications.
create temp table ids as
select tests.create_person('fx.admin@test.dev', false, false, true) as admin,
       tests.create_person('fx.other@test.dev', false, true, false, 'Other Supervisor') as other,
       tests.create_intern('fx.a@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as a,
       tests.create_intern('fx.b@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as b,
       tests.create_intern('fx.c@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as c;
grant select on ids to authenticated;
select tests.consent_all(a) from ids;
select tests.consent_all(b) from ids;

-- 1. The first clock-in of a day needs Full day or Work-based
select tests.at('2026-10-12 09:00+09:30');
select tests.as_person((select a from ids));
select throws_ok($$select public.start_clock('shift_in')$$, 'P0001', 'Pick Full day or Work-based before you clock in.',
  'no clock-in before the day''s kind is picked');
select lives_ok($$select public.choose_day_kind('work_based')$$, 'the intern picks a work-based day');
reset role;
select is((select status from public.daymark_day_kinds where placement_id = tests.placement((select a from ids))), 'pending',
  'a work-based day waits for a decision');
select ok(exists (select 1 from public.daymark_notifications where person_id = tests.supervisor() and kind = 'work_based'),
  'the supervisor is asked');
select tests.clock((select a from ids), 'shift_in', '2026-10-12 09:00+09:30');
select tests.clock((select a from ids), 'shift_out', '2026-10-12 14:30+09:30');
select results_eq($$select raw, break, counted, scheduled from tests.day((select a from ids), '2026-10-12')$$,
  $$values (330, 0, 330, 450)$$, 'a work-based day takes no break; until approved, the time worked counts');
select tests.as_person((select a from ids));
select throws_ok($$select public.decide_day_kind(tests.placement((select a from ids)), '2026-10-12', 'approve')$$,
  '42501', null, 'interns can''t approve their own day');
reset role;
select tests.as_person((select other from ids));
select throws_ok($$select public.decide_day_kind(tests.placement((select a from ids)), '2026-10-12', 'approve')$$,
  '42501', null, 'nor can another supervisor');
reset role;
select tests.as_person(tests.supervisor());
select lives_ok($$select public.decide_day_kind(tests.placement((select a from ids)), '2026-10-12', 'approve')$$,
  'their supervisor approves it');
reset role;
select is((tests.day((select a from ids), '2026-10-12')).counted, 450, 'approved, it counts the full rostered day');
select tests.as_person((select a from ids));
select throws_ok($$select public.choose_day_kind('full_day')$$, 'P0001', 'Today''s day type is already decided.',
  'a decided day can''t be switched');
reset role;

-- 2. Typed-in times: forgot to clock in, then forgot to end the break
select tests.at('2026-10-13 09:40+09:30');
select tests.as_person((select b from ids));
select public.choose_day_kind('full_day');
select throws_ok($$select public.report_missed_time('shift_in', '10:00', null)$$, '22023',
  'That time hasn''t happened yet.', 'no typing a time that hasn''t happened');
select lives_ok($$select public.report_missed_time('shift_in', '09:05', 'Phone was flat')$$,
  'the intern types when they arrived');
reset role;
select is((select source || '/' || coalesce(confirmed_at::text, 'waiting') from public.daymark_punches
           where user_id = (select b from ids) order by occurred_at desc limit 1), 'supervisor/waiting',
  'a typed-in time waits for the supervisor');
select is((select reason from public.daymark_requests where intern_id = (select b from ids) and type = 'attendance'),
  'Typed in: arrived at 9:05 am. Phone was flat', 'as a typed-in time request');
select ok(exists (select 1 from public.daymark_notifications where person_id = tests.supervisor() and kind = 'attendance')
          and exists (select 1 from public.daymark_notifications where person_id = (select admin from ids) and kind = 'attendance'),
  'the supervisor and the admin are told');
select lives_ok($$select tests.clock((select b from ids), 'break_start', '2026-10-13 12:00+09:30')$$,
  'they can take a break after the typed-in arrival');
select tests.at('2026-10-13 16:00+09:30');
select tests.as_person((select b from ids));
select throws_ok($$select public.report_missed_time('break_end', '11:00', null)$$, '22023', null,
  'a typed time must come after the last clock');
select lives_ok($$select public.report_missed_time('break_end', '12:30', null)$$, 'they type when the break ended');
reset role;
select tests.clock((select b from ids), 'shift_out', '2026-10-13 17:00+09:30');
select is((tests.day((select b from ids), '2026-10-13')).counted, 0, 'typed-in sessions count 0 until confirmed');
select tests.as_person(tests.supervisor());
select public.decide_request(r.id, 'approve', null, null)
from public.daymark_requests r where r.intern_id = (select b from ids) and r.type = 'attendance';
reset role;
select results_eq($$select raw, break, counted from tests.day((select b from ids), '2026-10-13')$$,
  $$values (445, 0, 445)$$, 'confirmed, both sessions count with the 30-minute break unpaid');

-- 3. Staff add a break inside a session
select tests.shift((select c from ids), '2026-10-14 09:00', '2026-10-14 17:00');
select tests.at('2026-10-14 18:00+09:30');
select tests.as_person((select c from ids));
select throws_ok($$select public.staff_add_break(tests.placement((select c from ids)), '2026-10-14', '12:00', '12:45', 'Lunch')$$,
  '42501', null, 'interns can''t add breaks');
reset role;
select tests.as_person(tests.supervisor());
select throws_ok($$select public.staff_add_break(tests.placement((select c from ids)), '2026-10-14', '18:00', '18:30', 'Lunch break')$$,
  '22023', null, 'the break has to sit inside a session');
select lives_ok($$select public.staff_add_break(tests.placement((select c from ids)), '2026-10-14', '12:00', '12:45', 'Lunch break')$$,
  'their supervisor adds a 45-minute break');
reset role;
select results_eq($$select raw, break, worked from tests.day((select c from ids), '2026-10-14')$$,
  $$values (435, 0, 435)$$, 'the session splits around the break');

-- 4. Absent: the rostered day becomes absent leave and stays owed
select tests.at('2026-10-15 08:00+09:30');
select tests.as_person(tests.supervisor());
select lives_ok($$select public.staff_mark_absent((select id from public.daymark_scheduled_days
  where placement_id = tests.placement((select c from ids)) and work_date = '2026-10-15'), 'Sick, called in')$$,
  'their supervisor marks a day absent');
reset role;
select is((select status || '/' || leave_kind from public.daymark_scheduled_days
           where placement_id = tests.placement((select c from ids)) and work_date = '2026-10-15'), 'leave/absent',
  'the day is absent');

-- 5. Delete your own notifications
select tests.as_person((select b from ids));
select is(public.delete_my_notifications(null) > 0, true, 'an intern deletes all their notifications');
reset role;
select ok(exists (select 1 from public.daymark_notifications where person_id = tests.supervisor()),
  'other people''s notifications stay');

select * from finish();
rollback;

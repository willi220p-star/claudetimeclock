begin;
select plan(31);

-- 5 Oct requests (Dilip): Start · Break · Finish, an assigned break per intern, clocking as often
-- as needed, staff time edits that count straight away, and notice v1.2.
create temp table ids as
select tests.create_person('br.admin@test.dev', false, false, true) as admin,
       tests.create_person('br.other@test.dev', false, true, false, 'Other Supervisor') as other,
       tests.create_intern('br.a@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as a,
       tests.create_intern('br.b@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as b,
       tests.create_intern('br.c@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as c;
grant select on ids to authenticated;
create temp table out (k text primary key, v jsonb);
grant all on out to authenticated;
select tests.consent_all(a) from ids;
select tests.consent_all(c) from ids;

-- Breaks: a clock-out and clock-in marked is_break; they start between 10 am and 2 pm
select tests.clock((select a from ids), 'shift_in', '2026-10-12 09:00+09:30');
select tests.as_person((select a from ids));
select tests.at('2026-10-12 09:05+09:30');
insert into out values ('in', public.clock_status());
reset role;
select is((select v ->> 'state' from out where k = 'in'), 'in', 'clocked in');
select is((select v #>> '{actions,break_start}' from out where k = 'in'), 'Breaks start between 10 am and 2 pm.',
  'Home knows a break isn''t open yet');
select is((select v #>> '{actions,shift_out}' from out where k = 'in'), 'Write your work log for Mon 12 Oct to clock out.',
  'and that Finish needs the log');
select throws_ok($$select tests.clock((select a from ids), 'break_start', '2026-10-12 09:30+09:30')$$,
  'P0001', 'Breaks start between 10 am and 2 pm.', 'no break before 10 am');
select throws_ok($$select tests.clock((select a from ids), 'break_end', '2026-10-12 09:31+09:30')$$,
  'P0001', 'You''re not on a break.', 'no ending a break that never started');
select lives_ok($$select tests.clock((select a from ids), 'break_start', '2026-10-12 12:00+09:30')$$,
  'a break at noon needs no work log');
select is((select event_type || '/' || is_break from public.daymark_punches where user_id = (select a from ids)
           order by occurred_at desc limit 1), 'shift_out/true', 'a break start is a clock-out marked as a break');
select tests.as_person((select a from ids));
select is(public.clock_status() ->> 'state', 'break', 'Home shows the break');
reset role;
select tests.as_person(tests.supervisor());
select is((select x ->> 'status' from jsonb_array_elements(
             public.today_board((select site_id from public.daymark_placements where intern_id = (select a from ids))) -> 'people') x),
  'break', 'the office board shows them on a break, not done');
reset role;
select throws_ok($$select tests.clock((select a from ids), 'break_start', '2026-10-12 12:05+09:30')$$,
  'P0001', 'Clock in before you clock out.', 'one break at a time');
select lives_ok($$select tests.clock((select a from ids), 'break_end', '2026-10-12 12:20+09:30')$$, 'back from the break');
select tests.clock((select a from ids), 'shift_out', '2026-10-12 17:00+09:30');
select results_eq($$select raw, break, worked from tests.day((select a from ids), '2026-10-12')$$,
  $$values (460, 10, 450)$$, 'a 20-minute break is unpaid and topped up to the assigned 30');

-- Clock in and out as often as needed: no wait between punches
select lives_ok($$select tests.clock((select a from ids), 'shift_in', '2026-10-12 17:00:20+09:30')$$,
  'clock in again straight after Finish');
select lives_ok($$select tests.clock((select a from ids), 'shift_out', '2026-10-12 17:00:40+09:30')$$,
  'and out again');
select is((select count(*)::int from public.daymark_shifts where placement_id = tests.placement((select a from ids))
           and work_date = '2026-10-12'), 3, 'every session is kept');

-- Assigned break per intern: the default is 30; a 45-minute break re-plans today and later
select is((select break_minutes from public.daymark_placements where intern_id = (select a from ids)), 30, 'the default break is 30');
select tests.at('2026-10-13 07:00+09:30');
update public.daymark_placements set break_minutes = 45 where intern_id = (select b from ids);
select is((select planned_minutes from public.daymark_scheduled_days where placement_id = tests.placement((select b from ids))
           and work_date = '2026-10-13'), 435, 'a 9–5 day is planned at 7h 15m with a 45-minute break');
select is((select planned_minutes from public.daymark_scheduled_days where placement_id = tests.placement((select b from ids))
           and work_date = '2026-10-12'), 450, 'past days keep their plan');
select tests.shift((select b from ids), '2026-10-13 09:00', '2026-10-13 17:00');
select results_eq($$select raw, break, worked from tests.day((select b from ids), '2026-10-13')$$,
  $$values (480, 45, 435)$$, 'no break taken: the assigned 45 comes off');
select tests.shift((select b from ids), '2026-10-14 09:00', '2026-10-14 13:00');
select is((tests.day((select b from ids), '2026-10-14')).break, 0, 'days of 5 hours or less have no break');
select tests.as_person((select admin from ids));
select throws_ok($$select public.save_placement(jsonb_build_object('id', tests.placement((select b from ids)),
    'supervisor_id', tests.supervisor(), 'university', 'U', 'course', 'C', 'start_date', '2026-10-12',
    'planned_end_date', '2026-12-18', 'target_minutes', 24000, 'break_minutes', 150), false)$$,
  '22023', 'Set the break between 0 and 120 minutes.', 'the break is 0 to 120 minutes');
reset role;

-- Staff edits: the intern's supervisor (or admin) sets times directly; the edit counts straight away
select tests.clock((select c from ids), 'shift_in', '2026-10-12 10:05+09:30');
select tests.clock((select c from ids), 'shift_out', '2026-10-12 16:00+09:30');
select tests.at('2026-10-12 18:30+09:30');
create temp table orig as
select (select id from public.daymark_punches where user_id = (select c from ids) and event_type = 'shift_in') as pin,
       (select id from public.daymark_punches where user_id = (select c from ids) and event_type = 'shift_out') as pout;
grant select on orig to authenticated;
select tests.as_person((select c from ids));
select throws_ok($$select public.staff_edit_times(tests.placement((select c from ids)), '2026-10-12', '09:00', '18:00',
  (select pin from orig), (select pout from orig), 'Came in early')$$, '42501', null, 'an intern can''t edit their own times');
reset role;
select tests.as_person((select other from ids));
select throws_ok($$select public.staff_edit_times(tests.placement((select c from ids)), '2026-10-12', '09:00', '18:00',
  (select pin from orig), (select pout from orig), 'Came in early')$$, '42501', null, 'nor can another supervisor');
reset role;
select tests.as_person(tests.supervisor());
select throws_ok($$select public.staff_edit_times(tests.placement((select c from ids)), '2026-10-12', '09:00', '18:00',
  (select pin from orig), (select pout from orig), 'ok')$$, '22023', 'Give a reason of 5 to 200 characters.', 'a reason is required');
select lives_ok($$select public.staff_edit_times(tests.placement((select c from ids)), '2026-10-12', '09:00', '18:00',
  (select pin from orig), (select pout from orig), 'Bus was late; I let her make it up')$$, 'their supervisor sets 9:00–6:00');
reset role;
select is((select count(*)::int from public.daymark_punches where user_id = (select c from ids)), 4,
  'the original punches are kept alongside the edit');
select results_eq($$select raw, break, scheduled, counted from tests.day((select c from ids), '2026-10-12')$$,
  $$values (540, 30, 450, 510)$$, 'time beyond the roster counts straight away');
select ok(exists (select 1 from public.daymark_audit_log where action = 'staff_edit_times'
                  and actor_id = tests.supervisor() and after ->> 'reason' = 'Bus was late; I let her make it up'),
  'the edit is audited with the reason');
select ok(exists (select 1 from public.daymark_notifications where person_id = (select c from ids) and kind = 'times'
                  and body like 'Test Supervisor set your clock-in 9:00 am and clock-out 6:00 pm on Mon 12 Oct.%'),
  'the intern is told');
select tests.at('2026-10-12 22:00+09:30');
select tests.as_person((select admin from ids));
select lives_ok($$select public.staff_edit_times(tests.placement((select c from ids)), '2026-10-12', '19:00', '20:00',
  null, null, 'Evening client event')$$, 'an admin adds a missing session');
reset role;

-- Notice v1.2: breaks are clocked too, and location and selfie are required
select ok((select body like '%Start break, End break or Clock out%' and body like '%You need to allow location and a selfie%'
                  and body not like '%asking your supervisor to confirm%'
           from public.daymark_notices where version = (select notice_version from public.daymark_settings)),
  'the current notice says so');

select * from finish();
rollback;

begin;
select plan(16);

create temp table ids as
select tests.create_intern('cr.a@test.dev') as a,
       tests.create_intern('cr.b@test.dev') as b;
grant select on ids to authenticated;
select tests.consent_all(a) from ids;

-- R5.1.6 the work log for the previous shift date comes before the next clock-in
select tests.clock((select a from ids), 'shift_in', '2026-10-12 09:00+09:30');
select tests.clock((select a from ids), 'shift_out', '2026-10-12 17:00+09:30');
select throws_ok($$select tests.clock((select a from ids), 'shift_in', '2026-10-13 09:00+09:30')$$,
  'P0001', 'Write your work log for Mon 12 Oct to clock in.', 'R5.1.6 no log for Monday, no clock-in on Tuesday');

select tests.as_person((select a from ids));
select throws_ok($$select public.save_work_log('2026-10-12', ' too short ')$$,
  'P0001', 'Write between 10 and 500 characters about what you did.', 'a log needs at least 10 characters');
select throws_ok($$select public.save_work_log('2026-10-12', repeat('x', 501))$$,
  'P0001', 'Write between 10 and 500 characters about what you did.', 'and at most 500');
select throws_ok($$select public.save_work_log('2026-10-09', 'Worked on the budget')$$,
  'P0001', 'You can only write a work log for a day you clocked in.', 'only for a day with a shift');
select lives_ok($$select public.save_work_log('2026-10-12', '  Filed invoices and met the team  ')$$, 'the intern writes the log');
select public.save_work_log('2026-10-12', 'Filed invoices, then reconciled them');
select results_eq($$select count(*)::int, min(summary) from public.daymark_work_logs$$,
  $$values (1, 'Filed invoices, then reconciled them')$$, 'saving again rewrites the one log for the day');
reset role;

select lives_ok($$select tests.clock((select a from ids), 'shift_in', '2026-10-13 09:00+09:30')$$,
  'with the log written, the intern clocks in');
select tests.clock((select a from ids), 'shift_out', '2026-10-13 12:00+09:30');
select lives_ok($$select tests.clock((select a from ids), 'shift_in', '2026-10-13 13:00+09:30')$$,
  'a second shift the same day does not need that day''s log yet');
delete from public.daymark_work_logs where placement_id = tests.placement((select a from ids));
select lives_ok($$select tests.clock((select a from ids), 'shift_out', '2026-10-13 17:00+09:30')$$,
  'R5.1.6 a clock-out is never blocked');

-- Only interns write logs, and only on a live placement
select tests.as_person(tests.supervisor());
select throws_ok($$select public.save_work_log('2026-10-12', 'Supervised the intern')$$,
  '42501', 'Only interns write work logs.', 'a supervisor cannot write logs');
reset role;
update public.daymark_placements set status = 'completed' where id = tests.placement((select a from ids));
select tests.as_person((select a from ids));
select throws_ok($$select public.save_work_log('2026-10-13', 'Filed invoices again today')$$,
  'P0001', 'Your placement has ended. You can still view and download your records.', 'R5.11.5 read-only after the end');
reset role;

-- R5.1.8 an unscheduled clock-in is blocked when the site already has 4 scheduled that day
insert into public.daymark_sites (id, name, address, latitude, longitude)
values ('00000000-0000-0000-0000-00000000f518', 'Full site', 'Test', -12.4785082, 130.9854825);
create temp table site_ids as
select tests.create_intern('cr.w1@test.dev', '00000000-0000-0000-0000-00000000f518', '{3}', '2026-10-12', '2026-10-16') as w1,
       tests.create_intern('cr.w2@test.dev', '00000000-0000-0000-0000-00000000f518', '{3}', '2026-10-12', '2026-10-16') as w2,
       tests.create_intern('cr.w3@test.dev', '00000000-0000-0000-0000-00000000f518', '{3}', '2026-10-12', '2026-10-16') as w3,
       tests.create_intern('cr.w4@test.dev', '00000000-0000-0000-0000-00000000f518', '{1}', '2026-10-12', '2026-10-16') as w4,
       tests.create_intern('cr.u@test.dev', '00000000-0000-0000-0000-00000000f518', '{1}', '2026-10-12', '2026-10-16') as u;
grant select on site_ids to authenticated;
select private.add_scheduled_day(tests.placement(w4), '2026-10-14', '09:00', '17:00', 'admin', null, true) from site_ids;
select tests.consent_all(u) from site_ids;
select tests.consent_all(w1) from site_ids;

select lives_ok($$select tests.clock((select u from site_ids), 'shift_in', '2026-10-13 10:00+09:30')$$,
  'an unscheduled clock-in is fine while the site is under 4');
select tests.clock((select u from site_ids), 'shift_out', '2026-10-13 12:00+09:30');
select tests.as_person((select u from site_ids));
select public.save_work_log('2026-10-13', 'Helped with the mail-out');
reset role;
select throws_ok($$select tests.clock((select u from site_ids), 'shift_in', '2026-10-14 10:00+09:30')$$,
  'P0001', 'The office already has 4 interns booked today, so there''s no room for an unscheduled shift. You can clock in on your scheduled days.',
  'R5.1.8 no unscheduled shift on a day with 4 scheduled');
select lives_ok($$select tests.clock((select w1 from site_ids), 'shift_in', '2026-10-14 09:00+09:30')$$,
  'a scheduled intern still clocks in on that day');

-- Who reads the logs (§6)
select tests.as_person(tests.supervisor());
select is((select count(*)::int from public.daymark_work_logs where placement_id = tests.placement((select u from site_ids))), 1,
  'the supervisor reads their intern''s log');
reset role;
select tests.as_person((select b from ids));
select is((select count(*)::int from public.daymark_work_logs), 0, 'another intern reads none');
reset role;

select * from finish();
rollback;

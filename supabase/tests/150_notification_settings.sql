begin;
select plan(16);

-- Notification settings (Dilip, 9 Oct; D37): admin ticks what is pushed, and sets break lengths.
create temp table ids as
select tests.create_person('note.admin@test.dev', false, false, true) as admin,
       tests.create_intern('note.a@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as a,
       tests.create_intern('note.b@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as b;
grant select on ids to authenticated;
select tests.without_seed();
select tests.consent_all(a) from ids;
select tests.consent_all(b) from ids;

-- Only an admin chooses, and only from the list.
select tests.as_person((select a from ids));
select throws_ok($$select public.save_push_kinds('{schedule}')$$, '42501', null, 'an intern can''t choose');
select throws_ok($$select public.set_break_for_all(60)$$, '42501', null, 'or set breaks');
reset role;
select tests.as_person((select admin from ids));
select throws_ok($$select public.save_push_kinds('{reminder_shift,pizza}')$$, '22023', null, 'unknown kinds are refused');
select is(public.save_push_kinds('{reminder_clock_out,reminder_break,reminder_break}'),
  '{reminder_break,reminder_clock_out}'::text[], 'saved once each, sorted');
reset role;
select is(private.push_worthy('schedule'), false, 'an unticked type isn''t pushed');
select is(private.push_worthy('reminder_break'), true, 'a ticked one is');
select is((select count(*)::int from public.daymark_audit_log where action = 'save_push_kinds'), 1, 'audited');

-- Break lengths: one intern, then everyone active.
select tests.as_person((select admin from ids));
select throws_ok(format('select public.set_break_minutes(%L, 150)', tests.placement((select a from ids))), '22023', null,
  'no more than 2 hours');
select lives_ok(format('select public.set_break_minutes(%L, 60)', tests.placement((select a from ids))), 'A gets an hour');
reset role;
select is((select break_minutes from public.daymark_placements where id = tests.placement((select a from ids))), 60, 'saved');
select tests.as_person((select admin from ids));
select is(public.set_break_for_all(45), 2, 'both active interns move to 45 minutes');
reset role;
select is((select break_minutes from public.daymark_placements where id = tests.placement((select b from ids))), 45, 'B too');

-- Reminders follow the ticks: shift-soon is unticked, so 8:31 sends nothing.
select tests.at('2026-10-12 08:31+09:30');
select is(private.job_reminders(), 0, 'an unticked reminder isn''t sent');

-- B's 45-minute break: nothing at 12:40, a reminder at 12:46.
select tests.clock((select b from ids), 'shift_in', '2026-10-12 09:00+09:30');
select tests.clock((select b from ids), 'break_start', '2026-10-12 12:00+09:30');
select tests.at('2026-10-12 12:40+09:30');
select is(private.job_reminders(), 0, 'inside B''s 45 minutes');
select tests.at('2026-10-12 12:46+09:30');
select is(private.job_reminders(), 1, 'B''s break is up at their own length');
select is((select body from public.daymark_notifications where person_id = (select b from ids) and kind = 'reminder_break'),
  'Your 45-minute break is up. Tap End break when you''re back.', 'with their length');

select * from finish();
rollback;

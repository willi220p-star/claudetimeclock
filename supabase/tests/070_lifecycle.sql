begin;
select plan(24);

create temp table ids as
select tests.create_person('lc.admin@test.dev', false, false, true) as admin,
       tests.create_person('lc.sup2@test.dev', false, true, false) as other_sup,
       tests.create_intern('lc.i@test.dev', null, '{1,3}', '2026-09-28', '2026-10-23') as intern,
       tests.create_intern('lc.w@test.dev', null, '{2}', '2026-09-28', '2026-10-23') as leaver;
grant select on ids to authenticated;
create temp table pl as
select private.current_placement((select intern from ids)) as main, private.current_placement((select leaver from ids)) as w;
grant select on pl to authenticated;

-- R5.11.3 extend
select tests.at('2026-10-20 10:00+09:30');
select tests.as_person((select other_sup from ids));
select throws_ok($$select public.extend_placement((select main from pl), '2026-11-06', 'More hours needed')$$,
  '42501', 'Only the intern''s supervisor or an admin can do that.', 'another supervisor cannot extend');
reset role;
select tests.as_person(tests.supervisor());
select throws_ok($$select public.extend_placement((select main from pl), '2026-10-16', 'x')$$,
  '22023', 'Pick a new end date after Fri 23 Oct.', 'an extension moves the end date later');
select public.extend_placement((select main from pl), '2026-11-06', 'More hours needed');
reset role;
select results_eq($$select status, planned_end_date, original_end_date from public.daymark_placements where id = (select main from pl)$$,
  $$values ('extended'::text, '2026-11-06'::date, '2026-10-23'::date)$$, 'status extended, new end, original kept');
select is((select array_agg(work_date order by work_date) from public.daymark_scheduled_days
           where placement_id = (select main from pl) and work_date > '2026-10-23' and status = 'scheduled'),
  array['2026-10-26','2026-10-28','2026-11-02','2026-11-04']::date[], 'days are generated for the added period');
select ok(exists (select 1 from public.daymark_notifications where person_id = (select intern from ids) and kind = 'extended'),
  'the intern is told');
select ok(exists (select 1 from public.daymark_audit_log where action = 'extend_placement'), 'extension audited');

-- R5.11.4 withdraw
select tests.as_person(tests.supervisor());
select throws_ok($$select public.withdraw_placement((select w from pl), '  ')$$, '22023', 'Give a reason for the withdrawal.',
  'a withdrawal needs a reason');
select public.withdraw_placement((select w from pl), 'Moved interstate');
reset role;
select results_eq($$select status, ended_on from public.daymark_placements where id = (select w from pl)$$,
  $$values ('withdrawn'::text, '2026-10-20'::date)$$, 'withdrawn today');
select is((select count(*)::int from public.daymark_scheduled_days where placement_id = (select w from pl)
           and work_date > '2026-10-20' and status = 'scheduled'), 0, 'future days are cancelled');
select is((select count(*)::int from public.daymark_scheduled_days where placement_id = (select w from pl)
           and work_date <= '2026-10-20' and status = 'scheduled'), 4, 'past days stay');

-- R5.11.2 confirm completion
select tests.at('2026-10-28 16:00+09:30');
select tests.as_person(tests.supervisor());
select throws_ok($$select public.approve_uni_report((select main from pl), 'ok')$$, '22023',
  'Approve the report once the hours are final: after the target is reached or the placement ends.',
  'the report waits for final hours');
select public.confirm_completion((select main from pl), 'Well done');
reset role;
select results_eq($$select status, ended_on from public.daymark_placements where id = (select main from pl)$$,
  $$values ('completed'::text, '2026-10-28'::date)$$, 'completed today');
select is((select count(*)::int from public.daymark_scheduled_days where placement_id = (select main from pl)
           and work_date > '2026-10-28' and status = 'scheduled'), 0, 'future days are cancelled');
select ok(exists (select 1 from public.daymark_notifications where person_id = (select intern from ids) and kind = 'retention_0'),
  'day-0 retention notice goes out at once');

-- R5.11.5 read-only
select tests.consent_all(intern) from ids;
select throws_ok($$select tests.clock((select intern from ids), 'shift_in', '2026-10-29 09:00+09:30')$$,
  'P0001', 'Your placement has ended. You can still view and download your records.', 'ended interns cannot clock in');

-- Uni report approval
select tests.as_person(tests.supervisor());
select public.approve_uni_report((select main from pl), 'Hours checked');
reset role;
select ok((select report_approved_at is not null and report_approved_by = tests.supervisor()
           from public.daymark_placements where id = (select main from pl)), 'the report is approved');

-- Exit feedback (§13)
select tests.as_person((select intern from ids));
select throws_ok($$select public.submit_exit_feedback('{"overall": 9}'::jsonb)$$, '22023', null, 'answers are checked');
select lives_ok($$select public.submit_exit_feedback('{"overall":5,"learned":"Client research","support":4,"change":"More desks","recommend":true}'::jsonb)$$,
  'an ended intern gives feedback');
select throws_ok($$select public.submit_exit_feedback('{"overall":5,"learned":"x","support":4,"change":"","recommend":true}'::jsonb)$$,
  '23505', 'You''ve already sent your feedback. Thank you!', 'once per placement');
reset role;

-- R5.11.7 reminders, idempotent
select tests.at('2026-11-11 02:00+09:30');   -- ended 28 Oct + 14
select private.job_retention_reminders();
select private.job_retention_reminders();
select is((select count(*)::int from public.daymark_notifications where person_id = (select intern from ids) and kind = 'retention_14'), 1,
  'day-14 reminder to the intern, once');
select is((select count(*)::int from public.daymark_notifications where person_id = tests.supervisor() and kind = 'retention_14' and link = '/supervisor/intern?id=' || (select intern from ids)), 1,
  'and to the supervisor, once');

-- R5.11.6 due for deletion after 30 days
select tests.at('2026-11-26 02:00+09:30');   -- +29
select ok(not exists (select 1 from private.due_for_deletion() where intern_id = (select intern from ids)), 'not due at day 29');
select tests.at('2026-11-27 02:00+09:30');   -- +30
select ok(exists (select 1 from private.due_for_deletion() where intern_id = (select intern from ids)), 'due at day 30');
select ok(exists (select 1 from private.due_for_deletion() where intern_id = (select leaver from ids)), 'the intern withdrawn on 20 Oct is due too');

select * from finish();
rollback;

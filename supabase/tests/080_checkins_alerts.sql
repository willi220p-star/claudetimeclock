begin;
select plan(44);
select tests.without_seed();

-- Check-ins, the Monday summary and its job, late and left-early alerts (§11.3, §12 supervisor 8).
-- Interns work Mon–Fri 9:00–5:00 (450 planned minutes a day). "Last week" on Mon 12 Oct is 5–9 Oct.
select tests.at('2026-10-01 10:00+09:30');
create temp table ids as
select tests.create_intern('ca.a@test.dev', null, '{1,2,3,4,5}', '2026-10-05') as a,
       tests.create_intern('ca.b@test.dev', null, '{1,2,3,4,5}', '2026-10-05') as b,
       tests.create_intern('ca.c@test.dev', null, '{1,2,3,4,5}', '2026-10-05') as c,
       tests.create_intern('ca.d@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as d,
       tests.create_intern('ca.e@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as e,
       tests.create_intern('ca.f@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as f,
       tests.create_person('ca.s2@test.dev', false, true, false, 'Other Supervisor') as s2,
       tests.create_person('ca.admin@test.dev', false, false, true) as admin;
grant select on ids to authenticated;
update public.daymark_placements set supervisor_id = (select s2 from ids) where intern_id = (select c from ids);

-- A in 5–9 Oct: Mon on time, Tue 20 min late, Wed no-show, Thu an hour over (pending overtime), Fri on time.
select tests.at('2026-10-12 08:00+09:30');
select tests.shift((select a from ids), '2026-10-05 09:00', '2026-10-05 17:00');
select tests.shift((select a from ids), '2026-10-06 09:20', '2026-10-06 17:00');
select tests.shift((select a from ids), '2026-10-08 09:00', '2026-10-08 18:00');
select tests.shift((select a from ids), '2026-10-09 09:00', '2026-10-09 17:00');
insert into public.daymark_work_logs (placement_id, work_date, summary)
select tests.placement(a), x.d, 'Client research and notes.' from ids, unnest('{2026-10-05,2026-10-06}'::date[]) x(d);
select private.job_reconcile();
select private.job_day_close();

-- checkins_due: the signed-in supervisor's live placements with no check-in for last week
select tests.as_person(tests.supervisor());
select results_eq($$select intern_name, week_start from public.checkins_due()$$,
  $$values ('ca.a', '2026-10-05'::date), ('ca.b', '2026-10-05'::date)$$, 'both interns are due for last week');
reset role;

-- save_checkin: who may
select tests.as_person((select a from ids));
select throws_ok($$select public.save_checkin(tests.placement((select a from ids)), '2026-10-05', 4, 4, 4, null)$$,
  '42501', 'Only the intern''s supervisor or an admin can do that.', 'the intern cannot check in on themselves');
reset role;
select tests.as_person((select s2 from ids));
select throws_ok($$select public.save_checkin(tests.placement((select a from ids)), '2026-10-05', 4, 4, 4, null)$$,
  '42501', 'Only the intern''s supervisor or an admin can do that.', 'another supervisor cannot');
reset role;
select tests.as_person((select admin from ids));
select lives_ok($$select public.save_checkin(tests.placement((select b from ids)), '2026-10-05', 2, 3, 2, 'Quiet week.')$$,
  'an admin can');
reset role;

-- save_checkin: validation
select tests.as_person(tests.supervisor());
select throws_ok($$select public.save_checkin(tests.placement((select a from ids)), '2026-10-06', 4, 4, 4, null)$$,
  '22023', 'Pick the Monday that starts the week.', 'the week starts on a Monday');
select throws_ok($$select public.save_checkin(tests.placement((select a from ids)), '2026-10-05', 0, 4, 4, null)$$,
  '22023', 'Rate each area from 1 to 5.', 'a rating of 0 is refused');
select throws_ok($$select public.save_checkin(tests.placement((select a from ids)), '2026-10-05', 4, 6, 4, null)$$,
  '22023', 'Rate each area from 1 to 5.', 'a rating of 6 is refused');
select throws_ok($$select public.save_checkin(tests.placement((select a from ids)), '2026-10-19', 4, 4, 4, null)$$,
  '22023', 'That week hasn''t started yet.', 'a future week is refused');
select throws_ok($$select public.save_checkin(tests.placement((select a from ids)), '2026-09-28', 4, 4, 4, null)$$,
  '22023', 'That week is outside the placement.', 'a week before the placement is refused');
select throws_ok($$select public.save_checkin(tests.placement((select a from ids)), '2026-10-05', 4, 4, 4, repeat('x', 1001))$$,
  '22023', 'Keep the comment to 1000 characters.', 'a comment over 1000 characters is refused');

-- save_checkin: upsert, audit, notify
select lives_ok($$select public.save_checkin(tests.placement((select a from ids)), '2026-10-05', 3, 3, 3, 'First go')$$,
  'the supervisor saves a check-in');
select lives_ok($$select public.save_checkin(tests.placement((select a from ids)), '2026-10-05', 4, 5, 3, '  Strong week.  ')$$,
  'and edits it');
reset role;
select results_eq($$select reliability::int, quality::int, communication::int, comment, supervisor_id from public.daymark_checkins
                    where placement_id = tests.placement((select a from ids))$$,
  $$values (4, 5, 3, 'Strong week.', tests.supervisor())$$, 'one row per week, updated in place, comment trimmed');
select is((select array_agg(action order by action) from public.daymark_audit_log
           where table_name = 'daymark_checkins' and row_id = (select id::text from public.daymark_checkins
                                                               where placement_id = tests.placement((select a from ids)))),
  '{checkin_saved,checkin_updated}'::text[], 'both saves are audited');
select ok(exists (select 1 from public.daymark_notifications where person_id = (select a from ids) and kind = 'checkin'
                  and title = 'Your supervisor checked in on week of Mon 5 Oct' and link = '/clock/progress'),
  'the intern is told');

select tests.as_person(tests.supervisor());
select is((select count(*)::int from public.checkins_due()), 0, 'nothing due once both are checked in');
reset role;
delete from public.daymark_checkins where placement_id = tests.placement((select b from ids));

-- monday_summary: last week's figures
select tests.as_person(tests.supervisor());
create temp table ms as select * from public.monday_summary();
reset role;
select results_eq($$select week, scheduled, counted, owed, no_shows, late_days, overtime_approved, overtime_pending,
                           work_logs, days_worked, pending_requests from ms where intern_name = 'ca.a'$$,
  $$values ('2026-10-05'::date, 2250, 1780, 470, 1, 1, 0, 60, 2, 4, 1)$$,
  'A: scheduled, counted, owed at week end, no-shows, late, overtime, work logs vs days worked, pending requests');
select results_eq($$select checkin ->> 'average', checkin ->> 'comment' from ms where intern_name = 'ca.a'$$,
  $$values ('4.00', 'Strong week.')$$, 'with that week''s check-in');
select results_eq($$select counted, owed, no_shows, checkin is null, pace is not null, risk_reasons @> '{owed}' from ms where intern_name = 'ca.b'$$,
  $$values (0, 2250, 5, true, true, true)$$, 'B: five no-shows, no check-in, at risk for owed hours');
select is((select count(*)::int from ms), 2, 'a supervisor sees only their interns');
select tests.as_person((select admin from ids));
select is((select count(*)::int from public.monday_summary('2026-10-05')), 3, 'an admin sees every live placement that week');
reset role;
select tests.as_person((select a from ids));
select throws_ok($$select * from public.monday_summary()$$, '42501', 'Only supervisors see this.', 'interns cannot');
reset role;
select tests.as_person(tests.supervisor());
select throws_ok($$select * from public.monday_summary('2026-10-06')$$, '22023', 'Pick the Monday that starts the week.',
  'the week starts on a Monday');

-- §12 supervisor 8: last check-in and check-ins due
create temp table ks as select public.kpi_supervisor() as j;
reset role;
select results_eq($$select (j ->> 'checkins_due')::int, j #>> '{last_checkin,week_start}', (j #>> '{last_checkin,average}')::numeric from ks$$,
  $$values (1, '2026-10-05', 4.00)$$, 'KPI: one check-in due, last check-in week and average');

-- The Monday job: once a week per supervisor
select is(private.job_monday_summary(), '{"summaries": 2, "checkins_due": 2}'::jsonb, 'both supervisors are told');
select ok(exists (select 1 from public.daymark_notifications where person_id = tests.supervisor() and kind = 'monday_summary'
                  and title = 'Your Monday summary is ready' and link = '/supervisor/summary?week=2026-10-05'),
  'the summary notice links to the week');
select ok(exists (select 1 from public.daymark_notifications where person_id = tests.supervisor() and kind = 'checkins_due'
                  and title = '1 check-in due for last week'), 'and says how many check-ins are due');
create temp table nc as select count(*) as n from public.daymark_notifications;
select is(private.job_monday_summary(), '{"summaries": 0, "checkins_due": 0}'::jsonb, 'a second run sends nothing');
select is((select count(*) from public.daymark_notifications), (select n from nc), 'and adds no notifications');
select tests.as_person((select admin from ids));
select is(public.run_job('monday_summary'), '{"summaries": 0, "checkins_due": 0}'::jsonb, 'the admin can run it by name');
reset role;
select ok(exists (select 1 from public.daymark_audit_log where action = 'run_job' and row_id = 'monday_summary'),
  'the manual run is audited');
select results_eq($$select schedule::text, command from cron.job where jobname = 'daymark-monday-summary'$$,
  $$values ('30 22 * * 0', 'select private.job_monday_summary()')$$, 'it runs Mondays at 08:00 Darwin');

-- Late alert: the first device or supervisor clock-in of a scheduled day past start + grace
select tests.consent_all(d) from ids;
select tests.clock((select d from ids), 'shift_in', '2026-10-12 09:10+09:30');
select is((select count(*)::int from public.daymark_notifications where person_id = tests.supervisor() and kind = 'late'), 0, 'within the grace: no alert');
select tests.clock((select d from ids), 'shift_out', '2026-10-12 17:00+09:30');
insert into public.daymark_work_logs (placement_id, work_date, summary)
select tests.placement(d), '2026-10-12', 'Set up the reporting sheet.' from ids;
select tests.clock((select d from ids), 'shift_in', '2026-10-13 09:22+09:30');
select results_eq($$select person_id, title, link from public.daymark_notifications where person_id = tests.supervisor() and kind = 'late'$$,
  $$select tests.supervisor(), 'ca.d clocked in late at 9:22 am', '/supervisor/intern?id=' || tests.placement(d) from ids$$,
  'late past the grace: the supervisor is told');
select tests.clock((select d from ids), 'shift_out', '2026-10-13 10:00+09:30');
select tests.clock((select d from ids), 'shift_in', '2026-10-13 10:30+09:30');
select is((select count(*)::int from public.daymark_notifications where person_id = tests.supervisor() and kind = 'late'), 1, 'only the first clock-in of the day');
select tests.at('2026-10-13 09:41+09:30');
select tests.shift((select f from ids), '2026-10-13 09:40', null, 'supervisor');
select tests.shift((select e from ids), '2026-10-13 09:40', '2026-10-13 10:00', 'punch_fix');
select is((select array_agg(title) from public.daymark_notifications where person_id = tests.supervisor() and kind = 'late' and title like 'ca.f%'),
  '{"ca.f clocked in late at 9:40 am"}'::text[], 'a supervisor-confirmed late clock-in alerts too');
select is((select count(*)::int from public.daymark_notifications where person_id = tests.supervisor() and kind = 'late' and title like 'ca.e%'), 0,
  'a punch fix does not');

-- Left early (R5.4.13): intern and supervisor told once at day close
select tests.at('2026-10-14 15:01+09:30');
select tests.shift((select e from ids), '2026-10-14 09:00', '2026-10-14 15:00');
select tests.at('2026-10-14 19:10+09:30');
select is((private.job_day_close() ->> 'left_early_alerts')::int, 1, 'day close finds one left-early day');
select results_eq($$select person_id, title, body, link from public.daymark_notifications where kind = 'left_early'
                    and person_id in (tests.supervisor(), (select e from ids)) order by link$$,
  $$select e, 'You left early on Wed 14 Oct', 'You finished 2h short of your scheduled day, so that time is owed.',
           '/clock/progress?day=2026-10-14' from ids
    union all
    select tests.supervisor(), 'ca.e left early on Wed 14 Oct', 'They finished 2h short of their scheduled day.',
           '/supervisor/intern?id=' || tests.placement(e) || '&day=2026-10-14' from ids$$,
  'the intern and the supervisor are told');
select is((private.job_day_close() ->> 'left_early_alerts')::int, 0, 'a second day close sends nothing');
select is((select count(*)::int from public.daymark_notifications where kind = 'left_early'
                                     and person_id in (tests.supervisor(), (select e from ids))), 2, 'still one each');

-- Anon can execute nothing new
select ok(not has_function_privilege('anon', 'public.save_checkin(uuid, date, integer, integer, integer, text)', 'execute')
          and not has_function_privilege('anon', 'public.checkins_due()', 'execute')
          and not has_function_privilege('anon', 'public.monday_summary(date)', 'execute')
          and not has_function_privilege('anon', 'private.save_checkin(uuid, date, integer, integer, integer, text)', 'execute')
          and not has_function_privilege('anon', 'private.checkins_due()', 'execute')
          and not has_function_privilege('anon', 'private.checkins_due_for(uuid, date)', 'execute')
          and not has_function_privilege('anon', 'private.monday_summary(date)', 'execute')
          and not has_function_privilege('anon', 'private.job_monday_summary()', 'execute')
          and not has_function_privilege('anon', 'private.monday(date)', 'execute')
          and not has_function_privilege('authenticated', 'private.job_monday_summary()', 'execute')
          and not has_function_privilege('authenticated', 'private.checkins_due_for(uuid, date)', 'execute'),
  'anon has no execute on the new functions; the job and the per-supervisor helper are not callable by users');
select tests.as_anon();
select throws_ok($$select public.checkins_due()$$, '42501', null, 'anon cannot list check-ins due');
select throws_ok($$select * from public.monday_summary()$$, '42501', null, 'anon cannot read the summary');
reset role;

select * from finish();
rollback;

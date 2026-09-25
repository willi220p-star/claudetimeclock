begin;
select plan(33);

-- §8.11 jobs. Wed 14 Oct 2026 (fortnight 12–25 Oct). Interns work Mon–Fri 9:00–5:00 unless noted.
select tests.at('2026-10-14 18:00+09:30');
create temp table ids as
select tests.create_intern('jb.a@test.dev') as a,
       tests.create_intern('jb.b@test.dev', null, '{1,2,3,4,5}', '2026-09-28', '2026-12-18', '09:00', '13:00') as b,
       tests.create_intern('jb.c@test.dev', null, '{1,3}') as c,
       tests.create_intern('jb.d@test.dev') as d,
       tests.create_intern('jb.e@test.dev') as e,
       tests.create_intern('jb.f@test.dev') as f,
       tests.create_intern('jb.g@test.dev', null, '{1,2,3,4,5}', '2026-09-28', '2026-12-18', '09:00', '17:00', 60) as g,
       tests.create_person('jb.admin@test.dev', false, false, true) as admin;
grant select on ids to authenticated;

select tests.shift((select a from ids), '2026-10-14 09:00');                        -- never clocks out
select tests.shift((select b from ids), '2026-10-14 14:00');                        -- in after a 9–1 day, never out
select tests.shift((select c from ids), '2026-10-13 10:00', '2026-10-13 12:00');    -- Tuesday: unscheduled
select tests.shift((select d from ids), '2026-10-14 08:00', '2026-10-14 18:00');    -- 120 overtime
select tests.shift((select e from ids), '2026-10-14 09:00', '2026-10-14 17:30');    -- 30 overtime
select tests.shift((select g from ids), '2026-10-14 09:00', '2026-10-14 10:30');    -- passes a 60-minute target

-- Everything a job can change, to prove a second run changes nothing.
create function pg_temp.snap() returns text language sql as $$
  select md5(concat_ws('|',
    (select string_agg(to_jsonb(x)::text, ',' order by x.placement_id, x.work_date) from public.daymark_day_results x),
    (select string_agg(to_jsonb(x)::text, ',' order by x.placement_id, x.clock_in_at) from public.daymark_shifts x),
    (select string_agg(to_jsonb(x)::text, ',' order by x.id) from public.daymark_punches x),
    (select string_agg(to_jsonb(x)::text, ',' order by x.id) from public.daymark_requests x),
    (select string_agg(to_jsonb(x)::text, ',' order by x.id) from public.daymark_placements x),
    (select count(*)::text from public.daymark_notifications),
    (select count(*)::text from public.daymark_audit_log)));
$$;
create temp table snaps (k text primary key, v text);

-- R5.5.1 as changed by D3: auto-close (19:05)
select is(private.job_auto_close(), '{"auto_closed": 0}'::jsonb, 'before 19:00 an open shift is left alone');
select tests.at('2026-10-14 19:05+09:30');
select is(private.job_auto_close(), '{"auto_closed": 2}'::jsonb, 'at 19:05 both open shifts are closed');
select results_eq($$select clock_out_at = clock_in_at, auto_closed from public.daymark_shifts
                    where placement_id = tests.placement((select a from ids))$$,
  $$values (true, true)$$, 'D3 the clock-out is the clock-in, flagged auto_closed');
select ok(exists (select 1 from public.daymark_punches where user_id = (select a from ids) and source = 'auto_close'
                  and event_type = 'shift_out' and occurred_at = '2026-10-14 09:00+09:30'), 'R5.1.7 as a system punch');
select results_eq($$select counted, auto_closed, no_show, short from public.daymark_day_results
                    where placement_id = tests.placement((select a from ids)) and work_date = '2026-10-14'$$,
  $$values (0, true, false, 450)$$, 'D3 it counts 0 until a punch fix; not a no-show');
select results_eq($$select counted, late, left_early, short from public.daymark_day_results
                    where placement_id = tests.placement((select b from ids)) and work_date = '2026-10-14'$$,
  $$values (0, true, false, 240)$$, 'D3 a clock-in after the scheduled end also closes at 0');
select ok(exists (select 1 from public.daymark_notifications where person_id = (select a from ids) and kind = 'auto_close'
                  and title = 'You didn''t clock out on Wed 14 Oct'), 'the intern is told to send a punch fix');
insert into snaps select 'auto', pg_temp.snap();
select is(private.job_auto_close(), '{"auto_closed": 0}'::jsonb, 'a second auto-close finds nothing');
select is(pg_temp.snap(), (select v from snaps where k = 'auto'), 'and changes nothing');

-- Day close (19:10): overtime requests, no-shows, target reached
select tests.at('2026-10-14 19:10+09:30');
select private.job_day_close();
select results_eq($$select type, status, requested_minutes, dates, payload from public.daymark_requests
                    where intern_id = (select c from ids)$$,
  $$values ('overtime', 'pending_supervisor', 120, '{2026-10-13}'::date[], '{"work_date": "2026-10-13"}'::jsonb)$$,
  'R5.4.7 an unscheduled shift becomes a pending overtime request');
select is((select array_agg(requested_minutes order by requested_minutes) from public.daymark_requests
           where intern_id in ((select d from ids), (select e from ids))), '{30,120}'::int[],
  'R5.4.7 overtime past the scheduled length is requested');
select ok(exists (select 1 from public.daymark_notifications where person_id = tests.supervisor() and kind = 'overtime'
                  and body = 'jb.c worked 2h past their scheduled time on Tue 13 Oct.')
          and exists (select 1 from public.daymark_notifications where person_id = (select c from ids) and kind = 'overtime'),
  'the supervisor is asked to review and the intern to add a reason');
select is((select count(*)::int from public.daymark_notifications where kind = 'no_shows'
           and link = '/supervisor/intern?id=' || tests.placement((select f from ids)) || '&fortnight=2026-10-12'), 1,
  'R5.5.3 three no-shows this fortnight: the supervisor is told');
select results_eq($$select status, target_reached_at from public.daymark_placements where intern_id = (select g from ids)$$,
  $$values ('target_reached', '2026-10-14 19:10+09:30'::timestamptz)$$, 'R5.11.1 counted total reached the target');
select ok(exists (select 1 from public.daymark_notifications where person_id = tests.supervisor() and kind = 'target_reached')
          and exists (select 1 from public.daymark_audit_log where action = 'target_reached'
                      and row_id = tests.placement((select g from ids))::text),
  'the supervisor is told and it is audited');
insert into snaps select 'close1', pg_temp.snap();
select private.job_day_close();
select is(pg_temp.snap(), (select v from snaps where k = 'close1'), 'a second day close changes nothing');

-- R5.4.8 partial approval (as the Phase 5 decision would), then a punch fix lowers the overtime
update public.daymark_requests
set status = 'approved', approved_minutes = 90, supervisor_decision = 'approved', supervisor_id = tests.supervisor(),
    supervisor_decided_at = '2026-10-14 20:00+09:30'
where intern_id = (select d from ids);
select is((tests.day((select d from ids), '2026-10-14')).counted, 540, 'R5.4.9 counted = 450 base + 90 of 120 approved');
select tests.at('2026-10-15 10:00+09:30');
insert into public.daymark_punches (user_id, event_type, source, occurred_at, replaces_punch_id)
select x.user_id, 'shift_out', 'punch_fix', '2026-10-14 17:00+09:30', x.id from public.daymark_punches x
where x.user_id in ((select d from ids), (select e from ids)) and x.event_type = 'shift_out' and x.occurred_at::date = '2026-10-14';
select results_eq($$select overtime, approved_ot, counted from public.daymark_day_results
                    where placement_id = tests.placement((select d from ids)) and work_date = '2026-10-14'$$,
  $$values (60, 60, 510)$$, 'after the fix only the remaining 60 overtime minutes count');
select tests.at('2026-10-15 19:10+09:30');
select private.job_day_close();
select results_eq($$select status, requested_minutes, approved_minutes from public.daymark_requests where intern_id = (select d from ids)$$,
  $$values ('approved', 60, 60)$$, '§8.11 the approval is clamped to the new overtime');
select ok(exists (select 1 from public.daymark_audit_log where action = 'overtime_clamped'
                  and (before ->> 'approved_minutes')::int = 90 and (after ->> 'approved_minutes')::int = 60),
  'the clamp is audited');
select ok(exists (select 1 from public.daymark_notifications where person_id = tests.supervisor() and kind = 'overtime_clamped'
                  and body like '%below the 1h 30m you approved. It now counts 1h.'), 'the supervisor is told');
select ok((select status = 'cancelled' from public.daymark_requests where intern_id = (select e from ids))
          and exists (select 1 from public.daymark_audit_log where action = 'overtime_cancelled'),
  'a pending request whose overtime fell to 0 is cancelled and audited');
select is((select count(*)::int from public.daymark_notifications where kind = 'no_shows'
           and link = '/supervisor/intern?id=' || tests.placement((select f from ids)) || '&fortnight=2026-10-12'), 1,
  'R5.5.3 only once per fortnight');
insert into snaps select 'close2', pg_temp.snap();
select private.job_day_close();
select is(pg_temp.snap(), (select v from snaps where k = 'close2'), 'running day close again changes nothing');

-- §8.4 once the target is reached the forecast is that date
select tests.as_person((select g from ids));
select results_eq($$select p ->> 'remaining', p ->> 'forecast_finish', p ->> 'pace', p -> 'risk_reasons'
                    from public.placement_progress(tests.placement((select g from ids))) p$$,
  $$values ('0', '2026-10-14', 'green', '[]'::jsonb)$$, 'forecast = the day the target was reached');
reset role;

-- Reconcile (02:00)
select tests.at('2026-10-16 02:00+09:30');
update public.daymark_day_results set counted = 1
where placement_id = tests.placement((select f from ids)) and work_date = '2026-10-13';
select is(private.job_reconcile(), '{"drift": 1}'::jsonb, 'reconcile repairs a drifted day');
insert into snaps select 'rec', pg_temp.snap();
select is(private.job_reconcile(), '{"drift": 0}'::jsonb, 'a second run finds nothing');
select is(pg_temp.snap(), (select v from snaps where k = 'rec'), 'and changes nothing');

-- §10 run_job: admin only, audited
select tests.as_person((select admin from ids));
select is(public.run_job('reconcile'), '{"drift": 0}'::jsonb, 'the admin runs a job by name');
reset role;
select ok(exists (select 1 from public.daymark_audit_log where action = 'run_job' and row_id = 'reconcile'
                  and actor_id = (select admin from ids)), 'the manual run is audited');
select tests.as_person(tests.supervisor());
select throws_ok($$select public.run_job('day_close')$$, '42501', 'Only an active admin can do that.', 'supervisors cannot run jobs');
reset role;
select tests.as_person((select admin from ids));
select throws_ok($$select public.run_job('purge')$$, '22023', 'Pick a job: auto_close, day_close, reconcile, escalate, retention_reminders or clock_guard.', 'unknown jobs are refused');
reset role;

-- A2 pg_cron schedules (UTC)
select results_eq($$select jobname::text, schedule::text, command from cron.job where jobname in ('daymark-auto-close', 'daymark-day-close', 'daymark-reconcile') order by jobname$$,
  $$values ('daymark-auto-close', '35 9 * * *', 'select private.job_auto_close()'),
           ('daymark-day-close', '40 9 * * *', 'select private.job_day_close()'),
           ('daymark-reconcile', '30 16 * * *', 'select private.job_reconcile()')$$,
  'jobs run at 19:05, 19:10 and 02:00 Darwin');

select * from finish();
rollback;

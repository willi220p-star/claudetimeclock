begin;
select plan(16);

-- §8.3 progress, §8.4 forecast, §8.8 risk. Now is Wed 14 Oct 2026, 20:00 (today is closed).
select tests.at('2026-10-14 20:00+09:30');
create temp table ids as
select tests.create_intern('pg.a@test.dev', null, '{1,3}', '2026-09-28', '2026-11-20', '09:00', '17:00', 7200) as a,
       tests.create_intern('pg.b@test.dev', null, '{1,2,3,4,5}', '2026-10-19', '2026-10-30', '09:00', '17:00', 4500) as b,
       tests.create_intern('pg.c@test.dev', null, '{1,2,3,4,5}', '2026-09-28', '2026-11-27', '09:00', '17:00', 3000) as c,
       tests.create_intern('pg.d@test.dev', null, '{}', '2026-09-28', '2026-11-27', '09:00', '17:00', 600) as d,
       tests.create_person('pg.admin@test.dev', false, false, true) as admin;
grant select on ids to authenticated;

-- A (Mon/Wed, 16 days, target 7200): full days 28 Sep, 30 Sep and 12 Oct, half day today,
-- sick leave on 5 Oct, and 7 Oct cancelled by an office closure added later.
select tests.shift((select a from ids), '2026-09-28 09:00', '2026-09-28 17:00');
select tests.shift((select a from ids), '2026-09-30 09:00', '2026-09-30 17:00');
select tests.shift((select a from ids), '2026-10-12 09:00', '2026-10-12 17:00');
select tests.shift((select a from ids), '2026-10-14 09:00', '2026-10-14 13:00');
update public.daymark_scheduled_days set status = 'leave', leave_kind = 'sick'
where placement_id = tests.placement((select a from ids)) and work_date = '2026-10-05';
insert into public.daymark_closure_days (site_id, day, name, kind)
select site_id, '2026-10-07', 'Office move', 'office_closure' from public.daymark_placements
where id = tests.placement((select a from ids));
insert into public.daymark_checkins (placement_id, supervisor_id, week_start, reliability, quality, communication)
values (tests.placement((select a from ids)), tests.supervisor(), '2026-10-05', 5, 5, 5),
       (tests.placement((select a from ids)), tests.supervisor(), '2026-10-12', 2, 3, 3);

-- C (Mon–Fri, target 3000): one 30-minute shift on day one, then nothing.
select tests.shift((select c from ids), '2026-09-28 09:00', '2026-09-28 09:30');

-- Everything the admin can see, through the progress view.
select tests.as_person((select admin from ids));
create temp table prog as select * from public.daymark_v_placement_progress;
reset role;

select results_eq(
  $$select expected_to_date, counted_to_date, owed from prog where intern_id = (select a from ids)$$,
  $$values (2250, 1590, 660)$$,
  'R5.6 leave days are expected (owed), cancelled closure days are not; owed = expected − counted');
select results_eq(
  $$select counted_total, remaining, future_sched, schedule_gap from prog where intern_id = (select a from ids)$$,
  $$values (1590, 5610, 4500, 1110)$$, '§8.3 remaining, future scheduled and schedule gap');
select results_eq(
  $$select week_no, total_weeks, fortnight_start, fortnight_end from prog where intern_id = (select a from ids)$$,
  $$values (3, 8, '2026-10-12'::date, '2026-10-25'::date)$$, 'R5.7 Week 3 of 8 and the current fortnight');
select results_eq(
  $$select forecast_ratio, forecast_finish, days_late, pace from prog where intern_id = (select a from ids)$$,
  $$values (0.75, '2026-12-14'::date, 24, 'red')$$,
  '§8.4 ratio 1350/1800, schedule runs out, pattern walk past the planned end: 24 days late is red');
select results_eq(
  $$select risk_reasons, latest_checkin_average from prog where intern_id = (select a from ids)$$,
  $$values ('{schedule_gap,owed,forecast_late,low_checkin}'::text[], 2.67)$$,
  'R5.10 schedule gap > 240, owed > 240, forecast > 5 days late, latest check-in average < 3.0');

-- B starts next week: no history, ratio 1.0, finishes exactly on the planned end.
select results_eq(
  $$select forecast_ratio, forecast_finish, pace, risk_reasons from prog where intern_id = (select b from ids)$$,
  $$values (1.0, '2026-10-30'::date, 'green', '{}'::text[])$$, '§8.4 no history: ratio 1.0, on pace, not at risk');

-- C: 30 of 5400 expected minutes clamps the ratio at 0.2.
select results_eq(
  $$select forecast_ratio, forecast_finish, days_late, pace from prog where intern_id = (select c from ids)$$,
  $$values (0.2, '2026-11-30'::date, 3, 'amber')$$, '§8.4 ratio clamped at 0.2: 3 days late is amber');
select results_eq(
  $$select risk_reasons, no_shows_fortnight from prog where intern_id = (select c from ids)$$,
  $$values ('{owed,no_shows}'::text[], 3)$$, 'R5.10 two or more no-shows this fortnight');

-- D has no usual days: no forecast.
select results_eq(
  $$select forecast_finish, pace, risk_reasons from prog where intern_id = (select d from ids)$$,
  $$values (null::date, 'red', '{schedule_gap,forecast_late}'::text[])$$, '§8.4 no pattern: no forecast, pace red');

-- RPCs and who sees what (§6)
select tests.as_person((select a from ids));
select is((public.placement_progress(tests.placement((select a from ids))) ->> 'owed')::int, 660, 'an intern reads their progress');
select is((select count(*)::int from public.daymark_v_placement_progress), 1, 'and only theirs in the view');
reset role;
select tests.as_person((select b from ids));
select is(public.placement_progress(tests.placement((select a from ids))), null, 'another intern gets nothing');
select is((select count(*)::int from public.daymark_checkins), 0, 'or their check-ins');
reset role;
select tests.as_person(tests.supervisor());
select is((select count(*)::int from public.progress_for_supervisor()), 4, 'the supervisor gets each of their interns');
select throws_ok($$select public.progress_all()$$, '42501', 'Only an active admin can do that.', 'progress_all is admin only');
reset role;
select tests.as_person((select admin from ids));
select is((select count(*)::int from public.progress_all()), (select count(*)::int from public.daymark_placements),
  'the admin gets every placement');
reset role;

select * from finish();
rollback;

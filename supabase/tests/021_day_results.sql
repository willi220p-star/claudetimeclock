begin;
select plan(18);

-- R5.4 day results. Everything below happens at Fri 30 Oct 20:00, so October days are closed.
-- d works Mon–Fri 9:00–5:00 (planned 450); e works Mon and Wed only.
select tests.at('2026-10-30 20:00+09:30');
create temp table ids as
select tests.create_intern('dr.d@test.dev') as d,
       tests.create_intern('dr.e@test.dev', null, '{1,3}') as e;

-- R5.4.2 break rule: a 29-minute gap still takes the break, a 30-minute gap doesn't
select tests.shift((select d from ids), '2026-10-05 09:00', '2026-10-05 12:00');
select tests.shift((select d from ids), '2026-10-05 12:29', '2026-10-05 15:30');
select results_eq($$select raw, break, worked from public.daymark_day_results
                    where placement_id = tests.placement((select d from ids)) and work_date = '2026-10-05'$$,
  $$values (361, 30, 331)$$, 'R5.4.2 a 29-minute gap: 30-minute break');
select tests.shift((select d from ids), '2026-10-06 09:00', '2026-10-06 12:00');
select tests.shift((select d from ids), '2026-10-06 12:30', '2026-10-06 15:31');
select results_eq($$select raw, break, worked from public.daymark_day_results
                    where placement_id = tests.placement((select d from ids)) and work_date = '2026-10-06'$$,
  $$values (361, 0, 361)$$, 'R5.4.2 a 30-minute gap: no break');

-- R5.4.2 raw exactly 300 vs 301
select tests.shift((select d from ids), '2026-10-07 09:00', '2026-10-07 14:00');
select results_eq($$select raw, break, worked from public.daymark_day_results
                    where placement_id = tests.placement((select d from ids)) and work_date = '2026-10-07'$$,
  $$values (300, 0, 300)$$, 'raw exactly 300: no break');
select tests.shift((select d from ids), '2026-10-08 09:00', '2026-10-08 14:01');
select results_eq($$select raw, break, worked from public.daymark_day_results
                    where placement_id = tests.placement((select d from ids)) and work_date = '2026-10-08'$$,
  $$values (301, 30, 271)$$, 'raw 301: 30-minute break');

-- R5.4.4 worked 610: 10 minutes over the maximum never count
select tests.shift((select d from ids), '2026-10-09 07:00', '2026-10-09 17:40');
select results_eq($$select raw, worked, countable, over_max, base, overtime, counted from public.daymark_day_results
                    where placement_id = tests.placement((select d from ids)) and work_date = '2026-10-09'$$,
  $$values (640, 610, 600, 10, 450, 150, 450)$$, 'R5.4.4 worked 610: countable 600, over maximum 10');

-- R5.4.11 length-based: 8:30 start on a 9:00 schedule, full length, is a full day
select tests.shift((select d from ids), '2026-10-12 08:30', '2026-10-12 16:30');
select results_eq($$select raw, worked, base, overtime, late, left_early, short from public.daymark_day_results
                    where placement_id = tests.placement((select d from ids)) and work_date = '2026-10-12'$$,
  $$values (480, 450, 450, 0, false, false, 0)$$, 'R5.4.11 an early full-length day is a full day, not overtime');

-- R5.4.12 late after 15 minutes of grace
select tests.shift((select d from ids), '2026-10-13 09:15', '2026-10-13 17:15');
select is((tests.day((select d from ids), '2026-10-13')).late, false, 'R5.4.12 in at 9:15 is on time');
select tests.shift((select d from ids), '2026-10-14 09:16', '2026-10-14 17:16');
select is((tests.day((select d from ids), '2026-10-14')).late, true, 'R5.4.12 in at 9:16 is late');

-- R5.4.10 / R5.4.13 short and left early
select tests.shift((select d from ids), '2026-10-15 09:00', '2026-10-15 16:00');
select results_eq($$select worked, short, left_early from public.daymark_day_results
                    where placement_id = tests.placement((select d from ids)) and work_date = '2026-10-15'$$,
  $$values (390, 60, true)$$, 'R5.4.13 out at 4:00 on a 5:00 day is short 60 and left early');

-- R5.5.2 no-show: a passed scheduled day with no shift
select results_eq($$select no_show, short, counted from public.daymark_day_results
                    where placement_id = tests.placement((select d from ids)) and work_date = '2026-10-16'$$,
  $$values (true, 450, 0)$$, 'R5.5.2 a passed day with no shift is a no-show, short the full length');

-- Unscheduled shift: everything is overtime, pending until approved (R5.4.7)
select tests.shift((select e from ids), '2026-10-13 10:00', '2026-10-13 12:00');
select results_eq($$select scheduled, base, overtime, counted, unscheduled from public.daymark_day_results
                    where placement_id = tests.placement((select e from ids)) and work_date = '2026-10-13'$$,
  $$values (0, 0, 120, 0, true)$$, 'an unscheduled shift is all pending overtime');

-- Leave: nothing scheduled that day, not a no-show (the hours stay owed, see progress)
update public.daymark_scheduled_days set status = 'leave', leave_kind = 'sick'
where placement_id = tests.placement((select d from ids)) and work_date = '2026-10-19';
select results_eq($$select scheduled, no_show, short from public.daymark_day_results
                    where placement_id = tests.placement((select d from ids)) and work_date = '2026-10-19'$$,
  $$values (0, false, 0)$$, 'a leave day is not a no-show');

-- §8.2 cache = compute over every row
select is((select count(*)::int from public.daymark_day_results r
           where to_jsonb(r) - 'computed_at'
                 is distinct from to_jsonb(private.compute_day(r.placement_id, r.work_date)) - 'computed_at'),
  0, 'cache = compute for every stored day');

-- R5.4.10 short stays empty until the day closes at 19:00
select tests.at('2026-11-02 12:00+09:30');
select tests.shift((select d from ids), '2026-11-02 09:00', '2026-11-02 11:00');
select results_eq($$select closed, short from public.daymark_day_results
                    where placement_id = tests.placement((select d from ids)) and work_date = '2026-11-02'$$,
  $$values (false, null::integer)$$, 'R5.4.10 no short time before the day closes');
select tests.at('2026-11-02 19:00:00+09:30');
select private.recompute_day(tests.placement(x), '2026-11-02') from (select d from ids union all select e from ids) t(x);  -- as day close would
select results_eq($$select closed, short from public.daymark_day_results
                    where placement_id = tests.placement((select d from ids)) and work_date = '2026-11-02'$$,
  $$values (true, 330)$$, 'R5.4.10 closed at 19:00:00, short 330');

-- §8.2 reconciliation fixes drift and audits it
update public.daymark_day_results set counted = 999
where placement_id = tests.placement((select d from ids)) and work_date = '2026-10-20';
select is(private.reconcile_day_results(14), 1, 'one drifted day is found');
select ok(exists (select 1 from public.daymark_audit_log where action = 'day_result_drift'
                  and row_id = tests.placement((select d from ids)) || ':2026-10-20'
                  and (before ->> 'counted')::int = 999 and (after ->> 'counted')::int = 0),
  'the drift is audited with before and after');
select is((tests.day((select d from ids), '2026-10-20')).counted, 0, 'and fixed');

select * from finish();
rollback;

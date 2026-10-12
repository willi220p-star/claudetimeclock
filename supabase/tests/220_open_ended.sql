begin;
select plan(31);

-- Open-ended placements (Dilip, 13 Oct; D47). Mon 12 Oct; 12 weeks ahead is Mon 4 Jan 2027.
select tests.without_seed();
select tests.at('2026-10-12 07:00+09:30');
create temp table ids as
select tests.create_person('oe.admin@test.dev', false, false, true) as admin,
       tests.create_person('oe.a@test.dev') as a,
       tests.create_intern('oe.b@test.dev', null, '{1,2,3,4,5}', '2026-10-12', null, '09:00', '17:00', null) as b,
       tests.create_intern('oe.dated@test.dev', null, '{1,2,3,4,5}', '2026-10-12', '2026-12-18', '09:00', '17:00', 24000) as dated;
grant select on ids to authenticated, service_role;
create temp table b_pl (id uuid);
grant select on b_pl to authenticated, service_role;
create temp table res (k text primary key, v uuid);
grant all on res to authenticated;
select tests.at('2026-10-12 07:00+09:30');

-- Validation: the start date is required, the end date only has to follow it.
select tests.as_person((select admin from ids));
select throws_ok($$select public.save_placement(jsonb_build_object(
  'intern_id', (select a from ids), 'supervisor_id', tests.supervisor(), 'university', 'CDU', 'course', 'Business',
  'start_date', '', 'pattern', '[]'::jsonb))$$, '22023', 'Pick a start date.', 'a blank start date is refused');
select throws_ok($$select public.save_placement(jsonb_build_object(
  'intern_id', (select a from ids), 'supervisor_id', tests.supervisor(), 'university', 'CDU', 'course', 'Business',
  'start_date', '2026-10-12', 'planned_end_date', '2026-10-11', 'pattern', '[]'::jsonb))$$, '22023', null,
  'an end date before the start is refused');
select throws_ok($$select public.save_placement(jsonb_build_object(
  'intern_id', (select a from ids), 'supervisor_id', tests.supervisor(), 'university', 'CDU', 'course', 'Business',
  'start_date', '2026-10-12', 'target_minutes', 30, 'pattern', '[]'::jsonb))$$, '22023', null,
  'a target, when given, is still 1 to 2,000 hours');

-- No end date and no target: allowed.
insert into res values ('a', public.save_placement(jsonb_build_object(
  'intern_id', (select a from ids), 'supervisor_id', tests.supervisor(), 'university', 'CDU', 'course', 'Business',
  'start_date', '2026-10-12', 'planned_end_date', '', 'target_minutes', '',
  'pattern', '[{"weekday":1,"start":"09:00","end":"17:00"},{"weekday":2,"start":"09:00","end":"17:00"},
               {"weekday":3,"start":"09:00","end":"17:00"},{"weekday":4,"start":"09:00","end":"17:00"},
               {"weekday":5,"start":"09:00","end":"17:00"}]'::jsonb)));
reset role;
select ok((select planned_end_date is null and original_end_date is null and target_minutes is null
           from public.daymark_placements where id = (select v from res where k = 'a')), 'saved with no end date and no target');

-- The roster runs 12 weeks ahead, no further.
select is((select max(work_date) from public.daymark_scheduled_days where placement_id = (select v from res where k = 'a')),
  '2027-01-04'::date, 'days are rostered through today + 84');
select is((select count(*)::int from public.daymark_scheduled_days where placement_id = (select v from res where k = 'a')
           and work_date > '2027-01-04'), 0, 'and none beyond');
select is((select max(work_date) from public.daymark_scheduled_days where placement_id = tests.placement((select dated from ids))),
  '2026-12-18'::date, 'a dated placement still runs to its end date');

-- It rolls forward a day as the clock moves, once.
select tests.at('2026-10-13 07:00+09:30');
create temp table dated_before as
select count(*)::int as n from public.daymark_scheduled_days where placement_id = tests.placement((select dated from ids));
select is(private.job_roll_rosters(), 2, 'the next day is added for each open-ended placement');
select is((select max(work_date) from public.daymark_scheduled_days where placement_id = (select v from res where k = 'a')),
  '2027-01-05'::date, 'the roster now reaches Tue 5 Jan');
select is(private.job_roll_rosters(), 0, 'a repeat run adds nothing');
select is((select count(*)::int from public.daymark_scheduled_days where placement_id = tests.placement((select dated from ids))),
  (select n from dated_before), 'dated placements are left alone');
select ok(private.job_reminders() >= 0, 'job_reminders runs the roll too');
-- A cancelled day isn't brought back.
update public.daymark_scheduled_days set status = 'cancelled'
where placement_id = (select v from res where k = 'a') and work_date = '2027-01-05';
select is(private.job_roll_rosters(), 0, 'cancelled days stay cancelled');

-- Progress: hours done, no forecast, no pace, no risk from pacing.
select tests.shift((select a from ids), '2026-10-12 09:00', '2026-10-12 17:00');
select tests.as_person((select a from ids));
select ok((select (j ->> 'forecast_finish') is null and (j ->> 'pace') is null and (j ->> 'total_weeks') is null
           from (select public.kpi_intern() as j) x), 'the intern sees no forecast and no pace');
select is((select (public.kpi_intern() ->> 'counted_total')::int), 450, 'hours done are counted');
select ok((select jsonb_array_length(public.catch_up_slots((select v from res where k = 'a')) -> 'days') > 0),
  'catch-up still offers days inside the rolling roster');
reset role;
select tests.as_person((select admin from ids));
select ok((select j -> 'forecast_finish' = 'null' and j -> 'pace' = 'null' and j -> 'target_minutes' = 'null'
                  and j -> 'remaining' = 'null' and j -> 'schedule_gap' = 'null' and not (j -> 'risk_reasons' ? 'forecast_late')
                  and not (j -> 'risk_reasons' ? 'schedule_gap')
           from (select public.placement_progress((select v from res where k = 'a')) as j) x),
  'staff progress carries no forecast, pace or pacing risk');
select ok((select j -> 'forecast_finish' = 'null' and j -> 'pace' = 'null'
           from (select public.placement_progress(tests.placement((select b from ids))) as j) x),
  'nor for an open-ended placement made directly');
select ok((select j -> 'forecast_finish' <> 'null' and j -> 'pace' <> 'null'
           from (select public.placement_progress(tests.placement((select dated from ids))) as j) x),
  'a dated placement still has a forecast and pace');
reset role;

-- No target: never target_reached.
select tests.at('2026-10-13 19:30+09:30');
select private.job_day_close();
select is((select status from public.daymark_placements where id = (select v from res where k = 'a')), 'active',
  'no target, no target_reached');

-- Setting an end date later trims the days past it.
select tests.as_person(tests.supervisor());
select throws_ok(format('select public.extend_placement(%L, %L)', (select v from res where k = 'a'), '2026-10-12'),
  '22023', null, 'the end date is today or later');
select public.extend_placement((select v from res where k = 'a'), '2026-11-13', 'Leaving mid-November');
reset role;
select ok((select planned_end_date = '2026-11-13' and original_end_date = '2026-11-13' and status = 'active'
           from public.daymark_placements where id = (select v from res where k = 'a')), 'the end date is set and the status kept');
select is((select count(*)::int from public.daymark_scheduled_days where placement_id = (select v from res where k = 'a')
           and work_date > '2026-11-13' and status in ('scheduled', 'leave')), 0, 'days past it are cancelled');
select ok(exists (select 1 from public.daymark_scheduled_days where placement_id = (select v from res where k = 'a')
                  and work_date = '2026-11-13' and status = 'scheduled'), 'the end date itself stays rostered');
select ok(exists (select 1 from public.daymark_notifications where person_id = (select a from ids)
                  and title = 'Your placement has an end date'), 'the intern is told');
select tests.as_person((select admin from ids));
select ok((select public.placement_progress((select v from res where k = 'a')) -> 'pace' = 'null'),
  'still no pace without a target');
reset role;

-- An end date past the rolling roster adds the days up to it.
select tests.as_person(tests.supervisor());
select public.extend_placement(tests.placement((select b from ids)), '2027-02-26');
reset role;
select is((select max(work_date) from public.daymark_scheduled_days where placement_id = tests.placement((select b from ids))
           and status = 'scheduled'), '2027-02-26'::date, 'days are added up to a later end date');
select is((select count(*)::int from (select work_date from public.daymark_scheduled_days
           where placement_id = tests.placement((select b from ids)) and status = 'scheduled'
           group by work_date having count(*) > 1) x), 0, 'with no doubled days');

-- Ending an open-ended placement sets its end date; retention counts from the end.
insert into b_pl select tests.placement((select b from ids));
update public.daymark_placements set planned_end_date = null, original_end_date = null where id = (select id from b_pl);
select tests.as_person(tests.supervisor());
select public.withdraw_placement((select id from b_pl), 'Moved interstate');
reset role;
select ok((select planned_end_date = '2026-10-13' and ended_on = '2026-10-13' from public.daymark_placements
           where id = (select id from b_pl)), 'ending sets the end date to the day it ends');
select tests.at('2026-11-13 10:00+09:30');
select ok(exists (select 1 from public.retention_due() where intern_id = (select b from ids)), 'due for deletion 31 days on');
set local role service_role;
select lives_ok($$select public.purge_intern((select b from ids), 0)$$, 'and purged');
reset role;

select * from finish();
rollback;

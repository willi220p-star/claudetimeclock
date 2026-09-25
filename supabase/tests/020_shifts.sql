begin;
select plan(19);

-- §8.1 shift building. Interns work Mon and Wed 9:00–5:00 (planned 450).
create temp table ids as
select tests.create_intern('sh.a@test.dev', null, '{1,3}') as a,
       tests.create_intern('sh.b@test.dev', null, '{1,3}') as b,
       tests.create_intern('sh.c@test.dev', null, '{1,3}') as c;
grant select on ids to authenticated;
select tests.consent_all(a) from ids;

-- A device clock-in opens a shift; the clock-out closes it.
select tests.clock((select a from ids), 'shift_in', '2026-10-14 09:00+09:30');
select results_eq(
  $$select work_date, clock_in_at, clock_out_at is null, unscheduled from public.daymark_shifts
    where placement_id = tests.placement((select a from ids))$$,
  $$values ('2026-10-14'::date, '2026-10-14 09:00+09:30'::timestamptz, true, false)$$,
  'a clock-in opens a shift');
select is((tests.day((select a from ids), '2026-10-14')).raw, 0, 'an open shift adds no minutes yet');
select tests.clock((select a from ids), 'shift_out', '2026-10-14 17:00+09:30');
select is((select clock_out_at from public.daymark_shifts where placement_id = tests.placement((select a from ids))),
  '2026-10-14 17:00+09:30'::timestamptz, 'the clock-out closes it');
select is((tests.day((select a from ids), '2026-10-14')).counted, 450, 'the day counts 450 minutes');

-- R5.1.5 several shifts a day
select tests.at('2026-10-12 20:00+09:30');
select tests.shift((select b from ids), '2026-10-12 09:00', '2026-10-12 12:00');
select tests.shift((select b from ids), '2026-10-12 13:00', '2026-10-12 17:00');
select is((select count(*)::int from public.daymark_shifts where placement_id = tests.placement((select b from ids))
           and work_date = '2026-10-12'), 2, 'two shifts on one day');
select is((tests.day((select b from ids), '2026-10-12')).raw, 420, 'raw sums both shifts');

-- §8.1 a punch fix supersedes the original punch; the original is kept.
insert into public.daymark_punches (user_id, event_type, source, occurred_at, replaces_punch_id)
select (select b from ids), 'shift_out', 'punch_fix', '2026-10-12 17:30+09:30', x.id
from public.daymark_punches x
where x.user_id = (select b from ids) and x.occurred_at = '2026-10-12 17:00+09:30';
select is((select max(clock_out_at) from public.daymark_shifts where placement_id = tests.placement((select b from ids))),
  '2026-10-12 17:30+09:30'::timestamptz, 'the corrected clock-out is used');
select is((select count(*)::int from public.daymark_punches where user_id = (select b from ids)), 5,
  'the original punch is kept');
select is((tests.day((select b from ids), '2026-10-12')).raw, 450, 'the day is recomputed');

-- R5.1.4 old break rows are ignored
alter table public.daymark_punches disable trigger daymark_punches_rules;
insert into public.daymark_punches (user_id, placement_id, event_type, source, occurred_at, latitude, longitude, photo_path)
select (select b from ids), tests.placement((select b from ids)), e, 'device', t::timestamptz, -12.4785082, 130.9854825,
       (select b from ids) || '/' || gen_random_uuid() || '.jpg'
from (values ('break_in', '2026-10-12 10:00+09:30'), ('break_out', '2026-10-12 10:30+09:30')) v(e, t);
alter table public.daymark_punches enable trigger daymark_punches_rules;
select is((tests.day((select b from ids), '2026-10-12')).raw, 450, 'break rows change nothing');

-- Unscheduled shift (Tue is not a pattern day)
select tests.shift((select b from ids), '2026-10-13 10:00', '2026-10-13 12:00');
select ok((select bool_and(unscheduled) from public.daymark_shifts where placement_id = tests.placement((select b from ids))
           and work_date = '2026-10-13'), 'a shift on a day with no scheduled day is unscheduled');

-- A scheduled day that is cancelled makes its shifts unscheduled and the day is recomputed.
update public.daymark_scheduled_days set status = 'cancelled'
where placement_id = tests.placement((select b from ids)) and work_date = '2026-10-12';
select ok((select bool_and(unscheduled) from public.daymark_shifts where placement_id = tests.placement((select b from ids))
           and work_date = '2026-10-12'), 'cancelling the day marks its shifts unscheduled');
select results_eq(
  $$select scheduled, base, overtime, unscheduled from public.daymark_day_results
    where placement_id = tests.placement((select b from ids)) and work_date = '2026-10-12'$$,
  $$values (0, 0, 450, true)$$, 'and the day result follows');

-- D3 an auto-close clock-out at the clock-in instant closes the shift at 0 minutes.
select tests.shift((select b from ids), '2026-10-14 09:00');
insert into public.daymark_punches (user_id, event_type, source, occurred_at)
values ((select b from ids), 'shift_out', 'auto_close', '2026-10-14 09:00+09:30');
select results_eq(
  $$select clock_out_at = clock_in_at, auto_closed from public.daymark_shifts
    where placement_id = tests.placement((select b from ids)) and work_date = '2026-10-14'$$,
  $$values (true, true)$$, 'the auto-closed shift ends at its clock-in');
select is((tests.day((select b from ids), '2026-10-14')).counted, 0, 'an auto-closed shift counts 0');

-- Review §2.7 supervisor-path shifts count 0 until confirmed
select tests.shift((select c from ids), '2026-10-19 09:00', '2026-10-19 17:00', 'supervisor');
select ok((select bool_and(unverified) from public.daymark_shifts where placement_id = tests.placement((select c from ids))
           and work_date = '2026-10-19'), 'an unconfirmed supervisor-path shift is unverified');
select results_eq(
  $$select raw, counted, unverified from public.daymark_day_results
    where placement_id = tests.placement((select c from ids)) and work_date = '2026-10-19'$$,
  $$values (0, 0, true)$$, 'and counts 0');
update public.daymark_punches set confirmed_at = '2026-10-19 17:05+09:30', confirmed_by = tests.supervisor()
where user_id = (select c from ids) and source = 'supervisor';
select results_eq(
  $$select raw, counted, unverified from public.daymark_day_results
    where placement_id = tests.placement((select c from ids)) and work_date = '2026-10-19'$$,
  $$values (480, 450, false)$$, 'once confirmed the day counts');

-- Shifts are read-only for API roles
select tests.as_person((select b from ids));
select throws_ok($$delete from public.daymark_shifts$$, '42501', null, 'interns cannot change shifts');
reset role;

select * from finish();
rollback;

begin;
select plan(20);

-- Test clock (§3)
select has_function('private', 'clock_now', 'private.clock_now exists');
select tests.at('2026-10-14 09:00:00+09:30');
select is(private.clock_now(), '2026-10-14 09:00:00+09:30'::timestamptz, 'clock_now honours daymark.test_now for postgres');
select set_config('daymark.test_now', '', true);
select is(private.clock_now(), now(), 'clock_now falls back to now() when unset');

-- Local e2e clock: honoured for API sessions only when daymark.e2e_clock is on
select set_config('daymark.test_now', '2026-10-14 09:00:00+09:30', true);
select set_config('daymark.e2e_clock', 'on', true);
select tests.as_person(gen_random_uuid());
select is(private.clock_now(), '2026-10-14 09:00:00+09:30'::timestamptz, 'API sessions use the e2e clock when enabled');
reset role;
select ok(private.job_clock_guard(), 'the clock guard notices a fake clock');
select set_config('daymark.e2e_clock', '', true);
select set_config('daymark.test_now', '', true);
select ok(not private.job_clock_guard(), 'no warning without a fake clock');

-- Darwin calendar
select tests.at('2026-10-13 14:29:59+00');
select is(private.darwin_today(), '2026-10-13'::date, 'still the 13th in Darwin at 23:59:59');
select tests.at('2026-10-13 14:30:00+00');
select is(private.darwin_today(), '2026-10-14'::date, 'the 14th in Darwin from 14:30 UTC');
select is(private.darwin_at('2026-10-14', '09:00'), '2026-10-13 23:30:00+00'::timestamptz, 'darwin_at gives the UTC instant');

-- Settings singleton
select is((select count(*)::int from public.daymark_settings), 1, 'one settings row');
select results_eq(
  $$select fortnight_anchor, grace_minutes, max_day_minutes, break_threshold_minutes, break_minutes,
           escalation_hours, retention_days, notice_hours, punch_fix_days, sick_backdate_days, max_accuracy_m
    from public.daymark_settings$$,
  $$values ('2026-09-28'::date, 15, 600, 300, 30, 72, 30, 24, 7, 2, 150)$$,
  'settings defaults match §10'
);
select throws_ok($$insert into public.daymark_settings (id) values (2)$$, '23514', null, 'settings is a singleton');

-- Site and closure days
select results_eq(
  $$select radius_m, standard_capacity, hard_capacity, window_start, window_end, latitude, longitude
    from public.daymark_sites where name = 'Regus Palmerston'$$,
  $$values (200, 3, 4, '07:00'::time, '19:00'::time, -12.4785082::double precision, 130.9854825::double precision)$$,
  'the Regus site row'
);
select is((select count(*)::int from public.daymark_closure_days), 21, '21 NT closure days for 2026-2027');
select ok(exists (select 1 from public.daymark_closure_days where day = '2026-12-28'), 'Boxing Day substitute 2026');

-- RLS
select ok((select bool_and(relrowsecurity) from pg_class
           where relname in ('daymark_settings', 'daymark_sites', 'daymark_closure_days')), 'RLS on');

select tests.as_anon();
select throws_ok($$select count(*) from public.daymark_settings$$, '42501', null, 'anon cannot read settings');
select throws_ok($$select count(*) from public.daymark_closure_days$$, '42501', null, 'anon cannot read closure days');
reset role;

select tests.as_person(gen_random_uuid());
select is((select count(*)::int from public.daymark_sites where name = 'Regus Palmerston'), 1, 'signed-in people read the site');
select throws_ok($$update public.daymark_settings set grace_minutes = 0$$, '42501', null, 'signed-in people cannot change settings');
reset role;

select * from finish();
rollback;

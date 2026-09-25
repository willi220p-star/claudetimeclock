begin;
select plan(14);

-- R5.7.2 fortnights anchored on Mon 28 Sep 2026, real floor before the anchor
select is(private.fortnight_index('2026-09-28'), 0, 'the anchor starts fortnight 0');
select is(private.fortnight_index('2026-10-11'), 0, 'day 13 is still fortnight 0');
select is(private.fortnight_index('2026-10-12'), 1, 'day 14 starts fortnight 1');
select is(private.fortnight_index('2026-09-27'), -1, 'the day before the anchor is fortnight -1, not 0');
select is(private.fortnight_index('2026-09-13'), -2, 'two fortnights back');
select is(private.fortnight_start('2026-09-27'), '2026-09-14'::date, 'fortnight start before the anchor');
select is(private.fortnight_start('2026-10-20'), '2026-10-12'::date, 'fortnight start after the anchor');

-- R5.7.1 / R5.7.3 placement weeks run Mon–Sun from the start date's week
select is(private.week_no('2026-10-04', '2026-09-30'), 1, 'Sunday is still week 1 for a Wednesday start');
select is(private.week_no('2026-10-05', '2026-09-30'), 2, 'Monday starts week 2');
select is(private.week_no('2026-12-18', '2026-09-28'), 12, 'Week x of 12: total weeks = week_no(planned end)');

-- Week and fortnight views sum the day results
select tests.at('2026-10-16 20:00+09:30');
create temp table ids as
select tests.create_intern('pe.a@test.dev', null, '{1,3}') as a, tests.create_intern('pe.b@test.dev') as b;
grant select on ids to authenticated;
select tests.shift((select a from ids), '2026-10-12 09:00', '2026-10-12 17:00');
select tests.shift((select a from ids), '2026-10-14 09:00', '2026-10-14 13:00');
select tests.shift((select a from ids), '2026-10-05 09:00', '2026-10-05 17:00');

select tests.as_person((select a from ids));
select results_eq(
  $$select week_start, week_no, scheduled, worked, counted, short, no_shows from public.daymark_v_week_hours
    where week_start = '2026-10-12'$$,
  $$values ('2026-10-12'::date, 3, 900, 690, 690, 210, 0)$$,
  'week 3: 450 + 240 counted of 900 scheduled');
select results_eq(
  $$select fortnight_start, fortnight_end, scheduled, counted, no_shows from public.daymark_v_fortnight_hours
    where fortnight_start = '2026-09-28'$$,
  $$values ('2026-09-28'::date, '2026-10-11'::date, 1800, 450, 3)$$,
  'fortnight 0: one day worked, three no-shows');
reset role;

-- RLS: the views follow the placement
select tests.as_person((select b from ids));
select is((select count(*)::int from public.daymark_v_week_hours where placement_id = tests.placement((select a from ids))), 0,
  'another intern sees none of these weeks');
select is((select count(*)::int from public.daymark_v_fortnight_hours where placement_id = tests.placement((select a from ids))), 0,
  'or fortnights');
reset role;

select * from finish();
rollback;

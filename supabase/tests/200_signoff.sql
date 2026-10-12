begin;
select plan(36);

-- Weekly sign-off, export and pay (Dilip, 12 Oct; D43). The week is Mon 12 – Sun 18 Oct.
-- A and C have clean weeks; B has one of each open item. All three share tests.supervisor().
create temp table ids as
select tests.create_intern('so.a@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as a,
       tests.create_intern('so.b@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as b,
       tests.create_intern('so.c@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as c,
       tests.create_person('so.sup2@test.dev', false, true, false) as sup2,
       tests.create_person('so.admin@test.dev', false, false, true, 'Priya Admin') as admin;
grant select on ids to authenticated;
select tests.without_seed();
-- B asked for Wednesday off on Monday morning (tests.ask is from 040_requests_setup).
select tests.at('2026-10-12 08:00+09:30');
select tests.ask(b, 'leave', '{"dates":["2026-10-14"],"kind":"personal"}') from ids;
select tests.at('2026-10-18 20:00+09:30');

select tests.shift(a, '2026-10-12 09:00', '2026-10-12 17:00') from ids;
select tests.shift(a, '2026-10-13 09:00', '2026-10-13 17:00') from ids;
select tests.shift(c, '2026-10-12 09:00', '2026-10-12 17:00') from ids;
-- B: a typed-in time waiting (Mon), a pending leave request (Wed), no clock-out (Fri).
select tests.shift(b, '2026-10-12 09:00', null, 'supervisor') from ids;
select tests.shift(b, '2026-10-12 09:00', '2026-10-12 17:00') from ids;
select tests.shift(b, '2026-10-16 09:00') from ids;

-- Not before the week has ended, and only from a Monday.
select tests.as_person(tests.supervisor());
select throws_ok($$select public.sign_week(tests.placement((select a from ids)), '2026-10-12')$$, '22023',
  'You can sign a week once it has ended.', 'refused before the week ends');
reset role;
select tests.at('2026-10-19 08:30+09:30');
select tests.as_person(tests.supervisor());
select throws_ok($$select public.sign_week(tests.placement((select a from ids)), '2026-10-13')$$, '22023', null,
  'refused on a non-Monday');

-- Open items block signing; each kind is listed with a plain label, in date order.
select results_eq($$select kind, work_date, label from public.week_open_items(tests.placement((select b from ids)), '2026-10-12')$$,
  $$values ('unconfirmed_time', '2026-10-12'::date, 'Unconfirmed time on Mon 12 Oct'),
           ('pending_request', '2026-10-14'::date, 'Leave request waiting on Wed 14 Oct'),
           ('no_clock_out', '2026-10-16'::date, 'No clock-out on Fri 16 Oct')$$,
  'the three kinds of open item are listed');
select throws_ok($$select public.sign_week(tests.placement((select b from ids)), '2026-10-12')$$, 'P0001',
  'Fix the open items first.', 'refused while items are open');
select is((select count(*)::int from public.week_open_items(tests.placement((select a from ids)), '2026-10-12')), 0,
  'a clean week has no open items');
reset role;

-- Who may sign.
select tests.as_person((select a from ids));
select throws_ok($$select public.sign_week(tests.placement((select a from ids)), '2026-10-12')$$, '42501', null,
  'an intern can''t sign');
select throws_ok($$select * from public.week_open_items(tests.placement((select a from ids)), '2026-10-12')$$, '42501', null,
  'an intern can''t list open items');
reset role;
select tests.as_person((select sup2 from ids));
select throws_ok($$select public.sign_week(tests.placement((select a from ids)), '2026-10-12')$$, '42501', null,
  'another supervisor can''t sign');
reset role;

-- The supervisor signs A's clean week; the admin signs C's.
select tests.at('2026-10-19 10:00+09:30');
select tests.as_person(tests.supervisor());
select is(public.sign_week(tests.placement((select a from ids)), '2026-10-12'),
  jsonb_build_object('signed_at', '2026-10-19 10:00+09:30'::timestamptz, 'counted_minutes', 900), 'sign a clean week');
select throws_ok($$select public.sign_week(tests.placement((select a from ids)), '2026-10-12')$$, 'P0001', 'Already signed.',
  'a week is signed once');
reset role;
select tests.as_person((select admin from ids));
select is((public.sign_week(tests.placement((select c from ids)), '2026-10-12') ->> 'counted_minutes')::int, 450,
  'an admin can sign');
reset role;
select is((select count(*)::int from public.daymark_audit_log where action = 'sign_week'
           and row_id in (select id::text from public.daymark_week_signoffs where placement_id in
                          (select tests.placement(a) from ids union select tests.placement(c) from ids))), 2, 'signing is audited');

-- week_signoffs: the supervisor sees their placements, the signer's name; an intern sees nothing.
select tests.as_person(tests.supervisor());
select results_eq($$select placement_id, signed_by_name, counted_minutes from public.week_signoffs('2026-10-12', '2026-10-12')
                    where placement_id = tests.placement((select c from ids))$$,
  $$values (tests.placement((select c from ids)), 'Priya Admin'::text, 450)$$, 'the supervisor sees who signed');
reset role;
select tests.as_person((select sup2 from ids));
select is((select count(*)::int from public.week_signoffs('2026-10-01', '2026-10-31')), 0, 'another supervisor sees none');
reset role;

-- A recompute that changes nothing doesn't reopen.
select private.recompute_day(tests.placement(c), d::date) from ids, generate_series('2026-10-12'::date, '2026-10-18', '1 day') d;
select is((select count(*)::int from public.daymark_week_signoffs where placement_id = (select tests.placement(c) from ids)
           and reopened_at is null), 1, 'a no-op recompute doesn''t reopen');

-- A counted change reopens A's week, keeps the old row, tells the signer and is audited.
select tests.at('2026-10-19 11:00+09:30');
select tests.shift(a, '2026-10-14 09:00', '2026-10-14 13:00') from ids;
select results_eq($$select reopened_at, reopened_reason, counted_minutes from public.daymark_week_signoffs
                    where placement_id = tests.placement((select a from ids))$$,
  $$values ('2026-10-19 11:00+09:30'::timestamptz, 'Times changed on Wed 14 Oct'::text, 900)$$,
  'the week reopens and the row is kept');
select is((select body from public.daymark_notifications where person_id = tests.supervisor() and kind = 'times'
           and title = 'A signed week reopened'),
  'Times changed for so.a in the week of Mon 12 Oct. Sign it again in Timesheets.', 'the signer is told');
select is((select count(*)::int from public.daymark_audit_log where action = 'reopen_week'
           and row_id = (select w.id::text from public.daymark_week_signoffs w where w.placement_id = (select tests.placement(a) from ids))),
  1, 'reopening is audited');
select is((select count(*)::int from public.daymark_week_signoffs where placement_id = (select tests.placement(c) from ids)
           and reopened_at is null), 1, 'another placement''s week stays signed');

-- Pay.
select tests.as_person(tests.supervisor());
select throws_ok($$select public.set_placement_pay(tests.placement((select c from ids)), true, 25)$$, '42501', null,
  'only an admin sets pay');
reset role;
select tests.as_person((select admin from ids));
select throws_ok($$select public.set_placement_pay(tests.placement((select c from ids)), true)$$, '22023',
  'Set an hourly rate above 0.', 'paid needs a rate');
select throws_ok($$select public.set_placement_pay(tests.placement((select c from ids)), true, 0)$$, '22023',
  'Set an hourly rate above 0.', 'the rate is above 0');
select public.set_placement_pay(tests.placement(a), false, 30) from ids;
reset role;
select results_eq($$select paid, hourly_rate from public.daymark_placements where id = tests.placement((select a from ids))$$,
  $$values (false, null::numeric)$$, 'unpaid keeps no rate');
select tests.as_person((select admin from ids));
select public.set_placement_pay(tests.placement(c), true, 25.50) from ids;
reset role;
select results_eq($$select paid, hourly_rate from public.daymark_placements where id = tests.placement((select c from ids))$$,
  $$values (true, 25.50::numeric)$$, 'paid with a rate');
select is((select count(*)::int from public.daymark_audit_log where action = 'set_placement_pay'
           and row_id = (select tests.placement(c)::text from ids)), 1, 'pay changes are audited');
select throws_ok($$update public.daymark_placements set paid = true, hourly_rate = null where id = tests.placement((select a from ids))$$,
  '23514', null, 'the table refuses paid without a rate');

-- Export: only live signed days; amount = rate x hours.
select tests.as_person((select sup2 from ids));
select throws_ok($$select * from public.signoff_export('2026-10-12', '2026-10-18')$$, '42501', null, 'only an admin exports');
reset role;
select tests.as_person((select admin from ids));
create temp table export as select * from public.signoff_export('2026-10-12', '2026-10-18');
reset role;
select is((select count(*)::int from export where placement_id in (select tests.placement(a) from ids union select tests.placement(b) from ids)),
  0, 'reopened and unsigned weeks aren''t exported');
select is((select count(*)::int from export where placement_id = (select tests.placement(c) from ids)),
  (select count(*)::int from public.daymark_day_results where placement_id = (select tests.placement(c) from ids)
     and work_date between '2026-10-12' and '2026-10-18'), 'one row per day of the signed week');
select results_eq($$select intern_name, week_start, counted_minutes, break_minutes, paid, hourly_rate, amount from export
                    where work_date = '2026-10-12'$$,
  $$values ('so.c'::text, '2026-10-12'::date, 450, 30, true, 25.50::numeric, 191.25::numeric)$$, 'amount is the rate times the hours');
select is((select sum(amount) from export), round(450 / 60.0 * 25.50, 2), 'days without hours are worth 0');

-- Reminders: Monday morning, once, to the supervisor with unsigned weeks (A reopened, B never signed).
select tests.at('2026-10-19 08:55+09:30');
select is(private.job_signoff_reminders(), 0, 'nothing before 9 am');
select tests.at('2026-10-19 09:30+09:30');
select private.job_reminders();
select results_eq($$select title, body, link from public.daymark_notifications where person_id = tests.supervisor() and kind = 'signoff'$$,
  $$values ('Weeks to sign'::text, '2 weeks to sign by Tuesday 5 pm.'::text, '/supervisor/timesheets'::text)$$,
  'the supervisor is reminded on Monday morning');
select is((select count(*)::int from public.daymark_notifications where person_id = tests.supervisor() and kind = 'signoff'),
  1, 'once a day') from (select private.job_reminders()) x;
select tests.at('2026-10-21 09:30+09:30');
select is(private.job_signoff_reminders(), 0, 'not on a Wednesday');
select ok('signoff' = any (private.push_kind_options())
          and (select 'signoff' = any (push_kinds) from public.daymark_settings where id = 1),
  'signoff is a push kind, ticked');

select * from finish();
rollback;

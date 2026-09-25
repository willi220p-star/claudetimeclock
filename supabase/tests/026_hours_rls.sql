begin;
select plan(11);

-- §6 / §14 RLS on the Phase 3 tables and views: intern A vs B, supervisor scope, anon nothing.
select tests.at('2026-10-12 20:00+09:30');
create temp table ids as
select tests.create_intern('rl.a@test.dev') as a,
       tests.create_intern('rl.b@test.dev') as b,
       tests.create_person('rl.sup2@test.dev', false, true, false) as sup2;
grant select on ids to authenticated;
update public.daymark_placements set supervisor_id = (select sup2 from ids) where id = tests.placement((select b from ids));
select tests.shift((select a from ids), '2026-10-12 09:00', '2026-10-12 17:00');
insert into public.daymark_work_logs (placement_id, work_date, summary)
values (tests.placement((select a from ids)), '2026-10-12', 'Answered the phones all day');
insert into public.daymark_checkins (placement_id, supervisor_id, week_start, reliability, quality, communication)
values (tests.placement((select a from ids)), tests.supervisor(), '2026-10-12', 4, 4, 4);

create temp view seen with (security_invoker = true) as
select array[
  exists (select 1 from public.daymark_shifts where placement_id = tests.placement((select a from ids))),
  exists (select 1 from public.daymark_day_results where placement_id = tests.placement((select a from ids))),
  exists (select 1 from public.daymark_work_logs where placement_id = tests.placement((select a from ids))),
  exists (select 1 from public.daymark_checkins where placement_id = tests.placement((select a from ids))),
  exists (select 1 from public.daymark_v_day_hours where placement_id = tests.placement((select a from ids))),
  exists (select 1 from public.daymark_v_week_hours where placement_id = tests.placement((select a from ids)))
] as v;
grant select on seen to authenticated;

select tests.as_person((select a from ids));
select is((select v from seen), array[true, true, true, true, true, true], 'intern A reads their own hours, log and check-in');
reset role;
select tests.as_person((select b from ids));
select is((select v from seen), array[false, false, false, false, false, false], 'intern B reads none of A''s');
reset role;
select tests.as_person(tests.supervisor());
select is((select v from seen), array[true, true, true, true, true, true], 'A''s supervisor reads them');
reset role;
select tests.as_person((select sup2 from ids));
select is((select v from seen), array[false, false, false, false, false, false], 'another supervisor does not');
reset role;

select tests.as_anon();
select throws_ok($$select count(*) from public.daymark_shifts$$, '42501', null, 'anon cannot read shifts');
select throws_ok($$select count(*) from public.daymark_day_results$$, '42501', null, 'anon cannot read day results');
select throws_ok($$select count(*) from public.daymark_work_logs$$, '42501', null, 'anon cannot read work logs');
select throws_ok($$select count(*) from public.daymark_checkins$$, '42501', null, 'anon cannot read check-ins');
reset role;

-- No direct writes for API roles: changes go through the engine and RPCs.
select tests.as_person((select a from ids));
select throws_ok($$insert into public.daymark_work_logs (placement_id, work_date, summary)
                   values (tests.placement((select a from ids)), '2026-10-13', 'Wrote this directly')$$,
  '42501', null, 'interns cannot insert work logs directly');
select throws_ok($$update public.daymark_day_results set counted = 600$$, '42501', null, 'interns cannot change day results');
reset role;
select tests.as_person(tests.supervisor());
select throws_ok($$insert into public.daymark_checkins (placement_id, week_start, reliability, quality, communication)
                   values (tests.placement((select a from ids)), '2026-10-19', 5, 5, 5)$$,
  '42501', null, 'check-ins are not written directly');
reset role;

select * from finish();
rollback;

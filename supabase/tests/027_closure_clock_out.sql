begin;
select plan(2);

create temp table ids as select tests.create_intern('cco@test.dev') as i;
grant select on ids to authenticated;
select tests.consent_all(i) from ids;
select tests.clock((select i from ids), 'shift_in', '2026-10-14 09:00+09:30');
insert into public.daymark_closure_days (day, name, kind) values ('2026-10-14', 'Power outage', 'office_closure');

select lives_ok($$select tests.clock((select i from ids), 'shift_out', '2026-10-14 11:00+09:30')$$,
  'an intern already in can clock out after a same-day closure');
select throws_ok($$select tests.clock((select i from ids), 'shift_in', '2026-10-14 11:30+09:30')$$,
  'P0001', 'The office is closed today for Power outage.', 'but cannot clock in again');

select * from finish();
rollback;

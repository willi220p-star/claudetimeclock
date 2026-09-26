begin;
select plan(2);

-- Closures no longer block clocking at all (Dilip, 26 Sep: always on). Kept as a closure-specific
-- regression check now that R5.1.2's closure block is gone (it used to trap whoever was already in).
create temp table ids as select tests.create_intern('cco@test.dev') as i;
grant select on ids to authenticated;
select tests.consent_all(i) from ids;
select tests.clock((select i from ids), 'shift_in', '2026-10-14 09:00+09:30');
insert into public.daymark_closure_days (day, name, kind) values ('2026-10-14', 'Power outage', 'office_closure');

select lives_ok($$select tests.clock((select i from ids), 'shift_out', '2026-10-14 11:00+09:30')$$,
  'an intern already in can clock out on a same-day closure');
select lives_ok($$select tests.clock((select i from ids), 'shift_in', '2026-10-14 11:30+09:30')$$,
  'and can clock back in on the same closure day');

select * from finish();
rollback;

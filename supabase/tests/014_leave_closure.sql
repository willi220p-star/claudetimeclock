begin;
select plan(3);

create temp table ids as select tests.create_intern('lv@test.dev', null, '{3}', '2026-10-12', '2026-10-30') as i;
update public.daymark_scheduled_days set status = 'leave', leave_kind = 'personal'
where placement_id = private.current_placement((select i from ids)) and work_date = '2026-10-21';

-- R5.2.5 a closure over a leave day cancels it (not owed) and keeps the leave kind for the record
select lives_ok($$insert into public.daymark_closure_days (day, name, kind) values ('2026-10-21', 'Office move', 'office_closure')$$,
  'a closure can land on a leave day');
select results_eq($$select status, leave_kind from public.daymark_scheduled_days
                    where placement_id = private.current_placement((select i from ids)) and work_date = '2026-10-21'$$,
  $$values ('cancelled'::text, 'personal'::text)$$, 'the leave day is cancelled, kind kept');
select throws_ok($$update public.daymark_scheduled_days set leave_kind = 'sick'
                   where placement_id = private.current_placement((select i from ids)) and work_date = '2026-10-14'$$,
  '23514', null, 'a scheduled day still cannot carry a leave kind');

select * from finish();
rollback;

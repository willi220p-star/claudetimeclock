begin;
select plan(12);

insert into public.daymark_sites (id, name, address, latitude, longitude)
values ('00000000-0000-0000-0000-00000000c0de', 'Capacity site', 'Test', -12.4785082, 130.9854825);
create temp table ids as
select tests.create_person('cap.admin@test.dev', false, false, true) as admin,
       tests.create_intern('cap1@test.dev', '00000000-0000-0000-0000-00000000c0de', '{3}', '2026-10-12', '2026-10-16') as i1,
       tests.create_intern('cap2@test.dev', '00000000-0000-0000-0000-00000000c0de', '{3}', '2026-10-12', '2026-10-16') as i2,
       tests.create_intern('cap3@test.dev', '00000000-0000-0000-0000-00000000c0de', '{3}', '2026-10-12', '2026-10-16') as i3,
       tests.create_person('cap4@test.dev') as i4,
       tests.create_person('cap5@test.dev') as i5,
       tests.create_intern('cap6@test.dev', '00000000-0000-0000-0000-00000000c0de', '{1}', '2026-10-12', '2026-10-16') as i6;
grant select on ids to authenticated;
select tests.at('2026-10-01 10:00+09:30');

select is((select count(*)::int from public.daymark_scheduled_days
           where site_id = '00000000-0000-0000-0000-00000000c0de' and work_date = '2026-10-14' and status = 'scheduled'), 3,
  'R5.3.1 headcount is 3');
select is(private.assert_capacity('00000000-0000-0000-0000-00000000c0de', array['2026-10-14','2026-10-15']::date[], false),
  array['2026-10-14']::date[], 'R5.3.4 a 4th returns needs-extra-spot dates');

-- R5.3.4 / R5.3.7: an admin placing a 4th needs to confirm; it is audited
select tests.as_person((select admin from ids));
select throws_ok($$select public.save_placement(jsonb_build_object(
  'intern_id', (select i4 from ids), 'supervisor_id', tests.supervisor(), 'site_id', '00000000-0000-0000-0000-00000000c0de',
  'university', 'U', 'course', 'C', 'start_date', '2026-10-12', 'planned_end_date', '2026-10-16', 'target_minutes', 600,
  'pattern', '[{"weekday":3,"start":"09:00","end":"17:00"}]'::jsonb))$$,
  'P0001', 'Some days would need an extra spot (a 4th intern): Wed 14 Oct.', 'a 4th needs confirmation');
select lives_ok($$select public.save_placement(jsonb_build_object(
  'intern_id', (select i4 from ids), 'supervisor_id', tests.supervisor(), 'site_id', '00000000-0000-0000-0000-00000000c0de',
  'university', 'U', 'course', 'C', 'start_date', '2026-10-12', 'planned_end_date', '2026-10-16', 'target_minutes', 600,
  'pattern', '[{"weekday":3,"start":"09:00","end":"17:00"}]'::jsonb), true)$$,
  'R5.3.7 the admin override places a 4th');
reset role;
select ok(exists (select 1 from public.daymark_audit_log where action = 'capacity_override'), 'the override is audited');

-- R5.3.5 never a 5th
select tests.as_person((select admin from ids));
select throws_ok($$select public.save_placement(jsonb_build_object(
  'intern_id', (select i5 from ids), 'supervisor_id', tests.supervisor(), 'site_id', '00000000-0000-0000-0000-00000000c0de',
  'university', 'U', 'course', 'C', 'start_date', '2026-10-12', 'planned_end_date', '2026-10-16', 'target_minutes', 600,
  'pattern', '[{"weekday":3,"start":"09:00","end":"17:00"}]'::jsonb), true)$$,
  'P0001', 'That day already has 4 interns — the office limit (Wed 14 Oct).', 'not even the admin can place a 5th');
-- §8.6 a pattern change that would make a 5th is rejected and lists the dates
select throws_like($$select public.set_pattern(private.current_placement((select i6 from ids)), '2026-10-12',
  '[{"weekday":3,"start":"09:00","end":"17:00"}]'::jsonb, true)$$,
  '%office limit (Wed 14 Oct)%', 'a pattern change onto a full day lists the date');
reset role;

set local daymark.extra_spot_ok = 'on';
select throws_ok($$insert into public.daymark_scheduled_days (placement_id, site_id, work_date, start_time, end_time)
  values (private.current_placement((select i6 from ids)), '00000000-0000-0000-0000-00000000c0de', '2026-10-14', '09:00', '12:00')$$,
  'P0001', 'That day already has 4 interns — the office limit (Wed 14 Oct).', 'the trigger stops a 5th even with extra_spot_ok');
set local daymark.extra_spot_ok = 'off';
update public.daymark_scheduled_days set status = 'cancelled'
where placement_id = private.current_placement((select i4 from ids));
select throws_ok($$insert into public.daymark_scheduled_days (placement_id, site_id, work_date, start_time, end_time)
  values (private.current_placement((select i6 from ids)), '00000000-0000-0000-0000-00000000c0de', '2026-10-14', '09:00', '12:00')$$,
  'P0001', 'Wed 14 Oct is full. An extra spot needs supervisor and admin approval.', 'the trigger needs extra_spot_ok for a 4th');
select lives_ok($$select private.add_scheduled_day(private.current_placement((select i6 from ids)), '2026-10-15', '09:00', '12:00',
  'extra_day', null, false)$$, 'an extra day under standard capacity is added');

-- Wizard preview
select tests.as_person((select admin from ids));
select is((select array_agg(status order by work_date) from public.capacity_preview('00000000-0000-0000-0000-00000000c0de',
  '2026-10-12', '2026-10-16', '[{"weekday":1,"start":"09:00","end":"12:00"},{"weekday":3,"start":"09:00","end":"12:00"}]'::jsonb)),
  array['ok','extra']::text[], 'the preview marks the day that needs an extra spot');
reset role;
insert into public.daymark_closure_days (site_id, day, name, kind) values ('00000000-0000-0000-0000-00000000c0de', '2026-10-12', 'Test', 'office_closure');
select tests.as_person((select admin from ids));
select is((select status from public.capacity_preview('00000000-0000-0000-0000-00000000c0de',
  '2026-10-12', '2026-10-12', '[{"weekday":1,"start":"09:00","end":"12:00"}]'::jsonb)), 'closed',
  'the preview shows closure days');
reset role;

select * from finish();
rollback;

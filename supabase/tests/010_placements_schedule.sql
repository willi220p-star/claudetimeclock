begin;
select plan(30);
select tests.without_seed();

create temp table ids as
select tests.create_person('pl.admin@test.dev', false, false, true) as admin,
       tests.create_person('pl.sup@test.dev', false, true, false) as sup,
       tests.create_person('pl.sup2@test.dev', false, true, false) as sup2,
       tests.create_person('pl.i@test.dev') as intern,
       tests.create_person('pl.j@test.dev') as other,
       tests.create_person('pl.k@test.dev') as xmas;
grant select on ids to authenticated;
create temp table res (k text primary key, v uuid);
grant all on res to authenticated;

select tests.at('2026-09-20 10:00+09:30');

-- Only admins create placements (§6)
select tests.as_person((select sup from ids));
select throws_ok($$select public.save_placement(jsonb_build_object('intern_id', (select intern from ids)))$$,
  '42501', null, 'supervisors cannot create placements');
reset role;

select tests.as_person((select admin from ids));
insert into res values ('pl', public.save_placement(jsonb_build_object(
  'intern_id', (select intern from ids), 'supervisor_id', (select sup from ids),
  'university', 'Charles Darwin University', 'course', 'Bachelor of Business',
  'start_date', '2026-09-28', 'planned_end_date', '2026-10-25', 'target_minutes', 3600,
  'pattern', '[{"weekday":1,"start":"09:00","end":"17:00"},{"weekday":3,"start":"09:00","end":"17:00"}]'::jsonb)));
reset role;

-- R5.2.2 generation, R5.2.4 planned minutes
select is((select count(*)::int from public.daymark_scheduled_days where placement_id = (select v from res where k = 'pl')), 8,
  'Mon and Wed from 28 Sep to 25 Oct = 8 days');
select is((select distinct planned_minutes from public.daymark_scheduled_days where placement_id = (select v from res where k = 'pl')), 450,
  '9:00–5:00 plans 450 minutes');
select is((select original_end_date from public.daymark_placements where id = (select v from res where k = 'pl')), '2026-10-25'::date,
  'original end date is kept');
select ok(exists (select 1 from public.daymark_audit_log where action = 'create_placement'), 'creation is audited');
select ok(exists (select 1 from public.daymark_notifications where person_id = (select intern from ids) and kind = 'placement'),
  'the intern is notified');

-- Validation and segregation of duties
select tests.as_person((select admin from ids));
select throws_ok($$select public.save_placement(jsonb_build_object(
  'intern_id', (select intern from ids), 'supervisor_id', (select sup from ids), 'university', 'U', 'course', 'C',
  'start_date', '2026-11-02', 'planned_end_date', '2026-11-30', 'target_minutes', 600,
  'pattern', '[{"weekday":2,"start":"09:00","end":"17:00"}]'::jsonb))$$,
  '23505', 'This intern already has a live placement.', 'one live placement per intern');
select throws_ok($$select public.save_placement(jsonb_build_object(
  'intern_id', (select other from ids), 'supervisor_id', (select other from ids), 'university', 'U', 'course', 'C',
  'start_date', '2026-11-02', 'planned_end_date', '2026-11-30', 'target_minutes', 600,
  'pattern', '[{"weekday":2,"start":"09:00","end":"17:00"}]'::jsonb))$$,
  '22023', 'Pick an active supervisor who isn''t the intern.', 'an intern cannot supervise themselves');
select throws_ok($$select public.save_placement(jsonb_build_object(
  'intern_id', (select other from ids), 'supervisor_id', (select sup from ids), 'university', 'U', 'course', 'C',
  'start_date', '2026-11-02', 'planned_end_date', '2026-10-30', 'target_minutes', 600,
  'pattern', '[{"weekday":2,"start":"09:00","end":"17:00"}]'::jsonb))$$,
  '22023', 'The planned end date must be on or after the start date.', 'dates are checked');
select throws_ok($$select public.save_placement(jsonb_build_object(
  'intern_id', (select other from ids), 'supervisor_id', (select sup from ids), 'university', 'U', 'course', 'C',
  'start_date', '2026-11-02', 'planned_end_date', '2026-11-30', 'target_minutes', 600,
  'pattern', '[{"weekday":6,"start":"09:00","end":"17:00"}]'::jsonb))$$,
  '22023', null, 'R5.2.1 Saturday is not a pattern day');
select throws_ok($$select public.save_placement(jsonb_build_object(
  'intern_id', (select other from ids), 'supervisor_id', (select sup from ids), 'university', 'U', 'course', 'C',
  'start_date', '2026-11-02', 'planned_end_date', '2026-11-30', 'target_minutes', 600,
  'pattern', '[{"weekday":2,"start":"06:45","end":"12:00"}]'::jsonb))$$,
  '22023', null, 'R5.2.1 days start at 7:00 or later');
select throws_ok($$select public.save_placement(jsonb_build_object(
  'intern_id', (select other from ids), 'supervisor_id', (select sup from ids), 'university', 'U', 'course', 'C',
  'start_date', '2026-11-02', 'planned_end_date', '2026-11-30', 'target_minutes', 600,
  'pattern', '[{"weekday":2,"start":"09:10","end":"12:00"}]'::jsonb))$$,
  '22023', null, 'R5.2.1 15-minute steps');
select throws_ok($$select public.save_placement(jsonb_build_object(
  'intern_id', (select other from ids), 'supervisor_id', (select sup from ids), 'university', 'U', 'course', 'C',
  'start_date', '2026-11-02', 'planned_end_date', '2026-11-30', 'target_minutes', 600,
  'pattern', '[{"weekday":2,"start":"07:00","end":"17:15"}]'::jsonb))$$,
  '22023', null, 'R5.2.1 at most 600 minutes');
reset role;

-- R5.2.2 closure days are skipped
select tests.as_person((select admin from ids));
insert into res values ('xmas', public.save_placement(jsonb_build_object(
  'intern_id', (select xmas from ids), 'supervisor_id', (select sup from ids), 'university', 'U', 'course', 'C',
  'start_date', '2026-12-21', 'planned_end_date', '2026-12-31', 'target_minutes', 600,
  'pattern', '[{"weekday":1,"start":"09:00","end":"13:00"},{"weekday":2,"start":"09:00","end":"13:00"},{"weekday":3,"start":"09:00","end":"13:00"},{"weekday":4,"start":"09:00","end":"13:00"},{"weekday":5,"start":"09:00","end":"13:00"}]'::jsonb)));
reset role;
select is((select array_agg(work_date order by work_date) from public.daymark_scheduled_days where placement_id = (select v from res where k = 'xmas')),
  array['2026-12-21','2026-12-22','2026-12-23','2026-12-24','2026-12-29','2026-12-30','2026-12-31']::date[],
  'Christmas and Boxing Day (observed) are skipped');
select is((select distinct planned_minutes from public.daymark_scheduled_days where placement_id = (select v from res where k = 'xmas')), 240,
  'a 4-hour day has no break');

-- R5.2.3 one live day per date
select throws_ok($$insert into public.daymark_scheduled_days (placement_id, site_id, work_date, start_time, end_time)
  select placement_id, site_id, work_date, '10:00', '12:00' from public.daymark_scheduled_days
  where placement_id = (select v from res where k = 'pl') order by work_date limit 1$$,
  '23505', null, 'a second live day on the same date is rejected');

-- R5.2.5 a closure day added later cancels the day, not owed, intern told
insert into public.daymark_closure_days (day, name, kind) values ('2026-10-14', 'Office move', 'office_closure');
select is((select status from public.daymark_scheduled_days where placement_id = (select v from res where k = 'pl') and work_date = '2026-10-14'),
  'cancelled', 'the day is cancelled');
select ok(exists (select 1 from public.daymark_notifications where person_id = (select intern from ids) and kind = 'closure'),
  'the intern is told about the closure');

-- §8.6 pattern change from a date keeps earlier days and regenerates later ones
select tests.at('2026-10-09 10:00+09:30');
select tests.as_person((select admin from ids));
select throws_ok($$select public.set_pattern((select v from res where k = 'pl'), '2026-10-01',
  '[{"weekday":2,"start":"09:00","end":"17:00"}]'::jsonb)$$, '22023', null, 'a pattern cannot start in the past');
select public.set_pattern((select v from res where k = 'pl'), '2026-10-12',
  '[{"weekday":2,"start":"09:00","end":"17:00"},{"weekday":4,"start":"09:00","end":"15:00"}]'::jsonb);
reset role;
select is((select array_agg(work_date order by work_date) from public.daymark_scheduled_days
           where placement_id = (select v from res where k = 'pl') and status = 'scheduled'),
  array['2026-09-28','2026-09-30','2026-10-05','2026-10-07','2026-10-13','2026-10-15','2026-10-20','2026-10-22']::date[],
  'days before the change stay; Tue/Thu from 12 Oct');
select is((select planned_minutes from public.daymark_scheduled_days
           where placement_id = (select v from res where k = 'pl') and work_date = '2026-10-15'), 330,
  '9:00–3:00 plans 330 minutes');

-- §6 visibility
select tests.as_person((select intern from ids));
select is((select count(*)::int from public.daymark_placements), 1, 'an intern sees their own placement');
select is((select display_name from public.daymark_profiles where id = (select sup from ids)), 'pl.sup',
  'an intern sees their supervisor''s name');
reset role;
select tests.as_person((select other from ids));
select is((select count(*)::int from public.daymark_scheduled_days where placement_id = (select v from res where k = 'pl')), 0,
  'another intern cannot see the schedule');
reset role;
select tests.as_person((select sup from ids));
select is((select count(*)::int from public.daymark_placements where id = (select v from res where k = 'pl')), 1,
  'the supervisor sees the placement');
select is((select count(*)::int from public.daymark_profiles where id = (select intern from ids)), 1,
  'the supervisor sees the intern');
reset role;
select tests.as_person((select sup2 from ids));
select is((select count(*)::int from public.daymark_placements where id = (select v from res where k = 'pl')), 0,
  'another supervisor does not');
reset role;

-- R5.1.1 clocking needs a live placement inside its dates
select tests.at('2026-10-14 09:00+09:30');
select tests.consent_all(other) from ids;
select throws_ok($$select tests.clock((select other from ids), 'shift_in', '2026-10-13 09:00+09:30')$$,
  'P0001', 'You don''t have a placement yet. Ask the DGK admin to set one up.', 'no placement, no clocking');
select tests.consent_all(xmas) from ids;
select throws_ok($$select tests.clock((select xmas from ids), 'shift_in', '2026-12-18 09:00+09:30')$$,
  'P0001', 'Your placement starts Mon 21 Dec.', 'not before the start date');
update public.daymark_placements set status = 'target_reached' where id = (select v from res where k = 'xmas');
select throws_ok($$select tests.clock((select xmas from ids), 'shift_in', '2026-12-22 09:00+09:30')$$,
  'P0001', 'You''ve reached your target hours. Your supervisor will confirm what happens next.', 'A5 target reached blocks clock-in');

select * from finish();
rollback;

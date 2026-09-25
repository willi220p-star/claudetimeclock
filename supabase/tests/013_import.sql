begin;
select plan(11);

create temp table ids as
select tests.create_person('imp.admin@test.dev', false, false, true) as admin,
       tests.create_person('imp.sup@test.dev', false, true, false) as sup;
grant select on ids to authenticated;
create temp table out (k text primary key, v jsonb);
grant all on out to authenticated;
select tests.at('2026-10-01 10:00+09:30');

create temp table batch as select jsonb_build_array(
  jsonb_build_object('display_name', 'Ana Park', 'email', 'ana@uni.dev', 'university', 'CDU', 'course', 'BBus',
    'start_date', '2026-10-12', 'planned_end_date', '2026-12-18', 'target_hours', '120',
    'supervisor_email', 'imp.sup@test.dev', 'cohort', 'Term 4 2026', 'pattern', 'Mon 09:00-17:00; Wed 09:00-17:00'),
  jsonb_build_object('display_name', 'Ben Cho', 'email', 'ben@uni.dev', 'university', 'CDU', 'course', 'BIT',
    'start_date', '2026-10-12', 'planned_end_date', '2026-12-18', 'target_hours', '80.5',
    'supervisor_email', 'imp.sup@test.dev', 'cohort', 'Term 4 2026', 'pattern', 'tue 09:00-13:00')
) as good;
grant select on batch to authenticated;

select tests.as_person((select sup from ids));
select throws_ok($$select public.import_placements((select good from batch), 'Temp-Password-1', true)$$, '42501', null,
  'only admins import');
reset role;

select tests.as_person((select admin from ids));
insert into out values ('dry', public.import_placements((select good from batch), 'Temp-Password-1', true));
reset role;
select ok(((select v from out where k = 'dry') ->> 'ok')::boolean, 'dry run passes for good rows');
select is((select count(*)::int from auth.users where email in ('ana@uni.dev', 'ben@uni.dev')), 0, 'a dry run writes nothing');

select tests.as_person((select admin from ids));
insert into out values ('bad', public.import_placements((select good from batch) || jsonb_build_array(
  jsonb_build_object('display_name', 'Cal', 'email', 'cal@uni.dev', 'university', 'CDU', 'course', 'BIT',
    'start_date', '2026-10-12', 'planned_end_date', '2026-12-18', 'target_hours', '80',
    'supervisor_email', 'nobody@test.dev', 'cohort', '', 'pattern', 'Sat 09:00-17:00')), 'Temp-Password-1', false));
reset role;
select ok(not ((select v from out where k = 'bad') ->> 'ok')::boolean, 'a batch with a bad row fails');
select is((select v #>> '{results,2,error}' from out where k = 'bad'), 'No active supervisor uses nobody@test.dev.',
  'the bad row says why');
select is((select count(*)::int from auth.users where email in ('ana@uni.dev', 'ben@uni.dev', 'cal@uni.dev')), 0,
  'all or nothing: nothing imported');

select tests.as_person((select admin from ids));
select throws_ok($$select public.import_placements((select good from batch), 'short', false)$$, '22023',
  'Use a password between 12 and 72 characters.', 'the batch password is checked');
insert into out values ('real', public.import_placements((select good from batch), 'Temp-Password-1', false));
reset role;
select is(((select v from out where k = 'real') ->> 'imported')::int, 2, 'two rows imported');
select is((select count(*)::int from public.daymark_placements p join public.daymark_profiles x on x.id = p.intern_id
           where x.contact_email in ('ana@uni.dev', 'ben@uni.dev') and x.must_change_password), 2,
  'interns must change the batch password at first sign-in');
select is((select target_minutes from public.daymark_placements p join public.daymark_profiles x on x.id = p.intern_id
           where x.contact_email = 'ben@uni.dev'), 4830, 'target hours become minutes');
select is((select count(*)::int from public.daymark_scheduled_days d join public.daymark_placements p on p.id = d.placement_id
           join public.daymark_profiles x on x.id = p.intern_id where x.contact_email = 'ana@uni.dev'), 20,
  'the pattern generates the schedule (10 Mondays + 10 Wednesdays)');

select * from finish();
rollback;

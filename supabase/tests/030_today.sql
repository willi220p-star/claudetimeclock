begin;
select plan(16);

insert into public.daymark_sites (id, name, address, latitude, longitude)
values ('00000000-0000-0000-0000-0000000a0a0a', 'Board site', 'Test', -12.4785082, 130.9854825);
create temp table ids as
select tests.create_intern('b1@test.dev', '00000000-0000-0000-0000-0000000a0a0a', '{3}', '2026-10-12', '2026-10-30', '09:00', '17:00') as a,
       tests.create_intern('b2@test.dev', '00000000-0000-0000-0000-0000000a0a0a', '{3}', '2026-10-12', '2026-10-30', '09:00', '13:00') as b,
       tests.create_intern('b3@test.dev', '00000000-0000-0000-0000-0000000a0a0a', '{3}', '2026-10-12', '2026-10-30', '10:00', '14:00') as c,
       tests.create_intern('b4@test.dev', '00000000-0000-0000-0000-0000000a0a0a', '{1}', '2026-10-12', '2026-10-30') as d,
       tests.create_person('b.admin@test.dev', false, false, true) as admin;
grant select on ids to authenticated;
select tests.consent_all(a) from ids;
select tests.consent_all(d) from ids;

-- 4th on Wed 14 Oct via an approved extra spot
select set_config('daymark.extra_spot_ok', 'on', true);
insert into public.daymark_scheduled_days (placement_id, site_id, work_date, start_time, end_time, source)
select private.current_placement(d), '00000000-0000-0000-0000-0000000a0a0a', '2026-10-14', '09:00', '17:00', 'extra_day' from ids;
select set_config('daymark.extra_spot_ok', 'off', true);

select tests.clock((select a from ids), 'shift_in', '2026-10-14 08:58+09:30');
select tests.at('2026-10-14 09:20+09:30');

-- §6 intern view: names + status, count as x/3, never a 4th
select tests.as_person((select a from ids));
create temp table board_i as select public.today_board() as j;
reset role;
select is((select j ->> 'label' from board_i), 'Full', 'interns see Full, not 4/3');
select is((select jsonb_array_length(j -> 'people') from board_i), 4, 'interns see everyone scheduled today');
select ok((select bool_and(p ->> 'since' is null and p ->> 'start' is null) from board_i, jsonb_array_elements(j -> 'people') p),
  'interns do not see other people''s times');
select ok((select bool_and(not (p ? 'extra')) from board_i, jsonb_array_elements(j -> 'people') p),
  'interns never see an extra-spot marker');

-- supervisor/admin view: times + extra marker
select tests.as_person(tests.supervisor());
create temp table board_s as select public.today_board() as j;
reset role;
select is((select j ->> 'label' from board_s), '4/3 (+1 extra spot)', 'supervisors see the extra spot');
select is((select p ->> 'status' from board_s, jsonb_array_elements(j -> 'people') p where p ->> 'person_id' = (select a from ids)::text),
  'in', 'clocked in shows In');
select is((select (p ->> 'since')::timestamptz from board_s, jsonb_array_elements(j -> 'people') p where p ->> 'person_id' = (select a from ids)::text),
  '2026-10-14 08:58+09:30'::timestamptz, 'with the time');
select is((select p ->> 'status' from board_s, jsonb_array_elements(j -> 'people') p where p ->> 'person_id' = (select b from ids)::text),
  'late', 'past start + 15 min with no clock-in is Late');
select is((select p ->> 'status' from board_s, jsonb_array_elements(j -> 'people') p where p ->> 'person_id' = (select c from ids)::text),
  'not_in_yet', 'before start is Not in yet');
select is((select count(*)::int from board_s, jsonb_array_elements(j -> 'people') p where (p ->> 'extra')::boolean), 1,
  'one person is marked as the extra spot');

-- R5.3.3 headcounts per day for the schedule
select tests.as_person((select b from ids));
select is((select label from public.site_headcounts('2026-10-14', '2026-10-14')), 'Full', 'interns see Full at 3 or more');
select is((select headcount from public.site_headcounts('2026-10-14', '2026-10-14')), 3, 'interns never see 4');
select is((select label from public.site_headcounts('2026-10-12', '2026-10-12')), '1/3', 'a quiet day reads 1/3');
reset role;

-- ClockCard status
select tests.as_person((select a from ids));
select is((public.clock_status() ->> 'next_event'), 'shift_out', 'clocked-in interns are offered Clock out');
reset role;
-- Weekends no longer block (26 Sep, Dilip: always on); before the placement starts still does.
select tests.at('2026-10-01 09:00+09:30');
select tests.as_person((select d from ids));
select is((public.clock_status() ->> 'block_code'), 'not_started', 'blocked states carry a code for the fix action');
reset role;

-- Realtime publication
select ok((select count(*) = 2 from pg_publication_tables where pubname = 'supabase_realtime'
           and tablename in ('daymark_notifications', 'daymark_punches')), 'notifications and punches are published');

select * from finish();
rollback;

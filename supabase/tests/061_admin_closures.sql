begin;
select plan(33);

-- Phase 7: closure days (§6, §10, R5.2.5). Four interns on Wednesdays at one site; the 4th
-- was placed by an admin capacity override (R5.3.7), so it holds the extra spot.
insert into public.daymark_sites (id, name, address, latitude, longitude)
values ('00000000-0000-0000-0000-00000000c105', 'Closure site', 'Test', -12.4785082, 130.9854825);
create temp table ids as
select tests.create_person('cl.admin@test.dev', false, false, true) as admin,
       tests.create_person('cl.sup@test.dev', false, true, false) as sup,
       tests.create_intern('cl.i1@test.dev', '00000000-0000-0000-0000-00000000c105', '{3}', '2026-10-12', '2026-10-30') as i1,
       tests.create_intern('cl.i2@test.dev', '00000000-0000-0000-0000-00000000c105', '{3}', '2026-10-12', '2026-10-30') as i2,
       tests.create_intern('cl.i3@test.dev', '00000000-0000-0000-0000-00000000c105', '{3}', '2026-10-12', '2026-10-30') as i3,
       tests.create_person('cl.i4@test.dev') as i4;
grant select on ids to authenticated;
create temp table res (k text primary key, v jsonb);
grant all on res to authenticated;
select tests.at('2026-10-01 10:00+09:30');

select tests.as_person((select admin from ids));
select public.save_placement(jsonb_build_object(
  'intern_id', (select i4 from ids), 'supervisor_id', tests.supervisor(), 'site_id', '00000000-0000-0000-0000-00000000c105',
  'university', 'U', 'course', 'C', 'start_date', '2026-10-12', 'planned_end_date', '2026-10-30', 'target_minutes', 600,
  'pattern', '[{"weekday":3,"start":"09:00","end":"17:00"}]'::jsonb), true);
reset role;
-- The override placement is the newest (in one test transaction every now() is equal).
update public.daymark_placements set created_at = created_at + interval '1 minute'
where intern_id = (select i4 from ids);

-- §6 only an admin manages closure days
select tests.as_person((select i1 from ids));
select throws_ok($$select public.save_closure_day(null, '2026-10-14', 'X', 'office_closure')$$, '42501', null,
  'an intern cannot add a closure day');
select throws_ok($$select public.remove_closure_day((select id from public.daymark_closure_days limit 1))$$, '42501', null,
  'an intern cannot remove a closure day');
reset role;
select tests.as_person((select sup from ids));
select throws_ok($$select public.save_closure_day(null, '2026-10-14', 'X', 'office_closure')$$, '42501', null,
  'a supervisor cannot add a closure day');
select throws_ok($$select public.remove_closure_day((select id from public.daymark_closure_days limit 1))$$, '42501', null,
  'a supervisor cannot remove a closure day');
reset role;

-- Validation
select tests.as_person((select admin from ids));
select throws_ok($$select public.save_closure_day(null, '2026-09-30', 'Late notice', 'office_closure')$$,
  '22023', 'Closure days can be added for today or later.', 'no closure days in the past');
select throws_ok($$select public.save_closure_day(null, '2026-10-17', 'Saturday', 'office_closure')$$,
  '22023', 'The office is always closed on weekends. Pick a weekday.', 'no closure days on weekends');
select throws_ok($$select public.save_closure_day(null, '2026-10-14', '  ', 'office_closure')$$,
  '22023', 'Give the closure day a name up to 80 characters.', 'a closure day needs a name');
select throws_ok($$select public.save_closure_day(null, '2026-10-14', 'X', 'party')$$,
  '22023', 'Pick public holiday or office closure.', 'the kind is checked');
select throws_ok($$select public.save_closure_day('00000000-0000-0000-0000-000000000bad', '2026-10-14', 'X', 'office_closure')$$,
  '22023', 'That site doesn''t exist.', 'the site is checked');
select lives_ok($$select public.save_closure_day('00000000-0000-0000-0000-00000000c105', '2026-10-01', 'Power cut', 'office_closure')$$,
  'a closure day can be added for today');
reset role;

-- R5.2.5 integration: adding a closure cancels the days (not owed), tells each intern, audits
select tests.as_person((select admin from ids));
insert into res select 'add', public.save_closure_day('00000000-0000-0000-0000-00000000c105', '2026-10-14', ' Office move ', 'office_closure');
reset role;
select is((select v - 'id' - 'created_at' from res where k = 'add'),
  '{"site_id":"00000000-0000-0000-0000-00000000c105","day":"2026-10-14","name":"Office move","kind":"office_closure","cancelled_days":4}'::jsonb,
  'the closure day is saved and reports 4 cancelled days');
select is((select count(*)::int from public.daymark_scheduled_days
           where site_id = '00000000-0000-0000-0000-00000000c105' and work_date = '2026-10-14' and status = 'cancelled'), 4,
  'all four days on that date are cancelled');
select is((select count(distinct person_id)::int from public.daymark_notifications
           where kind = 'closure' and title = 'Office closed Wed 14 Oct'), 4, 'each intern is told');
select ok(exists (select 1 from public.daymark_audit_log where action = 'add_closure_day' and row_id = (select v ->> 'id' from res where k = 'add')),
  'adding the closure is audited');

-- Saving the same site and day again renames it (no duplicate), audited before/after
select tests.as_person((select admin from ids));
insert into res select 'rename', public.save_closure_day('00000000-0000-0000-0000-00000000c105', '2026-10-14', 'Office move day', 'office_closure');
reset role;
select is((select v ->> 'id' from res where k = 'rename'), (select v ->> 'id' from res where k = 'add'), 'saving again updates the same closure day');
select is((select (v ->> 'cancelled_days')::int from res where k = 'rename'), 0, 'a rename cancels nothing new');
select is((select array[before ->> 'name', after ->> 'name'] from public.daymark_audit_log
           where action = 'update_closure_day' and row_id = (select v ->> 'id' from res where k = 'add')),
  array['Office move', 'Office move day'], 'the rename is audited with before and after');

-- Removal: admin only, future only
select tests.as_person((select admin from ids));
select throws_ok($$select public.remove_closure_day((select id from public.daymark_closure_days
                   where site_id = '00000000-0000-0000-0000-00000000c105' and day = '2026-10-01'))$$,
  '22023', 'Only a future closure day can be removed.', 'today''s closure day stays');
select throws_ok($$select public.remove_closure_day('00000000-0000-0000-0000-000000000bad')$$,
  '22023', 'That closure day doesn''t exist.', 'an unknown closure day is rejected');

-- Removing it restores the pattern days; a day that would be a 4th (extra spot) is skipped
insert into res select 'remove', public.remove_closure_day((select (v ->> 'id')::uuid from res where k = 'add'));
reset role;
select ok(not exists (select 1 from public.daymark_closure_days where id = (select (v ->> 'id')::uuid from res where k = 'add')),
  'the closure day is gone');
select is((select array_agg((x ->> 'intern_id')::uuid order by x ->> 'intern_id') from res, jsonb_array_elements(v -> 'restored') x where k = 'remove'),
  (select array_agg(u order by u::text) from ids, unnest(array[i1, i2, i3]) u), 'the first three interns are restored');
select is((select v -> 'skipped' from res where k = 'remove'),
  (select jsonb_build_array(jsonb_build_object('placement_id', private.current_placement(i4), 'intern_id', i4,
     'display_name', 'cl.i4', 'work_date', '2026-10-14', 'reason', 'extra_spot')) from ids),
  'the 4th is skipped and the admin is told why');
select is((select count(*)::int from public.daymark_scheduled_days
           where site_id = '00000000-0000-0000-0000-00000000c105' and work_date = '2026-10-14' and status = 'scheduled'), 3,
  'three days are back on Wed 14 Oct');
select ok((select bool_and(source = 'pattern' and start_time = '09:00' and end_time = '17:00' and planned_minutes = 450)
           from public.daymark_scheduled_days
           where site_id = '00000000-0000-0000-0000-00000000c105' and work_date = '2026-10-14' and status = 'scheduled'),
  'the restored days follow the pattern');
select ok(not exists (select 1 from public.daymark_scheduled_days
                      where placement_id = private.current_placement((select i4 from ids)) and work_date = '2026-10-14'
                        and status = 'scheduled'), 'the skipped intern has no day');
select is((select count(*)::int from public.daymark_notifications
           where kind = 'schedule' and title = 'Wed 14 Oct is back on your schedule'
             and person_id in (select unnest(array[i1, i2, i3]) from ids)), 3, 'each restored intern is told');
select ok(not exists (select 1 from public.daymark_notifications
                      where person_id = (select i4 from ids) and title like '%back on your schedule'),
  'the skipped intern is not told their day is back');
select ok((select before ->> 'name' = 'Office move day' and jsonb_array_length(after -> 'restored') = 3
                  and jsonb_array_length(after -> 'skipped') = 1
           from public.daymark_audit_log where action = 'remove_closure_day' and row_id = (select v ->> 'id' from res where k = 'add')),
  'the removal is audited with the closure and what was restored');

-- A day the intern swapped away stays away; with room, the 4th is restored
update public.daymark_scheduled_days set status = 'moved'
where placement_id = private.current_placement((select i1 from ids)) and work_date = '2026-10-21';
select tests.as_person((select admin from ids));
insert into res select 'add21', public.save_closure_day(null, '2026-10-21', 'Cyclone warning', 'office_closure');
reset role;
select tests.as_person((select admin from ids));
insert into res select 'remove21', public.remove_closure_day((select (v ->> 'id')::uuid from res where k = 'add21'));
reset role;
select is((select array_agg((x ->> 'intern_id')::uuid order by x ->> 'intern_id') from res, jsonb_array_elements(v -> 'restored') x where k = 'remove21'),
  (select array_agg(u order by u::text) from ids, unnest(array[i2, i3, i4]) u), 'with room for three, the other three are restored');
select is((select v -> 'skipped' from res where k = 'remove21'), '[]'::jsonb, 'nobody is skipped');
select ok(not exists (select 1 from public.daymark_scheduled_days
                      where placement_id = private.current_placement((select i1 from ids)) and work_date = '2026-10-21'
                        and status = 'scheduled'), 'a swapped-away day is not brought back');

-- anon can run none of it
select ok(not has_function_privilege('anon', 'public.save_closure_day(uuid, date, text, text)', 'execute')
      and not has_function_privilege('anon', 'public.remove_closure_day(uuid)', 'execute')
      and not has_function_privilege('anon', 'private.save_closure_day(uuid, date, text, text)', 'execute')
      and not has_function_privilege('anon', 'private.remove_closure_day(uuid)', 'execute'),
  'anon cannot execute the closure RPCs');
select tests.as_anon();
select throws_ok($$select public.remove_closure_day('00000000-0000-0000-0000-000000000bad')$$, '42501', null,
  'anon cannot remove a closure day');
reset role;

select * from finish();
rollback;

-- §9.2 request types: validation and the effect of final approval. Punch fixes are in 044,
-- supervisor confirmation (attendance) in 046.
begin;
select plan(49);

insert into public.daymark_sites (id, name, address, latitude, longitude) values
  ('00000000-0000-0000-0000-0000000e0431', 'Swap site', 'Test', -12.4785082, 130.9854825),
  ('00000000-0000-0000-0000-0000000e0432', 'Pattern site', 'Test', -12.4785082, 130.9854825);
create temp table ids as
select tests.create_person('ty.admin@test.dev', false, false, true) as admin,
       tests.supervisor() as sup,
       tests.create_intern('tysw@test.dev', null, '{1,3}') as sw,
       tests.create_intern('tyq1@test.dev', '00000000-0000-0000-0000-0000000e0431', '{5}') as q1,
       tests.create_intern('tyq2@test.dev', '00000000-0000-0000-0000-0000000e0431', '{5}') as q2,
       tests.create_intern('tyq3@test.dev', '00000000-0000-0000-0000-0000000e0431', '{5}') as q3,   -- 3 on Fridays
       tests.create_intern('tysw2@test.dev', '00000000-0000-0000-0000-0000000e0431', '{1}') as sw2,
       tests.create_intern('tysw3@test.dev', '00000000-0000-0000-0000-0000000e0431', '{1}') as sw3,
       tests.create_intern('tysc@test.dev') as sc,
       tests.create_intern('tylv@test.dev') as lv,
       tests.create_intern('tylv2@test.dev', null, '{3}') as lv2,
       tests.create_intern('tyot@test.dev') as ot,
       tests.create_intern('typc@test.dev') as pc,
       tests.create_intern('tyr1@test.dev', '00000000-0000-0000-0000-0000000e0432', '{3}') as r1,
       tests.create_intern('tyr2@test.dev', '00000000-0000-0000-0000-0000000e0432', '{3}') as r2,
       tests.create_intern('tyr3@test.dev', '00000000-0000-0000-0000-0000000e0432', '{3}') as r3,   -- 3 on Wednesdays
       tests.create_intern('tyr4@test.dev', '00000000-0000-0000-0000-0000000e0432', '{1}') as r4,
       tests.create_intern('typcx@test.dev', '00000000-0000-0000-0000-0000000e0432', '{1}') as pcx,
       tests.create_intern('typcy@test.dev', '00000000-0000-0000-0000-0000000e0432', '{1}') as pcy;
grant select on ids to authenticated;
create temp table req (k text primary key, id uuid);
grant all on req to authenticated;
select tests.at('2026-10-05 10:00+09:30');   -- Mon 5 Oct

-- Swap: old day moved, new day source swap (§9.2)
select is((private.validate_request(tests.draft((select sw from ids), 'swap',
  jsonb_build_object('scheduled_day_id', tests.sday((select sw from ids), '2026-10-07'), 'new_date', '2026-10-08')))).dates,
  '{2026-10-07,2026-10-08}'::date[], 'a swap touches both dates');
insert into req values ('sw', tests.ask((select sw from ids), 'swap',
  jsonb_build_object('scheduled_day_id', tests.sday((select sw from ids), '2026-10-07'), 'new_date', '2026-10-08',
                     'start', '10:00', 'end', '16:00')));
select is(tests.decide((select sup from ids), (select id from req where k = 'sw'), 'approve'), 'approved', 'swap approved');
select is((select status from public.daymark_scheduled_days
           where placement_id = private.current_placement((select sw from ids)) and work_date = '2026-10-07'), 'moved',
  'the old day is moved');
select is((select source || ' ' || start_time || '-' || end_time || ' ' || (origin_request_id = (select id from req where k = 'sw'))::text
           from public.daymark_scheduled_days where id = tests.sday((select sw from ids), '2026-10-08')),
  'swap 10:00:00-16:00:00 true', 'the new day has the new times and source swap');
select ok(exists (select 1 from public.daymark_schedule_history where request_id = (select id from req where k = 'sw')
                  and after ->> 'status' = 'moved'), 'the move is in the schedule history');
insert into req values ('sw_b', tests.ask((select sw from ids), 'swap',
  jsonb_build_object('scheduled_day_id', tests.sday((select sw from ids), '2026-10-12'), 'new_date', '2026-10-13')));
select tests.decide((select sup from ids), (select id from req where k = 'sw_b'), 'approve');
select is((select start_time || '-' || end_time from public.daymark_scheduled_days where id = tests.sday((select sw from ids), '2026-10-13')),
  '09:00:00-17:00:00', 'a swap without times keeps the day''s times');

-- §16 a swap onto a date at 3 needs an extra spot and goes to the admin; at 4 it is rejected
select is(tests.verdict((select sw2 from ids), 'swap',
  jsonb_build_object('scheduled_day_id', tests.sday((select sw2 from ids), '2026-10-12'), 'new_date', '2026-10-16')),
  'ok +extra', 'a swap onto a full day needs an extra spot');
insert into req values ('sw2', tests.ask((select sw2 from ids), 'swap',
  jsonb_build_object('scheduled_day_id', tests.sday((select sw2 from ids), '2026-10-12'), 'new_date', '2026-10-16')));
select is(tests.decide((select sup from ids), (select id from req where k = 'sw2'), 'approve'), 'pending_admin',
  'the supervisor''s approval sends it to the admin');
select is(tests.decide((select admin from ids), (select id from req where k = 'sw2'), 'approve'), 'approved',
  'the admin approves the extra spot');
select is((select count(*)::int from public.daymark_scheduled_days
           where site_id = '00000000-0000-0000-0000-0000000e0431' and work_date = '2026-10-16' and status = 'scheduled'), 4,
  'Fri 16 Oct now has 4');
select ok(exists (select 1 from public.daymark_audit_log where action = 'extra_spot'
                  and after ->> 'origin_request_id' = (select id from req where k = 'sw2')::text), 'the extra spot is audited');
select is(tests.verdict((select sw3 from ids), 'swap',
  jsonb_build_object('scheduled_day_id', tests.sday((select sw3 from ids), '2026-10-12'), 'new_date', '2026-10-16')),
  'Fri 16 Oct already has 4 interns — the office limit. Pick another day.', 'a swap onto a day at 4 is rejected');
select is(tests.verdict((select sw3 from ids), 'swap',
  jsonb_build_object('scheduled_day_id', tests.sday((select sw3 from ids), '2026-10-12'), 'new_date', '2026-10-12')),
  'Pick a different date. To change the times on the same day, ask for a shift change.', 'a swap needs another date');
select is(tests.verdict((select sw3 from ids), 'swap',
  jsonb_build_object('scheduled_day_id', tests.sday((select sw2 from ids), '2026-10-19'), 'new_date', '2026-10-20')),
  'Pick one of your scheduled days to swap.', 'only your own days can be swapped');

-- Shift change: times updated, before/after history
select is(tests.verdict((select sc from ids), 'shift_change',
  jsonb_build_object('scheduled_day_id', tests.sday((select sc from ids), '2026-10-07'), 'start', '09:00', 'end', '17:00')),
  'Those are already the times for Wed 7 Oct.', 'a shift change must change something');
insert into req values ('sc', tests.ask((select sc from ids), 'shift_change',
  jsonb_build_object('scheduled_day_id', tests.sday((select sc from ids), '2026-10-07'), 'start', '08:00', 'end', '18:00')));
select tests.decide((select sup from ids), (select id from req where k = 'sc'), 'approve');
select is((select start_time || '-' || end_time || ' ' || planned_minutes || ' ' || source
           from public.daymark_scheduled_days where id = tests.sday((select sc from ids), '2026-10-07')),
  '08:00:00-18:00:00 570 shift_change', 'the times, planned minutes and source are updated');
select is((select before ->> 'start_time' || ' → ' || (after ->> 'start_time') from public.daymark_schedule_history
           where request_id = (select id from req where k = 'sc')), '09:00:00 → 08:00:00', 'the history keeps before and after');
select tests.at('2026-10-07 08:00+09:30');
select is(tests.verdict((select sc from ids), 'shift_change',
  jsonb_build_object('scheduled_day_id', tests.sday((select sc from ids), '2026-10-08'), 'start', '07:00', 'end', '17:00')),
  'Thu 8 Oct starts in less than 24 hours. Changes need 24 hours'' notice — talk to your supervisor.',
  'C4 counts from the earlier of the old and new start');
select tests.at('2026-10-05 10:00+09:30');

-- Leave: days become leave, hours stay owed
insert into req values ('lv', tests.ask((select lv from ids), 'leave', '{"dates":["2026-10-09","2026-10-07"],"kind":"personal"}'));
select is((select dates from public.daymark_requests where id = (select id from req where k = 'lv')),
  '{2026-10-07,2026-10-09}'::date[], 'leave dates are sorted');
select tests.decide((select sup from ids), (select id from req where k = 'lv'), 'approve');
select is((select string_agg(status || ':' || leave_kind || ':' || planned_minutes, ',' order by work_date)
           from public.daymark_scheduled_days
           where placement_id = private.current_placement((select lv from ids)) and work_date in ('2026-10-07', '2026-10-09')),
  'leave:personal:450,leave:personal:450', 'both days are personal leave and keep their planned minutes (still owed)');
select is((select count(*)::int from public.daymark_schedule_history where request_id = (select id from req where k = 'lv')), 2,
  'each leave day is in the history');
select is(tests.verdict((select lv from ids), 'leave', '{"dates":["2026-10-06"],"kind":"personal"}'),
  'Tue 6 Oct starts in less than 24 hours. Changes need 24 hours'' notice — talk to your supervisor.',
  'personal leave needs 24 h notice');
select is(tests.verdict((select lv from ids), 'leave', '{"dates":["2026-10-06"],"kind":"sick"}'), 'ok',
  'sick leave needs no notice');
select is(tests.verdict((select lv2 from ids), 'leave', '{"dates":["2026-10-08"],"kind":"sick"}'),
  'You''re not scheduled on Thu 8 Oct, so there''s no day to take off.', 'leave only replaces a scheduled day');
select tests.at('2026-10-15 10:00+09:30');   -- Thu 15 Oct
select is(tests.verdict((select lv from ids), 'leave', '{"dates":["2026-10-13"],"kind":"sick"}'), 'ok',
  '§16 sick leave 2 days late is fine');
select is(tests.verdict((select lv from ids), 'leave', '{"dates":["2026-10-12"],"kind":"sick"}'),
  'Sick leave can be asked for up to 2 days after the day. Mon 12 Oct is too long ago — talk to your supervisor.',
  '§16 sick leave 3 days late is rejected');
select tests.punch((select lv from ids), 'shift_in', '2026-10-14 09:00+09:30');
select is(tests.verdict((select lv from ids), 'leave', '{"dates":["2026-10-14"],"kind":"sick"}'),
  'You clocked in on Wed 14 Oct, so it can''t be leave. Ask for a punch fix if your times are wrong.',
  'leave on a day with punches is rejected');
select tests.at('2026-10-05 10:00+09:30');

-- Overtime: system-created (Phase 3), the intern adds a reason, the supervisor approves all or part (R5.4.8)
insert into public.daymark_requests (placement_id, intern_id, type, dates, requested_minutes)
values (private.current_placement((select ot from ids)), (select ot from ids), 'overtime', '{2026-10-02}', 90),
       (private.current_placement((select ot from ids)), (select ot from ids), 'overtime', '{2026-10-01}', 45);
insert into req select 'ot' || extract(day from dates[1]), id from public.daymark_requests where intern_id = (select ot from ids);
select tests.as_person((select ot from ids));
select is(public.add_request_reason((select id from req where k = 'ot2'), 'Finished the client report') ->> 'reason',
  'Finished the client report', 'the intern adds a reason to overtime');
select throws_ok(format($$select public.cancel_request(%L)$$, (select id from req where k = 'ot2')),
  'P0001', 'Overtime requests can''t be cancelled. Your supervisor will decide.', 'overtime cannot be cancelled');
reset role;
select tests.as_person((select lv from ids));
select throws_ok(format($$select public.add_request_reason(%L, 'x')$$, (select id from req where k = 'ot2')),
  '42501', 'You can only add a reason to your own requests.', 'only the intern adds the reason');
reset role;
select throws_ok(format($$select tests.decide(%L, %L, 'approve', null, 120)$$, (select sup from ids), (select id from req where k = 'ot2')),
  '22023', 'Approve between 0 and 1h 30m of overtime.', 'approved minutes cannot exceed the request');
select throws_ok(format($$select tests.decide(%L, %L, 'approve', null, -5)$$, (select sup from ids), (select id from req where k = 'ot2')),
  '22023', 'Approve between 0 and 1h 30m of overtime.', 'approved minutes cannot be negative');
select tests.decide((select sup from ids), (select id from req where k = 'ot2'), 'approve', null, 60);
select is((select status || ' ' || approved_minutes || '/' || requested_minutes from public.daymark_requests
           where id = (select id from req where k = 'ot2')), 'approved 60/90', 'partial approval');
select tests.decide((select sup from ids), (select id from req where k = 'ot1'), 'approve');
select is((select approved_minutes from public.daymark_requests where id = (select id from req where k = 'ot1')), 45,
  'approving without minutes approves all of it');

-- Pattern change (§8.6)
select is(tests.verdict((select pc from ids), 'pattern_change',
  '{"effective_from":"2026-10-05","pattern":[{"weekday":1,"start":"10:00","end":"16:00"}]}'),
  'A new pattern can start tomorrow at the earliest, inside your placement dates.', 'a new pattern starts tomorrow at the earliest');
select is(tests.verdict((select pc from ids), 'pattern_change',
  '{"effective_from":"2026-10-12","pattern":[{"weekday":6,"start":"10:00","end":"16:00"}]}'),
  'Usual days are Monday to Friday, between 7:00 am and 7:00 pm, in 15-minute steps and at most 10 hours.',
  'pattern days are checked');
select is(tests.verdict((select pc from ids), 'pattern_change',
  '{"effective_from":"2026-10-06","pattern":[{"weekday":1,"start":"10:00","end":"16:00"}]}'),
  'Tue 6 Oct starts in less than 24 hours. Changes need 24 hours'' notice — talk to your supervisor.',
  'every changed day needs 24 h notice');
insert into req values ('pc_sc', tests.ask((select pc from ids), 'shift_change',
  jsonb_build_object('scheduled_day_id', tests.sday((select pc from ids), '2026-10-15'), 'start', '08:00', 'end', '12:00')));
select tests.decide((select sup from ids), (select id from req where k = 'pc_sc'), 'approve');
insert into req values ('pc', tests.ask((select pc from ids), 'pattern_change',
  '{"effective_from":"2026-10-12","pattern":[{"weekday":1,"start":"10:00","end":"16:00"},{"weekday":3,"start":"10:00","end":"16:00"}]}'));
select is(tests.status((select id from req where k = 'pc')), 'pending_supervisor', 'the dry run leaves the schedule alone');
select is((select count(*)::int from public.daymark_scheduled_days
           where placement_id = private.current_placement((select pc from ids)) and status = 'scheduled' and work_date >= '2026-10-12'),
  50, 'nothing changes before approval');
select tests.decide((select sup from ids), (select id from req where k = 'pc'), 'approve');
select ok(exists (select 1 from public.daymark_pattern_versions
                  where request_id = (select id from req where k = 'pc') and effective_from = '2026-10-12'),
  'a new pattern version records the request');
select is((select count(*)::int from public.daymark_scheduled_days
           where placement_id = private.current_placement((select pc from ids)) and status = 'scheduled' and work_date >= '2026-10-12'),
  21, '10 Mondays + 10 Wednesdays + the kept shift-change day');
select is((select start_time from public.daymark_scheduled_days where id = tests.sday((select pc from ids), '2026-10-14')),
  '10:00'::time, 'regenerated days use the new times');
select is((select start_time || ' ' || source from public.daymark_scheduled_days where id = tests.sday((select pc from ids), '2026-10-15')),
  '08:00:00 shift_change', 'a shift-change day is kept');
select is((select start_time || ' ' || status from public.daymark_scheduled_days
           where placement_id = private.current_placement((select pc from ids)) and work_date = '2026-10-09'),
  '09:00:00 scheduled', 'days before the change stay');

-- §16 a pattern change that would create a 5th is rejected, listing the dates; a 4th needs an extra spot
select private.add_scheduled_day(private.current_placement((select r4 from ids)), '2026-10-21', '09:00', '17:00', 'admin', null, true);
select is(tests.verdict((select pcx from ids), 'pattern_change',
  '{"effective_from":"2026-10-12","pattern":[{"weekday":1,"start":"09:00","end":"17:00"},{"weekday":3,"start":"09:00","end":"17:00"}]}'),
  'Your new pattern would go past the office limit of 4 interns on Wed 21 Oct. Pick other days or times.',
  'a 5th on one date rejects the pattern change and names the date');
select is(tests.verdict((select pcy from ids), 'pattern_change',
  '{"effective_from":"2026-10-26","pattern":[{"weekday":1,"start":"09:00","end":"17:00"},{"weekday":3,"start":"09:00","end":"17:00"}]}'),
  'ok +extra', 'a 4th on the new days needs an extra spot');
insert into req values ('pcy', tests.ask((select pcy from ids), 'pattern_change',
  '{"effective_from":"2026-10-26","pattern":[{"weekday":1,"start":"09:00","end":"17:00"},{"weekday":3,"start":"09:00","end":"17:00"}]}'));
select is(tests.decide((select sup from ids), (select id from req where k = 'pcy'), 'approve'), 'pending_admin',
  'the extra spots go to the admin');
select is(tests.decide((select admin from ids), (select id from req where k = 'pcy'), 'approve'), 'approved',
  'the admin approves them');
select is((select count(*)::int from public.daymark_scheduled_days
           where placement_id = private.current_placement((select pcy from ids)) and status = 'scheduled'
             and extract(isodow from work_date) = 3), 8, 'eight Wednesdays from 28 Oct to 16 Dec');

select * from finish();
rollback;

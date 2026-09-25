-- §8.9 validate_request: payload shapes, then C1–C7 in order (§9.1). Type-specific rules are in 043/044.
begin;
select plan(34);

insert into public.daymark_sites (id, name, address, latitude, longitude)
values ('00000000-0000-0000-0000-0000000e0041', 'Validation site', 'Test', -12.4785082, 130.9854825);
create temp table ids as
select tests.create_intern('va@test.dev', null, '{1,3}') as a,                              -- Mon + Wed
       tests.create_intern('vc@test.dev', null, '{1}', '2026-11-02', '2026-12-18') as c,     -- starts later
       tests.create_intern('vd@test.dev') as d,
       tests.create_intern('ve@test.dev') as e,
       tests.create_intern('vs1@test.dev', '00000000-0000-0000-0000-0000000e0041', '{4}') as s1,
       tests.create_intern('vs2@test.dev', '00000000-0000-0000-0000-0000000e0041', '{4}') as s2,
       tests.create_intern('vs3@test.dev', '00000000-0000-0000-0000-0000000e0041', '{4}') as s3,  -- 3 on Thursdays
       tests.create_intern('vs4@test.dev', '00000000-0000-0000-0000-0000000e0041', '{1}') as s4,
       tests.create_intern('vs5@test.dev', '00000000-0000-0000-0000-0000000e0041', '{1}') as s5;
grant select on ids to authenticated;
update public.daymark_placements set status = 'withdrawn', ended_on = '2026-10-02'
where intern_id = (select d from ids);
update public.daymark_placements set status = 'target_reached' where intern_id = (select e from ids);
select tests.at('2026-10-05 10:00+09:30');   -- Mon 5 Oct

-- Payload shapes (the future zod schemas)
select is(tests.verdict((select a from ids), 'bogus', '{}'), 'Pick a request type.', 'unknown types are rejected');
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-10-08","start":"09:00","end":"17:00","x":1}'),
  'That request has a field we don''t recognise. Refresh the page and try again.', 'unknown keys are rejected');
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-10-08","start":"09:00"}'),
  'That request is incomplete. Refresh the page and try again.', 'missing keys are rejected');
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-02-30","start":"09:00","end":"17:00"}'),
  'Pick a valid date.', 'impossible dates are rejected');
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-10-08","start":"9am","end":"17:00"}'),
  'Enter times as hours and minutes, like 09:00.', 'times are HH:MM');
select is(tests.verdict((select a from ids), 'swap',
  jsonb_build_object('scheduled_day_id', tests.sday((select a from ids), '2026-10-07'), 'new_date', '2026-10-08', 'start', '09:00')),
  'Pick the start and end times together.', 'swap times come in pairs');
select is(tests.verdict((select a from ids), 'leave', '{"dates":["2026-10-07"],"kind":"holiday"}'),
  'Choose sick or personal leave.', 'leave kind is sick or personal');
select is(tests.verdict((select a from ids), 'leave',
  jsonb_build_object('dates', (select jsonb_agg(d::date) from generate_series('2026-10-07'::date, '2026-10-17', '1 day') d), 'kind', 'personal')),
  'Pick between 1 and 10 different dates.', 'at most 10 leave dates');
select is(tests.verdict((select a from ids), 'punch_fix', '{"date":"2026-10-05"}'),
  'Enter the corrected clock-in time, clock-out time, or both.', 'a punch fix needs a time');
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-10-08","start":"09:00","end":null}'),
  'That request is incomplete. Refresh the page and try again.', 'JSON nulls count as missing');

-- C1 placement is active or extended
select is(tests.verdict((select d from ids), 'extra_day', '{"date":"2026-10-08","start":"09:00","end":"17:00"}'),
  'Your placement has ended, so requests are closed. You can still view and download your records.', 'C1 ended placements');
select is(tests.verdict((select e from ids), 'extra_day', '{"date":"2026-10-08","start":"09:00","end":"17:00"}'),
  'You''ve reached your target hours, so your schedule can''t change. Your supervisor will confirm what happens next.',
  'C1 target reached blocks schedule changes');

-- C2 weekday, not closed, not past, inside the placement
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-10-10","start":"09:00","end":"17:00"}'),
  'Sat 10 Oct is on a weekend. Pick a weekday.', 'C2 weekends');
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-12-25","start":"09:00","end":"17:00"}'),
  'The office is closed on Fri 25 Dec (Christmas Day). Pick another day.', 'C2 closure days');
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-10-02","start":"09:00","end":"17:00"}'),
  'Fri 2 Oct has passed. Pick a day from today on.', 'C2 past dates');
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-12-21","start":"09:00","end":"17:00"}'),
  'Mon 21 Dec is after your planned end date (Fri 18 Dec). Pick an earlier day.', 'C2 after the planned end');
select is(tests.verdict((select c from ids), 'extra_day', '{"date":"2026-10-20","start":"09:00","end":"17:00"}'),
  'Your placement starts Mon 2 Nov. Pick a day from then on.', 'C2 before the start');

-- C3 times
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-10-08","start":"09:10","end":"17:00"}'),
  'Times must be between 7:00 am and 7:00 pm, in 15-minute steps, and at most 10 hours.', 'C3 15-minute steps');
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-10-08","start":"07:00","end":"17:15"}'),
  'Times must be between 7:00 am and 7:00 pm, in 15-minute steps, and at most 10 hours.', 'C3 at most 600 minutes');

-- C4 24 h notice
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-10-06","start":"09:00","end":"17:00"}'),
  'Tue 6 Oct starts in less than 24 hours. Changes need 24 hours'' notice — talk to your supervisor.', 'C4 23 h is too soon');
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-10-06","start":"10:00","end":"17:00"}'),
  'ok', 'C4 exactly 24 h is enough');

-- C5 one live day per date
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-10-07","start":"09:00","end":"17:00"}'),
  'You''re already scheduled on Wed 7 Oct.', 'C5 one live day per date');

-- C6 capacity (§8.5)
select is(tests.verdict((select s4 from ids), 'extra_day', '{"date":"2026-10-08","start":"09:00","end":"17:00"}'),
  'ok +extra', 'C6 a 4th needs an extra spot');
select private.add_scheduled_day(private.current_placement((select s4 from ids)), '2026-10-15', '09:00', '17:00', 'admin', null, true);
select is(tests.verdict((select s5 from ids), 'extra_day', '{"date":"2026-10-15","start":"09:00","end":"17:00"}'),
  'Thu 15 Oct already has 4 interns — the office limit. Pick another day.', 'C6 a 5th is rejected');

-- Reason
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-10-08","start":"09:00","end":"17:00"}', '   '),
  'Add a short reason.', 'a reason is required');

-- The insert trigger re-validates, stamps the clock and forces the first state (R5.12.2)
select throws_ok($$insert into public.daymark_requests (placement_id, intern_id, type, payload, reason)
  values (private.current_placement((select a from ids)), (select a from ids), 'extra_day',
          '{"date":"2026-10-10","start":"09:00","end":"17:00"}', 'Reason')$$,
  'P0001', 'Sat 10 Oct is on a weekend. Pick a weekday.', 'the insert trigger re-validates');
insert into public.daymark_requests (placement_id, intern_id, type, payload, reason, status, admin_decision)
values (private.current_placement((select a from ids)), (select a from ids), 'extra_day',
        '{"date":"2026-10-08","start":"09:00","end":"17:00"}', 'Reason', 'approved', 'approved');
select is((select status from public.daymark_requests where intern_id = (select a from ids)), 'pending_supervisor',
  'nothing is inserted already approved');
select is((select admin_decision from public.daymark_requests where intern_id = (select a from ids)), null,
  'decision fields start empty');
select is((select dates from public.daymark_requests where intern_id = (select a from ids)), '{2026-10-08}'::date[],
  'dates are filled from the payload');
select is((select created_at from public.daymark_requests where intern_id = (select a from ids)),
  '2026-10-05 10:00+09:30'::timestamptz, 'created_at is the business clock');
insert into public.daymark_requests (placement_id, intern_id, type, payload, reason)
values (private.current_placement((select s4 from ids)), (select s4 from ids), 'extra_day',
        '{"date":"2026-10-08","start":"09:00","end":"17:00"}', 'Reason');
select ok((select needs_extra_spot from public.daymark_requests where intern_id = (select s4 from ids)),
  'needs_extra_spot is stored');

-- C7 no other pending request on the same date
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-10-08","start":"10:00","end":"12:00"}'),
  'You already have a request waiting for Thu 8 Oct. Cancel it or wait for a decision first.', 'C7 one pending request per date');
update public.daymark_requests set status = 'declined' where intern_id = (select a from ids);
select is(tests.verdict((select a from ids), 'extra_day', '{"date":"2026-10-08","start":"10:00","end":"12:00"}'),
  'ok', 'C7 ignores decided requests');

-- validate_request is internal
select ok(not has_function_privilege('authenticated', 'private.validate_request(public.daymark_requests)', 'execute'),
  'clients cannot call validate_request directly');

select * from finish();
rollback;

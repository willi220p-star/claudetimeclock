-- §9.2 punch fixes and review rule 14 (reason ≥ 20, 2 per rolling fortnight with an audited
-- admin override, window, no overlap, out > in). D3: an auto-closed shift counts 0 until fixed.
begin;
select plan(29);

create temp table ids as
select tests.create_person('pf.admin@test.dev', false, false, true) as admin,
       tests.supervisor() as sup,
       tests.create_intern('pf@test.dev') as pf,
       tests.create_intern('pf2@test.dev') as pf2,
       tests.create_intern('pf3@test.dev') as pf3;
grant select on ids to authenticated;
create temp table req (k text primary key, id uuid);
grant all on req to authenticated;
create temp table pun (k text primary key, id uuid);
grant all on pun to authenticated;

-- Mon 12 Oct: a device clock-in at 9:00 that was auto-closed at its own time (D3).
select tests.consent_all(pf) from ids;
select tests.clock((select pf from ids), 'shift_in', '2026-10-12 09:00+09:30');
insert into pun select 'in12', id from public.daymark_punches where user_id = (select pf from ids);
insert into pun values ('auto12', tests.punch((select pf from ids), 'shift_out', '2026-10-12 09:00+09:30', 'auto_close'));
-- Fri 9 Oct: a closed shift 9:00–12:00.
insert into pun values ('in9', tests.punch((select pf from ids), 'shift_in', '2026-10-09 09:00+09:30', 'punch_fix')),
                       ('out9', tests.punch((select pf from ids), 'shift_out', '2026-10-09 12:00+09:30', 'punch_fix'));
select tests.at('2026-10-13 10:00+09:30');   -- Tue 13 Oct

-- Window of 7 days, today or earlier, times in the site window and in the past
select is(tests.verdict((select pf from ids), 'punch_fix', '{"date":"2026-10-05","clock_in":"09:00","clock_out":"17:00"}',
  'I forgot to clock in and out that day.'),
  'Punch fixes can go back 7 days. Mon 5 Oct is too long ago — talk to your supervisor.', '8 days ago is too long ago');
select is(tests.verdict((select pf from ids), 'punch_fix', '{"date":"2026-10-06","clock_in":"09:00","clock_out":"17:00"}',
  'I forgot to clock in and out that day.'), 'ok', '7 days ago is fine');
select is(tests.verdict((select pf from ids), 'punch_fix', '{"date":"2026-10-14","clock_in":"09:00","clock_out":"17:00"}',
  'I forgot to clock in and out that day.'), 'Punch fixes are for today or earlier.', 'no fixes for future days');
select is(tests.verdict((select pf from ids), 'punch_fix', '{"date":"2026-10-13","clock_in":"09:00","clock_out":"11:00"}',
  'I forgot to clock in and out that day.'), 'Punch-fix times must be in the past.', 'no fixed times in the future');
select is(tests.verdict((select pf from ids), 'punch_fix', '{"date":"2026-10-06","clock_in":"06:30","clock_out":"17:00"}',
  'I forgot to clock in and out that day.'), 'Punch-fix times must be between 7:00 am and 7:00 pm.', 'times inside the window');

-- out > in, no overlap with another shift that day
select is(tests.verdict((select pf from ids), 'punch_fix', '{"date":"2026-10-09","clock_in":"13:00","clock_out":"12:30"}',
  'I forgot to clock in and out that day.'), 'The clock-out has to be after the clock-in.', 'out must be after in');
select is(tests.verdict((select pf from ids), 'punch_fix', '{"date":"2026-10-09","clock_in":"11:00","clock_out":"14:00"}',
  'I forgot to clock in and out that day.'),
  'Those times overlap another shift on Fri 9 Oct. Pick times that don''t clash with your other clock-ins and clock-outs.',
  'overlapping another shift is rejected');
select is(tests.verdict((select pf from ids), 'punch_fix', '{"date":"2026-10-09","clock_in":"12:00","clock_out":"14:00"}',
  'I forgot to clock in and out that day.'),
  'Those times overlap another shift on Fri 9 Oct. Pick times that don''t clash with your other clock-ins and clock-outs.',
  'touching another shift counts as overlapping');
select is(tests.verdict((select pf from ids), 'punch_fix', '{"date":"2026-10-09","clock_in":"13:00","clock_out":"17:00"}',
  'I forgot to clock in and out that day.'), 'ok', 'a separate second shift is fine');
select is(tests.verdict((select pf from ids), 'punch_fix',
  jsonb_build_object('date', '2026-10-09', 'clock_in', '08:30', 'replaces_in_punch_id', (select id from pun where k = 'in9')),
  'I clocked in late by mistake on the app.'), 'ok', 'correcting only a clock-in keeps its clock-out');
select is(tests.verdict((select pf from ids), 'punch_fix',
  jsonb_build_object('date', '2026-10-09', 'clock_in', '08:30', 'clock_out', '12:30', 'replaces_in_punch_id', (select id from pun where k = 'in9')),
  'I clocked in late by mistake on the app.'), 'Also pick the clock-out you''re correcting.',
  'a shift''s existing clock-out must be replaced, not doubled');
select is(tests.verdict((select pf from ids), 'punch_fix',
  jsonb_build_object('date', '2026-10-12', 'clock_out', '17:00', 'replaces_out_punch_id', (select id from pun where k = 'out9')),
  'I forgot to clock out that afternoon.'), 'That clock-out isn''t one of your punches on Mon 12 Oct.', 'replaced punches must be from that day');
select is(tests.verdict((select pf from ids), 'punch_fix', '{"date":"2026-10-12","clock_out":"17:00"}',
  'I forgot to clock out that afternoon.'),
  'There''s no open clock-in on Mon 12 Oct to close. Add the clock-in time too.', 'a lone clock-out must close an open shift');

-- Reason at least 20 characters (review rule 14)
select is(tests.verdict((select pf from ids), 'punch_fix', '{"date":"2026-10-06","clock_in":"09:00","clock_out":"17:00"}',
  'Forgot to clock in.'), 'Explain what happened in at least 20 characters.', 'a 19-character reason is too short');
select is(tests.verdict((select pf from ids), 'punch_fix', '{"date":"2026-10-06","clock_in":"09:00","clock_out":"17:00"}',
  'Forgot to clock in!!'), 'ok', 'a 20-character reason is enough');

-- Approval: corrective punches, originals kept (D3 auto-close fixed)
insert into req values ('fix12', tests.ask((select pf from ids), 'punch_fix',
  jsonb_build_object('date', '2026-10-12', 'clock_out', '17:00', 'replaces_out_punch_id', (select id from pun where k = 'auto12')),
  'I forgot to clock out that afternoon.'));
select is(tests.verdict((select pf from ids), 'punch_fix', '{"date":"2026-10-12","clock_in":"13:00","clock_out":"14:00"}',
  'I forgot to clock in and out that day.'),
  'You already have a request waiting for Mon 12 Oct. Cancel it or wait for a decision first.', 'one pending fix per date');
select is(tests.decide((select sup from ids), (select id from req where k = 'fix12'), 'approve'), 'approved', 'the fix is approved');
select is((select source || ' ' || verification_method || ' ' || event_type || ' ' || (occurred_at = '2026-10-12 17:00+09:30')::text
           || ' ' || (replaces_punch_id = (select id from pun where k = 'auto12'))::text || ' ' || (placement_id = private.current_placement((select pf from ids)))::text
           from public.daymark_punches where user_id = (select pf from ids) and source = 'punch_fix' and occurred_at::date >= '2026-10-12'),
  'punch_fix punch_fix shift_out true true true', 'a corrective clock-out replaces the auto-close');
select is((select count(*)::int from public.daymark_punches where user_id = (select pf from ids)
           and (occurred_at at time zone 'Australia/Darwin')::date = '2026-10-12'), 3, 'the originals are kept');
select is((select array_agg(to_char(in_at at time zone 'Australia/Darwin', 'HH24:MI') || '-' || to_char(out_at at time zone 'Australia/Darwin', 'HH24:MI'))
           from private.punch_fix_shifts((select pf from ids), '2026-10-12')), '{09:00-17:00}'::text[],
  'the day now pairs as one 9:00–5:00 shift');
select ok(exists (select 1 from public.daymark_audit_log where action = 'punch_fix' and row_id = (select id from req where k = 'fix12')::text),
  'the punch fix is audited');

-- At most 2 per rolling 14 days; a 3rd needs the admin, whose approval is an audited override
insert into req values ('p1', tests.ask((select pf2 from ids), 'punch_fix', '{"date":"2026-10-06","clock_in":"09:00","clock_out":"17:00"}',
  'I forgot to clock in and out that day.'));
select tests.at('2026-10-13 10:01+09:30');
insert into req values ('p2', tests.ask((select pf2 from ids), 'punch_fix', '{"date":"2026-10-07","clock_in":"09:00","clock_out":"17:00"}',
  'I forgot to clock in and out that day.'));
select tests.at('2026-10-13 10:02+09:30');
insert into req values ('p3', tests.ask((select pf2 from ids), 'punch_fix', '{"date":"2026-10-08","clock_in":"09:00","clock_out":"17:00"}',
  'I forgot to clock in and out that day.'));
select is(tests.decide((select sup from ids), (select id from req where k = 'p2'), 'approve'), 'approved', 'the 2nd fix is within the limit');
select is(tests.decide((select sup from ids), (select id from req where k = 'p3'), 'approve'), 'pending_admin',
  'the 3rd fix in 14 days needs the admin');
select is((select system_note from public.daymark_requests where id = (select id from req where k = 'p3')),
  'This is more than 2 punch fixes in 14 days, so the DGK admin decides.', 'the system note says why');
select is(tests.decide((select admin from ids), (select id from req where k = 'p3'), 'approve'), 'approved',
  'the admin can override the limit');
select ok(exists (select 1 from public.daymark_audit_log where action = 'override_punch_fix_limit'
                  and row_id = (select id from req where k = 'p3')::text), 'the override is audited');
select tests.at('2026-10-20 10:00+09:30');
select ok(private.punch_fix_over_limit(tests.draft((select pf2 from ids), 'punch_fix', '{"date":"2026-10-19","clock_in":"09:00","clock_out":"17:00"}')),
  'a week later the fortnight still holds 3');
select tests.at('2026-10-27 10:03+09:30');
select ok(not private.punch_fix_over_limit(tests.draft((select pf2 from ids), 'punch_fix', '{"date":"2026-10-26","clock_in":"09:00","clock_out":"17:00"}')),
  'the fortnight rolls on');

-- Declined fixes don't use up the limit
select tests.at('2026-10-13 10:00+09:30');
insert into req values ('d1', tests.ask((select pf3 from ids), 'punch_fix', '{"date":"2026-10-06","clock_in":"09:00","clock_out":"17:00"}',
  'I forgot to clock in and out that day.'));
insert into req values ('d2', tests.ask((select pf3 from ids), 'punch_fix', '{"date":"2026-10-07","clock_in":"09:00","clock_out":"17:00"}',
  'I forgot to clock in and out that day.'));
select tests.decide((select sup from ids), id, 'decline', 'You were at the uni that day.') from req where k in ('d1', 'd2');
select ok(not private.punch_fix_over_limit(tests.draft((select pf3 from ids), 'punch_fix', '{"date":"2026-10-08","clock_in":"09:00","clock_out":"17:00"}')),
  'declined fixes don''t count');

select * from finish();
rollback;

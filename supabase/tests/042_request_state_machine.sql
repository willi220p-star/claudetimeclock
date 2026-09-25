-- §9.3 state machine: create, cancel, decide; who may decide (§6, review rule 13); extra spots
-- through the admin; capacity re-checked at every step (R5.3.6); nothing automatic (R5.12.2).
begin;
select plan(46);

insert into public.daymark_sites (id, name, address, latitude, longitude)
values ('00000000-0000-0000-0000-0000000e0042', 'State machine site', 'Test', -12.4785082, 130.9854825);
create temp table ids as
select tests.create_person('sm.admin@test.dev', false, false, true) as admin,
       tests.supervisor() as sup,
       tests.create_person('sm.sup2@test.dev', false, true, false) as sup2,
       tests.create_intern('sma@test.dev', '00000000-0000-0000-0000-0000000e0042', '{3}') as a,
       tests.create_intern('smb@test.dev') as b,
       tests.create_intern('smdual@test.dev', null, '{2}') as dual,
       tests.create_intern('smx@test.dev', null, '{2}') as x,
       tests.create_intern('smai@test.dev', null, '{2}') as admin_intern,
       tests.create_intern('smt1@test.dev', '00000000-0000-0000-0000-0000000e0042', '{4}') as t1,
       tests.create_intern('smt2@test.dev', '00000000-0000-0000-0000-0000000e0042', '{4}') as t2,   -- 2 on Thursdays
       tests.create_intern('smt3@test.dev', '00000000-0000-0000-0000-0000000e0042', '{1}') as t3,
       tests.create_intern('smt4@test.dev', '00000000-0000-0000-0000-0000000e0042', '{2}') as t4,
       tests.create_intern('smt5@test.dev', '00000000-0000-0000-0000-0000000e0042', '{5}') as t5,
       tests.create_intern('smt6@test.dev', '00000000-0000-0000-0000-0000000e0042', '{1}') as t6;
grant select on ids to authenticated;
create temp table req (k text primary key, id uuid);
grant all on req to authenticated;
update public.daymark_placements set supervisor_id = (select sup2 from ids) where intern_id = (select b from ids);
update public.daymark_profiles set is_supervisor = true where id = (select dual from ids);
update public.daymark_placements set supervisor_id = (select dual from ids) where intern_id = (select x from ids);
update public.daymark_profiles set is_admin = true where id = (select admin_intern from ids);
select tests.at('2026-10-05 10:00+09:30');   -- Mon 5 Oct

-- Creating (§6: interns only, own live placement)
select tests.as_person((select sup from ids));
select throws_ok($$select public.create_request('extra_day', '{"date":"2026-10-08","start":"09:00","end":"17:00"}', 'Reason')$$,
  '42501', 'Only interns make requests.', 'supervisors cannot create requests');
reset role;
select tests.as_person((select a from ids));
select throws_ok($$select public.create_request('overtime', '{"date":"2026-10-05"}', 'Reason')$$,
  '22023', 'Overtime requests are made for you when a day closes. You can add a reason to one.', 'interns cannot create overtime');
select throws_ok($$select public.create_request('extra_day', '{"date":"2026-10-10","start":"09:00","end":"17:00"}', 'Reason')$$,
  'P0001', 'Sat 10 Oct is on a weekend. Pick a weekday.', 'creation validates');
reset role;
insert into req values ('a1', tests.ask((select a from ids), 'extra_day', '{"date":"2026-10-08","start":"09:00","end":"17:00"}'));
select is(tests.status((select id from req where k = 'a1')), 'pending_supervisor', 'a new request waits for the supervisor');
select ok(exists (select 1 from public.daymark_notifications where person_id = (select sup from ids) and kind = 'request'),
  'the supervisor is notified');
select ok(exists (select 1 from public.daymark_audit_log where action = 'create_request' and row_id = (select id from req where k = 'a1')::text),
  'creation is audited');

-- No direct writes (§14)
select tests.as_person((select a from ids));
select throws_ok($$update public.daymark_requests set status = 'approved'$$, '42501', null, 'interns cannot update requests');
select throws_ok($$insert into public.daymark_requests (placement_id, intern_id, type) values (null, null, 'swap')$$,
  '42501', null, 'interns cannot insert requests directly');
reset role;
select tests.as_person((select sup from ids));
select throws_ok($$update public.daymark_requests set supervisor_decision = 'approved'$$, '42501', null,
  'supervisors cannot update requests');
reset role;

-- Who decides
select tests.as_person((select sup2 from ids));
select throws_ok(format($$select public.decide_request(%L, 'approve')$$, (select id from req where k = 'a1')),
  '22023', 'That request doesn''t exist.', 'another supervisor cannot see or decide it');
reset role;
select tests.as_person((select a from ids));
select throws_ok(format($$select public.decide_request(%L, 'approve')$$, (select id from req where k = 'a1')),
  '42501', 'You can''t decide your own request. Another supervisor or the DGK admin will.', 'nobody decides their own request');
reset role;
select tests.as_person((select sup from ids));
select throws_ok(format($$select public.decide_request(%L, 'maybe')$$, (select id from req where k = 'a1')),
  '22023', 'Choose approve or decline.', 'decisions are approve or decline');
select throws_ok(format($$select public.decide_request(%L, 'decline', '  ')$$, (select id from req where k = 'a1')),
  '22023', 'Add a note so the intern knows why.', 'a decline needs a note');
select throws_ok(format($$select public.decide_request(%L, 'approve', null, 30)$$, (select id from req where k = 'a1')),
  '22023', 'Approved minutes are only for approving overtime.', 'minutes only for overtime');
reset role;

-- Decline
select is(tests.decide((select sup from ids), (select id from req where k = 'a1'), 'decline', 'We need you on Wednesday instead.'),
  'declined', 'the supervisor declines with a note');
select is((select supervisor_decision || '|' || supervisor_note || '|' || (supervisor_id = (select sup from ids))::text
           from public.daymark_requests where id = (select id from req where k = 'a1')),
  'declined|We need you on Wednesday instead.|true', 'who, what and the note are recorded');
select ok(exists (select 1 from public.daymark_notifications where person_id = (select a from ids) and title like '%declined%'),
  'the intern hears about the decline');
select ok(exists (select 1 from public.daymark_audit_log where action = 'decline_request'), 'the decline is audited');
select throws_ok(format($$select tests.decide(%L, %L, 'approve')$$, (select sup from ids), (select id from req where k = 'a1')),
  'P0001', 'This request has already been decided or cancelled.', 'decided requests stay decided');

-- Cancel (intern, pending only)
insert into req values ('a2', tests.ask((select a from ids), 'extra_day', '{"date":"2026-10-08","start":"09:00","end":"17:00"}'));
select tests.as_person((select b from ids));
select throws_ok(format($$select public.cancel_request(%L)$$, (select id from req where k = 'a2')),
  '42501', 'You can only cancel your own requests.', 'interns cancel only their own');
reset role;
select tests.as_person((select a from ids));
select is(public.cancel_request((select id from req where k = 'a2')) ->> 'status', 'cancelled', 'the intern cancels a pending request');
select throws_ok(format($$select public.cancel_request(%L)$$, (select id from req where k = 'a2')),
  'P0001', 'Only pending requests can be cancelled.', 'only pending requests can be cancelled');
reset role;
select ok(exists (select 1 from public.daymark_notifications where person_id = (select sup from ids) and title like '%cancelled%'),
  'the supervisor hears about the cancel');

-- Approve: the supervisor's approval is final when no extra spot is needed
insert into req values ('a3', tests.ask((select a from ids), 'extra_day', '{"date":"2026-10-08","start":"09:00","end":"17:00"}'));
select is(tests.decide((select sup from ids), (select id from req where k = 'a3'), 'approve'), 'approved', 'the supervisor approves');
select is((select source || '|' || (origin_request_id = (select id from req where k = 'a3'))::text
           from public.daymark_scheduled_days where id = tests.day((select a from ids), '2026-10-08')),
  'extra_day|true', 'the effect is applied in the same transaction');
select ok(exists (select 1 from public.daymark_notifications where person_id = (select a from ids) and title like '%approved%'),
  'the intern hears about the approval');
select ok(exists (select 1 from public.daymark_audit_log where action = 'approve_request' and row_id = (select id from req where k = 'a3')::text),
  'the approval is audited');

-- The admin may decide any pending step, including escalated ones
insert into req values ('b1', tests.ask((select b from ids), 'shift_change',
  jsonb_build_object('scheduled_day_id', tests.day((select b from ids), '2026-10-14'), 'start', '10:00', 'end', '16:00')));
update public.daymark_requests set escalated_at = '2026-10-05 10:00+09:30' where id = (select id from req where k = 'b1');
select is(tests.decide((select admin from ids), (select id from req where k = 'b1'), 'approve', 'Approved while Sam is away.'),
  'approved', 'the admin decides an escalated request');
select is((select admin_decision || '|' || coalesce(supervisor_decision, 'none') from public.daymark_requests
           where id = (select id from req where k = 'b1')), 'approved|none', 'the admin decision is recorded as the admin''s');
select ok(exists (select 1 from public.daymark_notifications where person_id = (select sup2 from ids) and title like '%approved%'),
  'the supervisor hears when the admin decides');

-- Segregation of duties for dual-role people (review rule 13)
insert into req values ('x1', tests.ask((select x from ids), 'shift_change',
  jsonb_build_object('scheduled_day_id', tests.day((select x from ids), '2026-10-13'), 'start', '10:00', 'end', '16:00')));
select is(tests.decide((select dual from ids), (select id from req where k = 'x1'), 'approve'), 'approved',
  'a supervisor-intern decides their own intern''s request');
insert into req values ('d1', tests.ask((select dual from ids), 'shift_change',
  jsonb_build_object('scheduled_day_id', tests.day((select dual from ids), '2026-10-13'), 'start', '10:00', 'end', '16:00')));
select throws_ok(format($$select tests.decide(%L, %L, 'approve')$$, (select dual from ids), (select id from req where k = 'd1')),
  '42501', 'You can''t decide your own request. Another supervisor or the DGK admin will.', 'a supervisor-intern cannot decide their own');
select is(tests.decide((select sup from ids), (select id from req where k = 'd1'), 'approve'), 'approved',
  'their own supervisor decides it');
insert into req values ('ai1', tests.ask((select admin_intern from ids), 'shift_change',
  jsonb_build_object('scheduled_day_id', tests.day((select admin_intern from ids), '2026-10-13'), 'start', '10:00', 'end', '16:00')));
select throws_ok(format($$select tests.decide(%L, %L, 'approve')$$, (select admin_intern from ids), (select id from req where k = 'ai1')),
  '42501', 'You can''t decide your own request. Another supervisor or the DGK admin will.', 'not even an admin decides their own');

-- Extra spot (R5.3.4): supervisor, then admin
select private.add_scheduled_day(private.current_placement((select t4 from ids)), '2026-10-22', '09:00', '17:00', 'admin', null, false);
insert into req values ('t6', tests.ask((select t6 from ids), 'extra_day', '{"date":"2026-10-22","start":"09:00","end":"17:00"}'));
select ok((select needs_extra_spot from public.daymark_requests where id = (select id from req where k = 't6')), 'a 4th is flagged');
select is(tests.decide((select sup from ids), (select id from req where k = 't6'), 'approve'), 'pending_admin',
  'the supervisor''s approval sends an extra spot to the admin');
select is((select system_note from public.daymark_requests where id = (select id from req where k = 't6')),
  'Thu 22 Oct is full, so this needs an extra spot. The DGK admin decides.', 'with a system note');
select ok(exists (select 1 from public.daymark_notifications where person_id = (select admin from ids) and link = '/admin/requests'),
  'the admin is notified');
select throws_ok(format($$select tests.decide(%L, %L, 'approve')$$, (select sup from ids), (select id from req where k = 't6')),
  '42501', 'This request is with the DGK admin now.', 'the supervisor cannot decide the admin step');
select is(tests.decide((select admin from ids), (select id from req where k = 't6'), 'approve'), 'approved',
  'the admin approves the extra spot');
select is((select count(*)::int from public.daymark_scheduled_days
           where site_id = '00000000-0000-0000-0000-0000000e0042' and work_date = '2026-10-22' and status = 'scheduled'), 4,
  'four interns on the day');

-- Capacity changing between steps (R5.3.6)
insert into req values ('t3', tests.ask((select t3 from ids), 'extra_day', '{"date":"2026-10-15","start":"09:00","end":"17:00"}'));
select ok(not (select needs_extra_spot from public.daymark_requests where id = (select id from req where k = 't3')),
  'asked at 2 of 3: no extra spot');
select private.add_scheduled_day(private.current_placement((select t4 from ids)), '2026-10-15', '09:00', '17:00', 'admin', null, false);
select is(tests.decide((select sup from ids), (select id from req where k = 't3'), 'approve'), 'pending_admin',
  'capacity changed before the supervisor step: it goes to the admin');
select is((select system_note from public.daymark_requests where id = (select id from req where k = 't3')),
  'Capacity changed since this was asked: Thu 15 Oct is now full, so it needs an extra spot. The DGK admin decides.',
  'the system note says why');
select private.add_scheduled_day(private.current_placement((select t5 from ids)), '2026-10-15', '09:00', '17:00', 'admin', null, true);
select throws_like(format($$select tests.decide(%L, %L, 'approve')$$, (select admin from ids), (select id from req where k = 't3')),
  '%Thu 15 Oct already has 4 interns — the office limit.%', 'a 5th after the supervisor step cannot be approved');
select is(tests.decide((select admin from ids), (select id from req where k = 't3'), 'decline', 'The office is full that day.'),
  'declined', 'the admin declines it instead (never automatically)');

select * from finish();
rollback;

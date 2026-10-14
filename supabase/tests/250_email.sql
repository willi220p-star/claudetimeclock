begin;
select plan(75);

-- Email notifications (Dilip, 14 Oct; D50). Tue 14 Oct, 9 am Darwin.
create temp table ids as
select tests.create_person('Em.A@Test.dev') as a,
       tests.create_person('em.b@test.dev') as b,
       tests.create_person('em.kiosk@test.dev') as k,
       tests.create_person('em.gone@test.dev') as gone,
       tests.create_person('em.sup@test.dev', false, true, false) as sup,
       tests.create_person('em.admin@test.dev', false, false, true) as admin;
grant select on ids to authenticated, service_role;
select tests.without_seed();
update public.daymark_profiles set is_kiosk = true, is_intern = false where id = (select k from ids);
update public.daymark_profiles set active = false where id = (select gone from ids);
create temp table ob (name text, id uuid);
grant all on ob to authenticated, service_role;
select tests.at('2026-10-14 09:00+09:30');

-- The outbox is closed to the app; the sender's functions are the service role's only.
select ok((select c.relrowsecurity and not has_table_privilege('authenticated', c.oid, 'select')
                  and not has_table_privilege('authenticated', c.oid, 'insert')
                  and not has_table_privilege('anon', c.oid, 'select')
           from pg_class c where c.oid = 'public.daymark_email_outbox'::regclass),
  'the outbox has RLS on and no grants to the app');
select ok(not has_function_privilege('authenticated', 'public.email_claim(integer)', 'execute')
          and not has_function_privilege('authenticated', 'private.email_claim(integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.email_mark(uuid, text, text, text)', 'execute')
          and not has_function_privilege('authenticated', 'private.email_mark(uuid, text, text, text)', 'execute')
          and not has_function_privilege('authenticated', 'private.call_send_email()', 'execute')
          and not has_function_privilege('authenticated', 'private.queue_email()', 'execute')
          and not has_function_privilege('anon', 'public.email_claim(integer)', 'execute'),
  'claim, mark, the cron call and the trigger are not the app''s');
select ok(has_function_privilege('service_role', 'public.email_claim(integer)', 'execute')
          and has_function_privilege('service_role', 'public.email_mark(uuid, text, text, text)', 'execute'),
  'the Edge Function (service role) can claim and mark');
select ok(not has_function_privilege('anon', 'public.email_settings()', 'execute')
          and not has_function_privilege('anon', 'public.set_my_email(boolean)', 'execute'),
  'nothing for signed-out visitors');
select tests.as_person((select a from ids));
select throws_ok($$select * from public.email_claim(5)$$, '42501', null, 'an intern can''t claim emails');
select throws_ok($$select public.email_mark(gen_random_uuid(), 'sent', null, null)$$, '42501', null, 'nor mark them');
reset role;

-- Defaults: off, the six kinds, 80 a day.
select results_eq($$select s.email_enabled, s.email_kinds, e.test_recipients, s.email_daily_cap from public.daymark_settings s cross join public.daymark_email_private e$$,
  $$values (false, array['request','attendance','work_based','announcement','schedule','task']::text[], '{}'::text[], 80)$$,
  'email starts off with the six default kinds and a cap of 80');
select private.notify((select a from ids), 'request', 'Off', 'b', '/clock');
select is((select count(*)::int from public.daymark_email_outbox), 0, 'nothing is queued while email is off');

-- On: the trigger queues allowed kinds for active, non-kiosk people who haven't opted out.
update public.daymark_settings set email_enabled = true;
select private.notify((select a from ids), 'request', 'Your leave', 'Approved', '/clock/requests');
select private.notify((select admin from ids), 'request', 'To approve', 'b', '/admin/requests');
select private.notify((select sup from ids), 'attendance', 'Attendance', 'b', null);
select private.notify((select a from ids), 'work_based', 'Work based', 'b', null);
select private.notify((select a from ids), 'announcement', 'News', 'b', null);
select private.notify((select a from ids), 'schedule', 'Roster', 'b', null);
select private.notify((select a from ids), 'task', 'Task', 'b', null);
select results_eq(
  $$select p.display_name, o.kind, o.recipient_category, o.template_id, o.status from public.daymark_email_outbox o
    join public.daymark_profiles p on p.id = o.person_id order by o.title$$,
  $$values ('em.sup', 'attendance', 'admin', 'approval_needed', 'pending'),
           ('Em.A', 'announcement', 'user', 'announcement', 'pending'),
           ('Em.A', 'schedule', 'user', 'roster_change', 'pending'),
           ('Em.A', 'task', 'user', 'task_update', 'pending'),
           ('em.admin', 'request', 'admin', 'approval_needed', 'pending'),
           ('Em.A', 'work_based', 'user', 'approval_needed', 'pending'),
           ('Em.A', 'request', 'user', 'request_update', 'pending')$$,
  'each allowed kind is queued with its category and template');
select is((select o.notification_id from public.daymark_email_outbox o where o.title = 'Your leave'),
  (select n.id from public.daymark_notifications n where n.title = 'Your leave'), 'the row points at its notification');
select results_eq($$select body, link, next_attempt_at, attempts from public.daymark_email_outbox where title = 'Your leave'$$,
  $$values ('Approved', '/clock/requests', '2026-10-14 09:00+09:30'::timestamptz, 0)$$, 'a snapshot of the notification, due now');
select private.notify((select a from ids), 'reminder_shift', 'Shift soon', 'b', '/clock');
select private.notify((select a from ids), 'digest', 'Digest', 'b', null);
select is((select count(*)::int from public.daymark_email_outbox where title in ('Shift soon', 'Digest')), 0,
  'kinds that aren''t ticked aren''t emailed');
update public.daymark_settings set email_kinds = email_kinds || array['digest'];
select private.notify((select a from ids), 'digest', 'Digest 2', repeat('x', 1500), null);
select results_eq($$select template_id, char_length(body) from public.daymark_email_outbox where title = 'Digest 2'$$,
  $$values ('general_notice', 1000)$$, 'other ticked kinds use general_notice; the body is cut to 1,000 characters');
select private.notify((select k from ids), 'request', 'Kiosk', 'b', null);
select private.notify((select gone from ids), 'request', 'Gone', 'b', null);
select is((select count(*)::int from public.daymark_email_outbox where title in ('Kiosk', 'Gone')), 0,
  'kiosks and inactive people get no email');

-- "Email me notifications" switch.
select tests.as_person((select b from ids));
select is(public.my_email_setting(), true, 'email is on for a person by default');
select lives_ok($$select public.set_my_email(false)$$, 'a person turns email off');
select is(public.my_email_setting(), false, 'and it reads back off');
select throws_ok($$select public.set_my_email(null)$$, '22023', null, 'on or off, not null');
reset role;
select is((select email_opt_out from public.daymark_profiles where id = (select b from ids)), true, 'stored as an opt-out');
select private.notify((select b from ids), 'request', 'Opted out', 'b', null);
select is((select count(*)::int from public.daymark_email_outbox where title = 'Opted out'), 0, 'an opted-out person gets no email');
select tests.as_person((select b from ids));
select public.set_my_email(true);
reset role;
select private.notify((select b from ids), 'request', 'Opted in', 'b', null);
select is((select count(*)::int from public.daymark_email_outbox where title = 'Opted in'), 1, 'back on, emails queue again');
select tests.as_anon();
select throws_ok($$select public.set_my_email(true)$$, '42501', null, 'a visitor has no switch');
reset role;

-- A repeated event never makes a second row.
create trigger tmp_email_twice after insert on public.daymark_notifications
  for each row execute function private.queue_email();
select private.notify((select a from ids), 'task', 'Twice', 'b', null);
select is((select count(*)::int from public.daymark_email_outbox where title = 'Twice'), 1,
  'the trigger running twice queues one row');
select throws_ok($$insert into public.daymark_email_outbox (notification_id, person_id, kind, template_id, recipient_category, title)
                   select notification_id, person_id, kind, template_id, recipient_category, title
                   from public.daymark_email_outbox where title = 'Twice'$$,
  '23505', null, 'notification_id is unique');

-- Claiming (service role): due rows go to processing with an attempt counted.
select is(private.email_sent_today(), 0, 'nothing sent yet today');
set local role service_role;
create temp table claimed as select * from public.email_claim(3);
reset role;
select is((select count(*)::int from claimed), 3, 'claims at most max_rows');
select is((select count(*)::int from public.daymark_email_outbox where status = 'processing'
           and processing_at = '2026-10-14 09:00+09:30' and attempts = 1), 3, 'claimed rows are processing, attempt 1');
set local role service_role;
insert into claimed select * from public.email_claim(20);
reset role;
select is((select count(*)::int from claimed), 10, 'the rest are claimed in the next call');
set local role service_role;
select is((select count(*)::int from public.email_claim(20)), 0, 'nothing is claimed twice');
reset role;
select results_eq($$select recipient_email, recipient_name, test_only, allowed, template_id, correlation_id is not null
                    from claimed where title = 'Your leave'$$,
  $$values ('em.a@test.dev', 'Em.A', false, true, 'request_update', true)$$,
  'the claim returns the lower-cased login email and the display name');
select ok(pg_get_functiondef('private.email_claim(integer)'::regprocedure) ~* 'for update of x skip locked',
  'claims skip rows another run has locked');

-- Marking: only processing rows change, so sent is never overwritten.
insert into ob select title, id from claimed;
set local role service_role;
select public.email_mark((select id from ob where name = 'Your leave'), 'sent', null, null);
select public.email_mark((select id from ob where name = 'Your leave'), 'failed', 'late', 'too late');
reset role;
select results_eq($$select status, completed_at, error_code from public.daymark_email_outbox where title = 'Your leave'$$,
  $$values ('sent', '2026-10-14 09:00+09:30'::timestamptz, null::text)$$, 'sent sets completed_at and stays sent');
set local role service_role;
select throws_ok($$select public.email_mark((select id from ob where name = 'News'), 'done', null, null)$$, '22023', null,
  'only known outcomes');
select public.email_mark((select id from ob where name = 'News'), 'retry_pending', 'send_failed',
  'Mail to jo.smith@example.com failed: ' || repeat('y', 400));
select public.email_mark((select id from ob where name = 'Roster'), 'skipped', 'not_test_recipient', null);
select public.email_mark((select id from ob where name = 'Task'), 'uncertain', 'timeout_uncertain', null);
select public.email_mark((select id from ob where name = 'Twice'), 'failed', 'bad_signature', 'Signature mismatch');
reset role;
select ok((select status = 'retry_pending' and completed_at is null
                  and next_attempt_at between '2026-10-14 09:02+09:30' and '2026-10-14 09:02:30+09:30'
           from public.daymark_email_outbox where title = 'News'),
  'retry_pending waits 2^attempts minutes plus up to 30 s');
select ok((select char_length(error_message) = 300 and error_message !~ '@' and error_message ~ '^Mail to \[address\] failed'
           from public.daymark_email_outbox where title = 'News'),
  'error messages lose addresses and are cut to 300 characters');
select results_eq($$select title, status, error_code, completed_at is not null from public.daymark_email_outbox
                    where title in ('Roster', 'Task', 'Twice') order by title$$,
  $$values ('Roster', 'skipped', 'not_test_recipient', true), ('Task', 'uncertain', 'timeout_uncertain', true),
           ('Twice', 'failed', 'bad_signature', true)$$, 'skipped, uncertain and failed close the row');

-- Backoff: the 5th failed attempt fails for good; later attempts wait longer, at most an hour.
update public.daymark_email_outbox set attempts = 4, next_attempt_at = '2026-10-14 08:00+09:30', status = 'retry_pending'
where title = 'News';
update public.daymark_email_outbox set attempts = 3, status = 'processing' where title = 'Roster';
set local role service_role;
select is((select attempts from public.email_claim(20) where title = 'News'), 5, 'a retried row is claimed again');
select public.email_mark((select id from ob where name = 'News'), 'retry_pending', 'busy', null);
select public.email_mark((select id from ob where name = 'Roster'), 'retry_pending', 'busy', null);
reset role;
select results_eq($$select status, error_code, completed_at from public.daymark_email_outbox where title = 'News'$$,
  $$values ('failed', 'max_attempts', '2026-10-14 09:00+09:30'::timestamptz)$$, 'after 5 attempts it fails');
select ok((select next_attempt_at between '2026-10-14 09:08+09:30' and '2026-10-14 09:08:30+09:30'
           from public.daymark_email_outbox where title = 'Roster'), 'the 3rd attempt waits 8 minutes');
select is(private.email_clean_error(repeat('z', 500)), repeat('z', 300), 'messages are cut to 300 characters');

-- Stale processing becomes uncertain and is never retried on its own.
update public.daymark_email_outbox set status = 'processing', processing_at = '2026-10-14 08:49+09:30' where title = 'Roster';
update public.daymark_email_outbox set processing_at = '2026-10-14 08:51+09:30' where title = 'Attendance';
select private.call_send_email();
select results_eq($$select title, status, error_code from public.daymark_email_outbox
                    where title in ('Roster', 'Attendance') order by title$$,
  $$values ('Attendance', 'processing', null::text), ('Roster', 'uncertain', 'stale_processing')$$,
  'processing older than 10 minutes becomes uncertain');

-- The daily cap counts today's sent, processing and uncertain rows (Darwin day).
-- Now: sent 1 (Your leave), processing 5, uncertain 2 (Task, Roster) = 8.
select is(private.email_sent_today(), 8, 'today''s count');
insert into public.daymark_email_outbox (person_id, kind, template_id, recipient_category, title, status, processing_at, created_at)
select (select a from ids), 'task', 'task_update', 'user', 'Earlier ' || g, 'sent', '2026-10-14 00:30+09:30', '2026-10-14 00:30+09:30'
from generate_series(1, 71) g;
insert into public.daymark_email_outbox (person_id, kind, template_id, recipient_category, title, status, processing_at, created_at)
select (select a from ids), 'task', 'task_update', 'user', 'Yesterday ' || g, 'sent', '2026-10-13 23:59+09:30', '2026-10-13 23:59+09:30'
from generate_series(1, 5) g;
insert into public.daymark_email_outbox (person_id, kind, template_id, recipient_category, title, status, next_attempt_at, created_at)
select (select a from ids), 'task', 'task_update', 'user', 'Waiting ' || g, 'pending', '2026-10-14 08:00+09:30', '2026-10-14 08:00+09:30'
from generate_series(1, 4) g;
select is(private.email_sent_today(), 79, 'yesterday''s emails don''t count');
set local role service_role;
select is((select count(*)::int from public.email_claim(20)), 1, 'only one more fits under the cap of 80');
select is((select count(*)::int from public.email_claim(20)), 0, 'the rest wait');
reset role;
select is(private.call_send_email(), null, 'the cron call doesn''t wake the sender over the cap');
select tests.at('2026-10-15 00:01+09:30');
select is(private.email_sent_today(), 0, 'a new Darwin day (still 14 Oct in UTC) starts at zero');
set local role service_role;
select is((select count(*)::int from public.email_claim(20)), 3, 'the waiting rows go from 00:00 Darwin');
reset role;
select tests.at('2026-10-14 09:00+09:30');
update public.daymark_settings set email_enabled = false;
update public.daymark_email_outbox set status = 'pending', processing_at = null where title = 'Attendance';
set local role service_role;
select is((select count(*)::int from public.email_claim(20)), 0, 'nothing is claimed while email is off');
reset role;
update public.daymark_settings set email_enabled = true;

-- Test recipients: everyone else is not allowed.
update public.daymark_settings set email_daily_cap = 95;
update public.daymark_email_private set test_recipients = array['em.admin@test.dev'];
select private.notify((select a from ids), 'task', 'Test only A', 'b', null);
select private.notify((select admin from ids), 'request', 'Test only admin', 'b', null);
set local role service_role;
create temp table tested as select * from public.email_claim(20);
reset role;
select results_eq($$select title, test_only, allowed from tested where title like 'Test only%' order by title$$,
  $$values ('Test only A', true, false), ('Test only admin', true, true)$$, 'only listed addresses are allowed');

-- Admin settings.
select tests.as_person((select a from ids));
select throws_ok($$select public.email_settings()$$, '42501', null, 'interns can''t read email settings');
select throws_ok($$select public.save_email_settings(true, '{task}', '{}', 50)$$, '42501', null, 'nor change them');
select throws_ok($$select * from public.email_failures()$$, '42501', null, 'nor list failures');
select throws_ok($$select public.retry_email((select id from ob where name = 'News'))$$, '42501', null, 'nor retry');
reset role;
select tests.as_person((select sup from ids));
select throws_ok($$select public.retry_email((select id from ob where name = 'News'))$$, '42501', null, 'supervisors can''t retry');
reset role;
select tests.as_person((select admin from ids));
select throws_ok($$select public.save_email_settings(null, '{task}', '{}', 50)$$, '22023', null, 'on or off is needed');
select throws_ok($$select public.save_email_settings(true, '{reminder_shift}', '{}', 50)$$, '22023', null, 'only email kinds');
select throws_ok($$select public.save_email_settings(true, null, '{}', 50)$$, '22023', null, 'kinds can''t be null');
select throws_ok($$select public.save_email_settings(true, '{task}', '{nope}', 50)$$, '22023', null, 'test recipients need an @');
select throws_ok($$select public.save_email_settings(true, '{task}',
  array(select 'p' || g || '@test.dev' from generate_series(1, 21) g), 50)$$, '22023', null, 'at most 20 test recipients');
select throws_ok($$select public.save_email_settings(true, '{task}', '{}', 0)$$, '22023', null, 'cap at least 1');
select throws_ok($$select public.save_email_settings(true, '{task}', '{}', 96)$$, '22023', null, 'cap at most 95');
select lives_ok($$select public.save_email_settings(true, '{task,request,task}', array[' Me@Test.DEV ', '', 'me@test.dev'], 60)$$,
  'an admin saves email settings');
reset role;
select results_eq($$select s.email_enabled, s.email_kinds, e.test_recipients, s.email_daily_cap from public.daymark_settings s cross join public.daymark_email_private e$$,
  $$values (true, '{request,task}'::text[], '{me@test.dev}'::text[], 60)$$, 'kinds and addresses are cleaned');
select ok(exists (select 1 from public.daymark_audit_log where action = 'save_email_settings'
                  and actor_id = (select admin from ids) and after ->> 'email_daily_cap' = '60'), 'saving is audited');
select tests.as_person((select admin from ids));
select results_eq($$select (s ->> 'enabled')::boolean, (s ->> 'daily_cap')::int, s -> 'options' ? 'escalated',
                           s -> 'test_recipients', (s ->> 'failed_7d')::int, (s ->> 'uncertain_7d')::int
                    from public.email_settings() s$$,
  $$values (true, 60, true, '["me@test.dev"]'::jsonb, 2, 2)$$, 'the admin reads settings and counts');
select ok((select (s ->> 'sent_today')::int >= 79 and (s ->> 'queued')::int >= 0 from public.email_settings() s),
  'with today''s sent count and the queue');

-- Failures: failed and uncertain rows, with no addresses.
select results_eq($$select person_name, status, error_code from public.email_failures() order by error_code$$,
  $$values ('Em.A', 'failed', 'bad_signature'), ('Em.A', 'failed', 'max_attempts'),
           ('Em.A', 'uncertain', 'stale_processing'), ('Em.A', 'uncertain', 'timeout_uncertain')$$,
  'failed and uncertain emails are listed');
select ok((select bool_and(to_jsonb(f)::text !~ '@') from public.email_failures() f), 'with no email addresses');
select is((select count(*)::int from public.email_failures(1)), 1, 'max_rows limits the list');

-- Retry: only failed or uncertain rows, with fresh attempts.
select lives_ok($$select public.retry_email((select id from ob where name = 'News'))$$, 'an admin retries a failed email');
select throws_ok($$select public.retry_email((select id from ob where name = 'Your leave'))$$, 'P0002', null,
  'a sent email can''t be retried');
reset role;
select results_eq($$select status, attempts, next_attempt_at, completed_at from public.daymark_email_outbox where title = 'News'$$,
  $$values ('retry_pending', 0, '2026-10-14 09:00+09:30'::timestamptz, null::timestamptz)$$,
  'it goes back to retry_pending, due now, with attempts reset');
select ok(exists (select 1 from public.daymark_audit_log where action = 'retry_email' and row_id = (select id::text from ob where name = 'News')
                  and before ->> 'status' = 'failed'), 'retries are audited');

select ok(not has_table_privilege('authenticated', 'public.daymark_email_private', 'select')
          and not exists (select 1 from information_schema.columns
                          where table_name = 'daymark_settings' and column_name = 'email_test_recipients'),
  'test recipients sit in a closed table, not in the settings everyone can read');

select * from finish();
rollback;

begin;
select plan(52);

-- Built-in tasks (Dilip, 12 Oct; D44). Mon 12 Oct. A and B are tests.supervisor()'s interns, C is sup2's.
create temp table ids as
select tests.create_intern('tk.a@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as a,
       tests.create_intern('tk.b@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as b,
       tests.create_intern('tk.c@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as c,
       tests.create_person('tk.sup2@test.dev', false, true, false) as sup2,
       tests.create_person('tk.admin@test.dev', false, false, true) as admin;
grant select on ids to authenticated;
select tests.without_seed();
update public.daymark_placements set supervisor_id = (select sup2 from ids) where intern_id = (select c from ids);
create temp table tk (name text, id uuid);
grant all on tk to authenticated;
select tests.at('2026-10-12 07:00+09:30');

-- Validation.
select tests.as_person(tests.supervisor());
select throws_ok($$select public.save_task(null, ' ', null, 'medium', null, null, null, array[(select a from ids)], null, null, null)$$,
  '22023', null, 'a task name is needed');
select throws_ok($$select public.save_task(null, repeat('x', 141), null, 'medium', null, null, null, array[(select a from ids)], null, null, null)$$,
  '22023', null, 'the name is at most 140 characters');
select throws_ok($$select public.save_task(null, 'T', repeat('x', 2001), 'medium', null, null, null, array[(select a from ids)], null, null, null)$$,
  '22023', null, 'the description is at most 2,000 characters');
select throws_ok($$select public.save_task(null, 'T', null, 'urgent', null, null, null, array[(select a from ids)], null, null, null)$$,
  '22023', null, 'priority is high, medium or low');
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, 'http://x.dev', array[(select a from ids)], null, null, null)$$,
  '22023', null, 'the link must be https');
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, array[(select a from ids)], '{}', '2026-10-30', null)$$,
  '22023', null, 'repeat needs weekdays');
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, array[(select a from ids)], '{1,8}', '2026-10-30', null)$$,
  '22023', null, 'repeat weekdays are 1 to 7');
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, array[(select a from ids)], '{1}', null, null)$$,
  '22023', null, 'repeat needs an end date');
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, array[(select a from ids)], '{1}', '2026-10-11', null)$$,
  '22023', null, 'the end date is today or later');
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, '{}', null, null, null)$$,
  '22023', null, 'staff pick at least one intern');

-- Who may assign to whom.
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, array[(select c from ids)], null, null, null)$$,
  '42501', null, 'a supervisor can''t assign another supervisor''s intern');
insert into tk select 'report', public.save_task(null, 'Weekly report', 'Two pages', 'high', '2026-10-14', null,
  'https://docs.example/report', array[(select a from ids), (select b from ids)], null, null, null);
reset role;
select is((select count(*)::int from public.daymark_task_items where task_id = (select id from tk where name = 'report')), 2,
  'a two-intern task makes one copy each');
select is((select count(*)::int from public.daymark_notifications where kind = 'task' and title = 'New task'
  and person_id in ((select a from ids), (select b from ids))), 2, 'both interns are told');
select is((select count(*)::int from public.daymark_audit_log where action = 'save_task'), 1, 'audited');
insert into tk select 'report_a', id from public.daymark_task_items
where task_id = (select id from tk where name = 'report') and person_id = (select a from ids);

select tests.as_person(tests.supervisor());
select is((select count(*)::int from public.staff_tasks() where task_id = (select id from tk where name = 'report')), 2,
  'the supervisor sees both copies');
select is((select count(*)::int from public.staff_tasks((select a from ids))), 1, 'filtered to one intern');
select set_eq($$select person_id from public.task_people() where person_id in (select unnest(array[a, b, c]) from ids)$$,
  $$select unnest(array[a, b]) from ids$$, 'the supervisor picks from their own interns');
reset role;
select tests.as_person((select sup2 from ids));
select is((select count(*)::int from public.staff_tasks()), 0, 'another supervisor sees none of them');
select throws_ok(format('select public.save_task(%L, ''X'', null, ''low'', null, null, null, %L, null, null, null)',
  (select id from tk where name = 'report'), (select array[a] from ids)), '42501', null, 'another supervisor can''t edit');
select throws_ok(format('select public.archive_task(%L)', (select id from tk where name = 'report')), '42501', null,
  'another supervisor can''t archive');
reset role;

select tests.as_person((select admin from ids));
insert into tk select 'admin', public.save_task(null, 'Induction quiz', null, 'low', '2026-10-13', null, null,
  array[(select c from ids)], null, null, null);
select is((select count(*)::int from public.staff_tasks((select c from ids))), 1, 'an admin assigns any active intern');
reset role;

-- Interns: their own tasks only, with teammates.
select tests.as_person((select a from ids));
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, array[(select b from ids)], null, null, null)$$,
  '42501', null, 'an intern can''t assign someone else');
-- No assignees (empty or null) from an intern means the intern; staff send '{}' teammates, interns null.
insert into tk select 'empty', public.save_task(null, 'Read the handbook', null, 'low', null, null, null, '{}', null, null, '{}');
insert into tk select 'nulls', public.save_task(null, 'Book a desk', null, 'low', null, null, null, null, null, null, null);
select results_eq($$select title, description, due_date, due_time, link, done_at, done_note, repeat_days, working_with
                    from public.my_tasks() where task_id in (select id from tk where name in ('empty', 'nulls'))$$,
  $$values ('Book a desk', null::text, null::date, null::time, null::text, null::timestamptz, null::text, null::int[], '{}'::text[]),
           ('Read the handbook', null, null, null, null, null, null, null, '{}')$$,
  'empty or null assignees mean the intern, and missing fields come back as nulls');
select public.archive_task(id) from tk where name in ('empty', 'nulls');
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, array[(select a from ids)], null, null,
  array[tests.supervisor()])$$, '22023', null, 'teammates are active interns');
select throws_ok(format('select public.save_task(%L, ''X'', null, ''low'', null, null, null, %L, null, null, null)',
  (select id from tk where name = 'report'), (select array[a] from ids)), '42501', null, 'an intern can''t edit a supervisor''s task');
insert into tk select 'own', public.save_task(null, 'Tidy the shared drive', null, 'medium', '2026-10-13', '15:00', null,
  array[(select a from ids)], null, null, array[(select b from ids)]);
reset role;
select is((select count(*)::int from public.daymark_notifications where kind = 'task' and person_id = (select a from ids)), 1,
  'nobody is told about their own task');

select tests.as_person((select b from ids));
select results_eq($$select own, working_with from public.my_tasks() where task_id = (select id from tk where name = 'own')$$,
  $$select false, array['tk.a']$$, 'a teammate sees the task, read-only, working with its owner');
select throws_ok(format('select public.set_task_status(%L, ''done'')',
  (select item_id from public.my_tasks() where task_id = (select id from tk where name = 'own'))), '42501', null,
  'a teammate can''t tick it');
reset role;

select tests.as_person((select a from ids));
select results_eq($$select title, own, working_with from public.my_tasks()$$,
  $$values ('Tidy the shared drive', true, array['tk.b']), ('Weekly report', true, '{}'::text[])$$,
  'the intern sees their own copies, by due date');
select throws_ok(format('select public.set_task_status(%L, ''done'', %L)',
  (select item_id from public.my_tasks() where task_id = (select id from tk where name = 'own')), repeat('x', 501)), '22023', null,
  'the done note is at most 500 characters');
select throws_ok(format('select public.set_task_status(%L, ''finished'')',
  (select item_id from public.my_tasks() where task_id = (select id from tk where name = 'own'))), '22023', null,
  'status is todo, in_progress or done');
select public.set_task_status((select item_id from public.my_tasks() where task_id = (select id from tk where name = 'own')),
  'done', 'Folders sorted');
select results_eq($$select title, status, done_note, done_at is not null from public.my_tasks()$$,
  $$values ('Weekly report', 'todo', null::text, false), ('Tidy the shared drive', 'done', 'Folders sorted', true)$$,
  'done keeps the note and sorts after open ones');
select public.set_task_status((select item_id from public.my_tasks() where task_id = (select id from tk where name = 'report')),
  'in_progress');
select is((select done_at from public.my_tasks() where task_id = (select id from tk where name = 'report')), null,
  'in progress has no done time');
reset role;
select tests.as_person((select c from ids));
select is((select count(*)::int from public.my_tasks()), 1, 'C sees only their own task');
select set_eq($$select person_id from public.task_people() where person_id in (select unnest(array[a, b, c]) from ids)$$,
  $$select unnest(array[a, b]) from ids$$, 'an intern picks teammates from the other interns');
reset role;
select tests.as_person((select sup2 from ids));
select throws_ok(format('select public.set_task_status(%L, ''done'')',
  (select id from tk where name = 'report_a')),
  '42501', null, 'another supervisor can''t tick it');
reset role;

-- Edit: B is removed and A's open copy moves to Thursday; then the task is archived.
select tests.as_person(tests.supervisor());
select public.save_task((select id from tk where name = 'report'), 'Weekly report v2', null, 'high', '2026-10-15', null, null,
  (select array[a] from ids), null, null, null);
select results_eq($$select person_id, due_date from public.staff_tasks() where task_id = (select id from tk where name = 'report')$$,
  $$select a, '2026-10-15'::date from ids$$, 'the removed intern''s open copy drops out, the other moves');
select throws_ok(format('select public.save_task(%L, ''X'', null, ''low'', null, null, null, %L, ''{1}'', ''2026-10-30'', null)',
  (select id from tk where name = 'report'), (select array[a] from ids)), '22023', null, 'a one-off task can''t become repeating');
reset role;
select tests.as_person((select b from ids));
select is((select count(*)::int from public.my_tasks() where task_id = (select id from tk where name = 'report')), 0,
  'B no longer sees it');
reset role;
select tests.as_person(tests.supervisor());
select public.archive_task((select id from tk where name = 'report'));
reset role;
select tests.as_person((select a from ids));
select is((select count(*)::int from public.my_tasks() where task_id = (select id from tk where name = 'report')), 0,
  'an archived task leaves the list');
select public.archive_task((select id from tk where name = 'own'));
reset role;
select isnt((select archived_at from public.daymark_tasks where id = (select id from tk where name = 'own')), null,
  'the creator can archive their own task');

-- Repeats: Mon and Wed until Mon 19 Oct. Monday's copy straight away, then the job makes the rest.
select tests.as_person(tests.supervisor());
insert into tk select 'repeat', public.save_task(null, 'Stand-up notes', null, 'medium', null, null, null,
  (select array[a] from ids), '{3,1}', '2026-10-19', null);
reset role;
select is((select array_agg(due_date order by due_date) from public.daymark_task_items where task_id = (select id from tk where name = 'repeat')),
  array['2026-10-12'::date], 'today''s copy is made at once');
select tests.at('2026-10-13 00:05+09:30');
select private.job_tasks();
select tests.at('2026-10-14 00:05+09:30');
select private.job_tasks();
select private.job_tasks();
select tests.at('2026-10-19 00:05+09:30');
select private.job_tasks();
select tests.at('2026-10-21 00:05+09:30');
select private.job_reminders();
select is((select array_agg(due_date order by due_date) from public.daymark_task_items where task_id = (select id from tk where name = 'repeat')),
  array['2026-10-12', '2026-10-14', '2026-10-19']::date[], 'copies on chosen days only, until the end date');

-- Due-day reminder for B on Thu 22 Oct: one task at 08:30, so the push goes at 07:30.
select tests.at('2026-10-21 12:00+09:30');
select tests.as_person(tests.supervisor());
insert into tk select 'b1', public.save_task(null, 'Call the client', null, 'low', '2026-10-22', '08:30', null,
  (select array[b] from ids), null, null, null);
insert into tk select 'b2', public.save_task(null, 'File receipts', null, 'high', '2026-10-22', null, null,
  (select array[b] from ids), null, null, null);
reset role;
select tests.at('2026-10-22 07:20+09:30');
select is(private.job_tasks(), 0, 'not before an hour ahead of the earliest due time');
select tests.at('2026-10-22 07:35+09:30');
select is(private.job_tasks(), 1, 'the due-day reminder goes');
select is(private.job_tasks(), 0, 'once');
select is((select body from public.daymark_notifications where title = 'Tasks due today' and person_id = (select b from ids)),
  '2 tasks due today: Call the client, …', 'it counts the tasks and names the first');

-- The morning summary on Fri 23 Oct counts overdue open copies.
-- The supervisor: A's repeat copies (12, 14, 19 Oct) and B's two from yesterday. The admin adds C's quiz.
select tests.at('2026-10-23 08:05+09:30');
select private.job_digest();
select ok((select body like '%5 tasks overdue%' from public.daymark_notifications
           where kind = 'digest' and person_id = tests.supervisor()), 'the supervisor''s summary counts overdue tasks');
select ok((select body like '%6 tasks overdue%' from public.daymark_notifications
           where kind = 'digest' and person_id = (select admin from ids)), 'an admin''s counts everyone''s');

-- After 30 days a done copy leaves the lists; an open overdue copy stays.
select tests.as_person((select b from ids));
select public.set_task_status((select item_id from public.my_tasks() where task_id = (select id from tk where name = 'b1')), 'done');
reset role;
select tests.at('2026-11-21 08:00+09:30');
select tests.as_person((select b from ids));
select is((select count(*)::int from public.my_tasks() where task_id = (select id from tk where name = 'b1')), 1,
  'a done copy stays for 30 days');
reset role;
select tests.at('2026-11-23 08:00+09:30');
select tests.as_person((select b from ids));
select results_eq($$select title from public.my_tasks()$$, $$values ('File receipts')$$,
  'then it goes, and the open overdue one stays');
reset role;

select ok('task' = any (private.push_kind_options())
          and (select 'task' = any (push_kinds) from public.daymark_settings where id = 1), 'task pushes are ticked');

select * from finish();
rollback;

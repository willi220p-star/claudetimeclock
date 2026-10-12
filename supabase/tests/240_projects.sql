begin;
select plan(106);

-- Projects (Dilip, 13 Oct; D49). Mon 12 Oct. A and B are tests.supervisor()'s interns, C is sup2's.
create temp table ids as
select tests.create_intern('pj.a@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as a,
       tests.create_intern('pj.b@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as b,
       tests.create_intern('pj.c@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as c,
       tests.create_person('pj.sup2@test.dev', false, true, false) as sup2,
       tests.create_person('pj.admin@test.dev', false, false, true) as admin;
grant select on ids to authenticated;
select tests.without_seed();
update public.daymark_placements set supervisor_id = (select sup2 from ids) where intern_id = (select c from ids);
create temp table tk (name text, id uuid);
grant all on tk to authenticated;
select tests.at('2026-10-12 07:00+09:30');

-- The new tables are closed to the app.
select ok((select bool_and(c.relrowsecurity and not has_table_privilege('authenticated', c.oid, 'select')
                           and not has_table_privilege('authenticated', c.oid, 'insert'))
           from pg_class c
           where c.oid in ('public.daymark_projects'::regclass, 'public.daymark_project_members'::regclass,
                           'public.daymark_milestones'::regclass, 'public.daymark_project_activity'::regclass,
                           'public.daymark_labels'::regclass, 'public.daymark_task_labels'::regclass)),
  'the project tables have RLS on and no grants to the app');
select ok(not has_function_privilege('authenticated', 'public.save_task_d48(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[], uuid, int, text[])', 'execute')
          and not has_function_privilege('authenticated', 'public.my_tasks_d48()', 'execute')
          and not has_function_privilege('authenticated', 'public.staff_tasks_d48(uuid)', 'execute'),
  'the renamed D48 functions are switched off');

-- Validation.
select tests.as_person((select a from ids));
select throws_ok($$select public.save_project(null, ' ', null, null, null, null, null, null, null, null, null, null, null)$$,
  '22023', 'Write a project name up to 80 characters.', 'a project name is needed');
select throws_ok($$select public.save_project(null, repeat('x', 81), null, null, null, null, null, null, null, null, null, null, null)$$,
  '22023', null, 'the name is at most 80 characters');
select throws_ok($$select public.save_project(null, 'P', repeat('x', 121), null, null, null, null, null, null, null, null, null, null)$$,
  '22023', null, 'the client is at most 120 characters');
select throws_ok($$select public.save_project(null, 'P', null, null, 'jo.acme.test', null, null, null, null, null, null, null, null)$$,
  '22023', null, 'the contact email needs an @');
select throws_ok($$select public.save_project(null, 'P', null, null, null, repeat('1', 31), null, null, null, null, null, null, null)$$,
  '22023', null, 'the phone is at most 30 characters');
select throws_ok($$select public.save_project(null, 'P', null, null, null, null, '2026-10-20', '2026-10-19', null, null, null, null, null)$$,
  '22023', 'The due date must be on or after the start date.', 'due on or after start');
select throws_ok($$select public.save_project(null, 'P', null, null, null, null, null, null, 'done', null, null, null, null)$$,
  '22023', null, 'status is planning, active, on hold or completed');
select throws_ok($$select public.save_project(null, 'P', null, null, null, null, null, null, null, repeat('x', 2001), null, null, null)$$,
  '22023', null, 'the description is at most 2,000 characters');
select throws_ok($$select public.save_project(null, 'P', null, null, null, null, null, null, null, null,
  array(select 'https://x.dev/' || g from generate_series(1, 6) g), null, null)$$, '22023', null, 'at most 5 links');
select throws_ok($$select public.save_project(null, 'P', null, null, null, null, null, null, null, null,
  array['http://x.dev'], null, null)$$, '22023', null, 'links start with https://');
select throws_ok($$select public.save_project(null, 'P', null, null, null, null, null, null, null, null, null, null,
  array[tests.supervisor()])$$, '22023', null, 'an intern adds interns only');

-- An intern's project waits for approval.
insert into tk select 'p1', public.save_project(null, 'Website', 'Acme Pty Ltd', 'Jo Client', 'jo@acme.test', '0400 000 000',
  '2026-10-12', '2026-11-30', null, 'New site', array[' https://acme.test '], null, array[(select b from ids)]);
reset role;
select results_eq($$select lead_id, created_by, approved_at, approved_by, status, links from public.daymark_projects
                    where id = (select id from tk where name = 'p1')$$,
  $$select a, a, null::timestamptz, null::uuid, 'planning', array['https://acme.test'] from ids$$,
  'an intern''s project waits, led by its creator');
select ok(exists (select 1 from public.daymark_notifications where person_id = tests.supervisor() and kind = 'request'
                  and title = 'Project to approve: Website' and link = '/supervisor/projects')
          and exists (select 1 from public.daymark_notifications where person_id = (select admin from ids)
                      and title = 'Project to approve: Website')
          and not exists (select 1 from public.daymark_notifications
                          where person_id in (select unnest(array[a, b, sup2]) from ids) and title = 'Project to approve: Website'),
  'the supervisor and the admins are asked, nobody else');

select tests.as_person((select a from ids));
select results_eq($$select name, waiting, lead_name from public.my_projects()$$, $$values ('Website', true, 'pj.a')$$,
  'the creator sees it waiting');
select is((select count(*)::int from public.project_lookup()), 0, 'a waiting project can''t be picked');
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, null, null, null, null, null, null, null,
  (select id from tk where name = 'p1'))$$, '42501', 'Pick a project you''re part of.', 'nor filed under');
select throws_ok($$select public.approve_project((select id from tk where name = 'p1'), true)$$, '42501', null,
  'the creator can''t approve it');
reset role;
select tests.as_person((select b from ids));
select is((select count(*)::int from public.my_projects()), 0, 'a member doesn''t see it before approval');
reset role;
select tests.as_person((select sup2 from ids));
select is((select count(*)::int from public.my_projects()), 0, 'another supervisor doesn''t see it');
select throws_ok($$select public.approve_project((select id from tk where name = 'p1'), true)$$, '42501', null,
  'another supervisor can''t approve it');
reset role;
select tests.as_person(tests.supervisor());
select results_eq($$select name, waiting from public.my_projects()$$, $$values ('Website', true)$$,
  'the creator''s supervisor sees it to approve');
select throws_ok($$select public.approve_project((select id from tk where name = 'p1'), null)$$, '22023', null,
  'approve or decline');
select tests.at('2026-10-12 07:05+09:30');
select public.approve_project((select id from tk where name = 'p1'), true);
select throws_ok($$select public.approve_project((select id from tk where name = 'p1'), true)$$, '22023',
  'This project isn''t waiting for approval.', 'only once');
reset role;
select results_eq($$select approved_at, approved_by from public.daymark_projects where id = (select id from tk where name = 'p1')$$,
  $$values ('2026-10-12 07:05+09:30'::timestamptz, tests.supervisor())$$, 'approve sets who and when');
select is((select link from public.daymark_notifications where person_id = (select a from ids) and title = 'Project approved: Website'),
  '/clock/projects/view?id=' || (select id from tk where name = 'p1'), 'the creator is told');

-- Decline: archived, the creator gets the note, no activity.
select tests.as_person((select c from ids));
insert into tk select 'p2', public.save_project(null, 'Secret', null, null, null, null, null, null, 'active', null, null, null, null);
reset role;
select tests.as_person(tests.supervisor());
select throws_ok($$select public.approve_project((select id from tk where name = 'p2'), false, 'No')$$, '42501', null,
  'only the creator''s own supervisor or an admin');
reset role;
select tests.as_person((select sup2 from ids));
select throws_ok($$select public.approve_project((select id from tk where name = 'p2'), false, repeat('x', 501))$$, '22023', null,
  'the note is at most 500 characters');
select public.approve_project((select id from tk where name = 'p2'), false, ' Not this term ');
reset role;
select results_eq($$select archived_at is not null, approved_at from public.daymark_projects where id = (select id from tk where name = 'p2')$$,
  $$values (true, null::timestamptz)$$, 'decline archives it');
select is((select body from public.daymark_notifications where person_id = (select c from ids) and title = 'Project declined: Secret'),
  'Not this term', 'the creator gets the note');
select is((select array_agg(kind) from public.daymark_project_activity where project_id = (select id from tk where name = 'p2')),
  array['project_created'], 'decline writes no activity');

-- Who sees an approved project.
select tests.as_person((select b from ids));
select results_eq($$select name, waiting, lead_name from public.my_projects()$$, $$values ('Website', false, 'pj.a')$$,
  'a member sees it once approved');
select results_eq($$select name, client_name from public.project_lookup(' acme ')$$, $$values ('Website', 'Acme Pty Ltd')$$,
  'lookup matches the client, any case');
select is((select count(*)::int from public.project_lookup('zzz')), 0, 'lookup filters');
select throws_ok($$select public.save_project((select id from tk where name = 'p1'), 'Mine now', null, null, null, null, null, null,
  null, null, null, (select b from ids), null)$$, '42501', null, 'a member can''t edit it');
reset role;
select tests.as_person((select c from ids));
select is((select count(*)::int from public.my_projects()), 0, 'another team''s intern doesn''t see it');
select is((select count(*)::int from public.project_lookup('web')), 0, 'or look it up');
select throws_ok($$select public.project_detail((select id from tk where name = 'p1'))$$, '42501', null, 'or open it');
select throws_ok($$select public.project_activity((select id from tk where name = 'p1'))$$, '42501', null, 'or read its activity');
reset role;
select tests.as_person((select sup2 from ids));
select is((select count(*)::int from public.my_projects()), 0, 'another supervisor doesn''t see it');
reset role;
select tests.as_person((select admin from ids));
select is((select count(*)::int from public.my_projects() where name = 'Website'), 1, 'an admin sees every project');
reset role;

-- A staff project is approved at once; project_people by role.
select tests.as_person(tests.supervisor());
insert into tk select 'p3', public.save_project(null, 'Ops', 'Internal', null, null, null, null, null, 'active', null, null,
  tests.supervisor(), null);
select set_eq($$select person_id from public.project_people()
                where person_id in (select unnest(array[a, b, c, sup2, admin, tests.supervisor()]) from ids)$$,
  $$select unnest(array[a, b, c, sup2, admin, tests.supervisor()]) from ids$$, 'staff add any active intern or staff member');
reset role;
select results_eq($$select approved_at, approved_by from public.daymark_projects where id = (select id from tk where name = 'p3')$$,
  $$values ('2026-10-12 07:05+09:30'::timestamptz, tests.supervisor())$$, 'a staff project is approved at once');
select tests.as_person((select a from ids));
select set_eq($$select person_id from public.project_people()
                where person_id in (select unnest(array[a, b, c, sup2, admin, tests.supervisor()]) from ids)$$,
  $$select unnest(array[a, b, c]) from ids$$, 'an intern adds active interns');
select is((select count(*)::int from public.my_projects() where name = 'Ops'), 0, 'not part of Ops yet');
reset role;

-- Status change and milestones.
select tests.at('2026-10-12 07:10+09:30');
select tests.as_person((select a from ids));
select public.save_project((select id from tk where name = 'p1'), 'Website', 'Acme Pty Ltd', 'Jo Client', 'jo@acme.test',
  '0400 000 000', '2026-10-12', '2026-11-30', 'active', 'New site', array['https://acme.test'], (select a from ids),
  array[(select b from ids)]);
select throws_ok($$select public.save_milestone(null, (select id from tk where name = 'p1'), ' ', null)$$, '22023', null,
  'a milestone needs a name');
insert into tk select 'm1', public.save_milestone(null, (select id from tk where name = 'p1'), 'Design', '2026-10-20');
insert into tk select 'm2', public.save_milestone(null, (select id from tk where name = 'p1'), 'Launch', '2026-10-30');
insert into tk select 'm3', public.save_milestone(null, (select id from tk where name = 'p1'), 'Later', null);
reset role;
select tests.as_person((select b from ids));
select throws_ok($$select public.save_milestone(null, (select id from tk where name = 'p1'), 'Mine', null)$$, '42501', null,
  'a member who isn''t the lead can''t add milestones');
reset role;
select tests.as_person((select sup2 from ids));
select throws_ok($$select public.save_milestone(null, (select id from tk where name = 'p1'), 'Mine', null)$$, '42501', null,
  'staff who can''t see it can''t either');
reset role;
select tests.as_person(tests.supervisor());
insert into tk select 'm4', public.save_milestone(null, (select id from tk where name = 'p3'), 'Kickoff', null);
reset role;

-- Tasks under a project.
select tests.at('2026-10-12 07:15+09:30');
select tests.as_person((select c from ids));
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, null, null, null, null, null, null, null,
  (select id from tk where name = 'p1'))$$, '42501', 'Pick a project you''re part of.', 'save_task refuses a project the caller can''t see');
reset role;
select tests.as_person((select a from ids));
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, null, null, null, null, null, null, null,
  (select id from tk where name = 'p1'), (select id from tk where name = 'm4'))$$, '22023', 'Pick a milestone of this project.',
  'and a milestone from another project');
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, null, null, null, null, null, null, null,
  null, (select id from tk where name = 'm1'))$$, '22023', null, 'a milestone needs its project');
insert into tk select 't1', public.save_task(null, 'Wireframes', null, 'high', '2026-10-20', null, null, null, null, null, null,
  null, 60, null, (select id from tk where name = 'p1'), (select id from tk where name = 'm1'));
insert into tk select 't2', public.save_task(null, 'Copy', null, 'medium', '2026-10-09', null, null, null, null, null, null,
  null, 30, null, (select id from tk where name = 'p1'), (select id from tk where name = 'm1'));
reset role;
select tests.as_person(tests.supervisor());
insert into tk select 't3', public.save_task(null, 'Launch checklist', null, 'medium', '2026-10-29', null, null,
  array[(select b from ids)], null, null, null, tests.supervisor(), 45, null, (select id from tk where name = 'p1'),
  (select id from tk where name = 'm2'));
insert into tk select 't4', public.save_task(null, 'Ops report', null, 'low', '2026-10-14', null, null,
  array[(select a from ids)], null, null, null, null, 120, null, (select id from tk where name = 'p3'), null);
reset role;
insert into tk select tk.name || '_item', i.id from tk join public.daymark_task_items i on i.task_id = tk.id
where tk.name in ('t1', 't2', 't3', 't4');
select is((select count(*)::int from public.daymark_project_activity
           where project_id = (select id from tk where name = 'p1') and kind = 'task_added'), 3,
  'each task filed under the project is in its activity');

-- A live copy makes the project visible; the zero uuid clears the project, null keeps it.
select tests.as_person((select a from ids));
select is((select count(*)::int from public.my_projects() where name = 'Ops'), 1, 'a live copy in a project shows it');
select public.save_task((select id from tk where name = 't1'), 'Wireframes v2', null, 'high', '2026-10-20', null, null, null,
  null, null, null, null, 60, null, null, null);
reset role;
select results_eq($$select project_id, milestone_id from public.daymark_tasks where id = (select id from tk where name = 't1')$$,
  $$select (select id from tk where name = 'p1'), (select id from tk where name = 'm1')$$,
  'an edit with project null keeps the project and milestone');
select tests.as_person(tests.supervisor());
select public.save_task((select id from tk where name = 't4'), 'Ops report', null, 'low', '2026-10-14', null, null,
  array[(select a from ids)], null, null, null, null, 120, null, '00000000-0000-0000-0000-000000000000', null);
reset role;
select results_eq($$select project_id, milestone_id from public.daymark_tasks where id = (select id from tk where name = 't4')$$,
  $$values (null::uuid, null::uuid)$$, 'the zero uuid clears them');
select tests.as_person((select a from ids));
select is((select count(*)::int from public.my_projects() where name = 'Ops'), 0, 'and the project drops out');

-- my_tasks and staff_tasks: the new columns.
select results_eq($$select project_id, project_name, milestone_id, milestone_name, labels from public.my_tasks()
                    where item_id = (select id from tk where name = 't1_item')$$,
  $$select (select id from tk where name = 'p1'), 'Website', (select id from tk where name = 'm1'), 'Design', '{}'::text[]$$,
  'my_tasks has the project, milestone and labels');
reset role;
select tests.as_person(tests.supervisor());
select results_eq($$select project_name, milestone_name from public.staff_tasks() where item_id = (select id from tk where name = 't3_item')$$,
  $$values ('Website', 'Launch')$$, 'staff_tasks too');
reset role;

-- Progress maths.
select tests.at('2026-10-12 07:20+09:30');
select tests.as_person((select a from ids));
select public.set_task_status((select id from tk where name = 't1_item'), 'done');
select public.log_task_time((select id from tk where name = 't2_item'), 20);
select public.set_task_blocked((select id from tk where name = 't2_item'), 'Waiting for the copy');
reset role;
select tests.as_person((select b from ids));
select public.set_task_status((select id from tk where name = 't3_item'), 'in_review');
reset role;
select tests.as_person((select a from ids));
select results_eq($$select status, tasks_total, tasks_done, estimate_minutes, spent_minutes, overdue, blocked, in_review,
                           next_milestone, next_milestone_due
                    from public.my_projects() where name = 'Website'$$,
  $$values ('active', 3, 1, 135, 20, 1, 1, 1, 'Design', '2026-10-20'::date)$$, 'the progress maths');
select results_eq($$select x->>'name', (x->>'tasks_total')::int, (x->>'tasks_done')::int, (x->>'done')::boolean
                    from jsonb_array_elements(public.project_detail((select id from tk where name = 'p1'))->'milestones') x$$,
  $$values ('Design', 2, 1, false), ('Launch', 1, 0, false), ('Later', 0, 0, false)$$,
  'milestones with open tasks, or none, aren''t done');
select results_eq($$select d->'project'->>'name', d->'project'->>'lead_name', d->'project'->>'created_by_name',
                           d->'project'->>'contact_email', d->'members'
                    from public.project_detail((select id from tk where name = 'p1')) d$$,
  $$select 'Website', 'pj.a', 'pj.a', 'jo@acme.test', jsonb_build_array(jsonb_build_object('id', b, 'name', 'pj.b')) from ids$$,
  'project_detail has the project, its people and members');

-- The last task of a milestone finishing makes it done.
select public.set_task_blocked((select id from tk where name = 't2_item'), null);
select public.set_task_status((select id from tk where name = 't2_item'), 'done');
select is((select (x->>'done')::boolean
           from jsonb_array_elements(public.project_detail((select id from tk where name = 'p1'))->'milestones') x
           where x->>'name' = 'Design'), true, 'a milestone with all its tasks done is done');
select results_eq($$select next_milestone, tasks_done from public.my_projects() where name = 'Website'$$, $$values ('Launch', 2)$$,
  'the next milestone moves on');
reset role;
select tests.at('2026-10-12 07:25+09:30');
select tests.as_person(tests.supervisor());
select public.review_task((select id from tk where name = 't3_item'), false, 'Add the footer');
reset role;
select tests.as_person((select b from ids));
select public.set_task_status((select id from tk where name = 't3_item'), 'in_review');
reset role;
select tests.at('2026-10-12 07:30+09:30');
select tests.as_person(tests.supervisor());
select public.review_task((select id from tk where name = 't3_item'), true);
reset role;
select tests.as_person((select a from ids));
select results_eq($$select next_milestone, next_milestone_due, tasks_done, in_review from public.my_projects() where name = 'Website'$$,
  $$values ('Later', null::date, 3, 0)$$, 'an empty milestone is never done');

-- Activity: every kind, newest first, 30 at a time, 90 days back.
select set_eq($$select distinct kind from public.project_activity((select id from tk where name = 'p1'))$$,
  $$values ('project_created'), ('member_added'), ('project_approved'), ('status_changed'), ('milestone_added'), ('task_added'),
           ('task_done'), ('milestone_done'), ('changes_asked'), ('review_approved')$$, 'activity rows for each kind');
select is((select text from public.project_activity((select id from tk where name = 'p1')) where kind = 'status_changed'),
  'Planning → Active', 'a status change says from and to');
select set_eq($$select text from public.project_activity((select id from tk where name = 'p1')) where kind = 'milestone_done'$$,
  $$values ('Design'), ('Launch')$$, 'milestone_done when its last task finishes, by status or by review');
select results_eq($$select actor_name, text from public.project_activity((select id from tk where name = 'p1'))
                    where kind in ('member_added', 'review_approved') order by kind$$,
  $$values ('pj.a', 'pj.b'), ('Test Supervisor', 'Launch checklist')$$, 'who did it, and to what');
select is((select count(*)::int from public.project_activity((select id from tk where name = 'p1'))
           where kind = 'task_done'), 2, 'task_done by the person ticking it');
select is((select created_at from public.project_activity((select id from tk where name = 'p1')) limit 1),
  '2026-10-12 07:30+09:30'::timestamptz, 'newest first');
select set_eq($$select kind from public.project_activity((select id from tk where name = 'p1'), '2026-10-12 07:05+09:30')$$,
  $$values ('project_created'), ('member_added')$$, 'before pages back');
select tests.at('2027-01-20 07:00+09:30');
select is((select count(*)::int from public.project_activity((select id from tk where name = 'p1'))), 0, 'within the last 90 days');
select tests.at('2026-10-12 07:40+09:30');
reset role;
insert into public.daymark_project_activity (project_id, actor_name, kind, text, created_at)
select (select id from tk where name = 'p1'), 'Someone', 'task_added', 'Filler ' || g, '2026-10-01 07:00+09:30'::timestamptz
from generate_series(1, 30) g;
select tests.as_person((select a from ids));
select is((select count(*)::int from public.project_activity((select id from tk where name = 'p1'))), 30, '30 at a time');
reset role;

-- Labels.
select tests.as_person((select a from ids));
select throws_ok($$select public.save_label(null, 'Mine', 'red')$$, '42501', null, 'only staff add labels');
reset role;
select tests.as_person(tests.supervisor());
insert into tk select 'urgent', public.save_label(null, ' Urgent ', 'red');
insert into tk select 'client', public.save_label(null, 'Client', 'blue');
select throws_ok($$select public.save_label(null, 'urgent', 'teal')$$, '22023', 'There''s already a label with that name.',
  'label names are unique');
select throws_ok($$select public.save_label(null, 'X', 'black')$$, '22023', null, 'colours are from the list');
select throws_ok($$select public.save_label(null, repeat('x', 31), 'red')$$, '22023', null, 'a label is at most 30 characters');
select public.save_label((select id from tk where name = 'client'), 'Client work', 'teal');
reset role;
select tests.as_person((select a from ids));
select results_eq($$select name, colour from public.labels()$$, $$values ('Client work', 'teal'), ('Urgent', 'red')$$,
  'anyone signed in lists the live labels');
select public.set_task_labels((select id from tk where name = 't1'), (select array[id] from tk where name = 'urgent')
  || (select array[id] from tk where name = 'client'));
select is((select labels from public.my_tasks() where item_id = (select id from tk where name = 't1_item')),
  array['Client work', 'Urgent'], 'the person labels their own task');
select public.set_task_labels((select id from tk where name = 't1'), (select array[id] from tk where name = 'client'));
select is((select labels from public.my_tasks() where item_id = (select id from tk where name = 't1_item')),
  array['Client work'], 'a label left out comes off');
reset role;
select results_eq($$select count(*)::int, count(removed_at)::int from public.daymark_task_labels
                    where task_id = (select id from tk where name = 't1')$$, $$values (2, 1)$$,
  'by marking it removed, not deleting it');
select tests.as_person((select a from ids));
select public.set_task_labels((select id from tk where name = 't1'), (select array[id] from tk where name = 'urgent')
  || (select array[id] from tk where name = 'client'));
reset role;
select results_eq($$select count(*)::int, count(removed_at)::int from public.daymark_task_labels
                    where task_id = (select id from tk where name = 't1')$$, $$values (2, 0)$$,
  'putting it back clears removed_at');
select tests.as_person((select c from ids));
select throws_ok($$select public.set_task_labels((select id from tk where name = 't1'), '{}')$$, '42501', null,
  'someone else can''t label it');
reset role;
select tests.as_person((select b from ids));
select lives_ok($$select public.set_task_labels((select id from tk where name = 't3'), (select array[id] from tk where name = 'urgent'))$$,
  'an assignee labels a task their supervisor gave them');
reset role;
select tests.as_person(tests.supervisor());
select public.archive_label((select id from tk where name = 'urgent'));
select throws_ok($$select public.archive_label((select id from tk where name = 'urgent'))$$, 'P0002', null,
  'an archived label is gone');
reset role;
select tests.as_person((select a from ids));
select is((select labels from public.my_tasks() where item_id = (select id from tk where name = 't1_item')),
  array['Client work'], 'an archived label drops off tasks');
select throws_ok($$select public.set_task_labels((select id from tk where name = 't1'), (select array[id] from tk where name = 'urgent'))$$,
  '22023', 'Pick labels from the list.', 'and can''t be added');
select is((select count(*)::int from public.labels()), 1, 'or listed');
reset role;

-- Workload: Mon 12 to Sun 18 Oct. A has the Ops report (due Wed, 120 min) plus two more.
select tests.as_person(tests.supervisor());
insert into tk select 'w2', public.save_task(null, 'Next week', null, 'low', '2026-10-20', null, null, array[(select a from ids)],
  null, null, null, null, 60, null);
insert into tk select 'w3', public.save_task(null, 'Late one', null, 'low', '2026-10-05', null, null, array[(select a from ids)],
  null, null, null, null, 30, null);
reset role;
insert into tk select 'w3_item', i.id from public.daymark_task_items i where i.task_id = (select id from tk where name = 'w3');
select tests.as_person(tests.supervisor());
select public.set_task_blocked((select id from tk where name = 'w3_item'), 'Stuck');
select set_eq($$select person_id from public.task_workload('2026-10-14') where person_id in (select unnest(array[a, b, c]) from ids)$$,
  $$select unnest(array[a, b]) from ids$$, 'a supervisor sees their own interns');
select results_eq($$select open_tasks, estimate_due_minutes, rostered_minutes, overdue, blocked, in_review
                    from public.task_workload('2026-10-14') where person_id = (select a from ids)$$,
  $$values (3, 120, 2250, 1, 1, 0)$$, 'the workload maths (any day picks its Monday)');
select is((select estimate_due_minutes from public.task_workload('2026-10-19') where person_id = (select a from ids)), 60,
  'the next week');
select results_eq($$select open_tasks, rostered_minutes from public.task_workload('2026-10-12') where person_id = (select b from ids)$$,
  $$values (0, 2250)$$, 'done copies don''t count');
reset role;
select tests.as_person((select sup2 from ids));
select set_eq($$select person_id from public.task_workload('2026-10-12') where person_id in (select unnest(array[a, b, c]) from ids)$$,
  $$select c from ids$$, 'another supervisor sees only theirs');
reset role;
select tests.as_person((select admin from ids));
select set_eq($$select person_id from public.task_workload('2026-10-12') where person_id in (select unnest(array[a, b, c]) from ids)$$,
  $$select unnest(array[a, b, c]) from ids$$, 'an admin sees every active intern');
reset role;
select tests.as_person((select a from ids));
select throws_ok($$select * from public.task_workload('2026-10-12')$$, '42501', null, 'interns can''t');
reset role;

-- Archive rules.
select tests.as_person((select a from ids));
insert into tk select 'p5', public.save_project(null, 'Side project', null, null, null, null, null, null, null, null, null,
  (select b from ids), null);
reset role;
select tests.as_person(tests.supervisor());
select public.approve_project((select id from tk where name = 'p5'), true);
reset role;
select tests.as_person((select a from ids));
select throws_ok($$select public.save_project((select id from tk where name = 'p5'), 'Side', null, null, null, null, null, null,
  null, null, null, (select b from ids), null)$$, '42501', null, 'once approved, the creator who isn''t the lead can''t edit');
select lives_ok($$select public.archive_project((select id from tk where name = 'p5'))$$, 'but can archive it');
reset role;
select tests.as_person((select b from ids));
select throws_ok($$select public.archive_project((select id from tk where name = 'p1'))$$, '42501', null,
  'a member can''t archive the project');
select throws_ok($$select public.archive_milestone((select id from tk where name = 'm3'))$$, '42501', null,
  'or its milestones');
reset role;
select tests.as_person((select sup2 from ids));
select throws_ok($$select public.archive_project((select id from tk where name = 'p1'))$$, '42501', null,
  'staff who can''t see it can''t archive it');
reset role;
select tests.as_person((select a from ids));
select public.archive_milestone((select id from tk where name = 'm3'));
select is((select jsonb_array_length(public.project_detail((select id from tk where name = 'p1'))->'milestones')), 2,
  'the lead archives a milestone');
select public.archive_project((select id from tk where name = 'p1'));
select is((select count(*)::int from public.my_projects()), 0, 'the lead archives the project');
select throws_ok($$select public.project_detail((select id from tk where name = 'p1'))$$, 'P0002', 'That project is gone.',
  'an archived project is gone');
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, null, null, null, null, null, null, null,
  (select id from tk where name = 'p1'))$$, '42501', null, 'and can''t be picked');
select is((select project_name from public.my_tasks() where item_id = (select id from tk where name = 't1_item')), null,
  'its tasks lose the project name');
reset role;

select * from finish();
rollback;

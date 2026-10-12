begin;
select plan(68);

-- Tasks v2 (Dilip, 13 Oct; D48). Mon 12 Oct. A and B are tests.supervisor()'s interns, C is sup2's.
create temp table ids as
select tests.create_intern('v2.a@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as a,
       tests.create_intern('v2.b@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as b,
       tests.create_intern('v2.c@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as c,
       tests.create_person('v2.sup2@test.dev', false, true, false) as sup2,
       tests.create_person('v2.admin@test.dev', false, false, true) as admin;
grant select on ids to authenticated;
select tests.without_seed();
update public.daymark_placements set supervisor_id = (select sup2 from ids) where intern_id = (select c from ids);
create temp table tk (name text, id uuid);
grant all on tk to authenticated;
select tests.at('2026-10-12 07:00+09:30');

-- The new tables are closed to the app.
select ok((select bool_and(c.relrowsecurity) from pg_class c
           where c.oid in ('public.daymark_task_subtasks'::regclass, 'public.daymark_task_comments'::regclass))
          and not has_table_privilege('authenticated', 'public.daymark_task_subtasks', 'select')
          and not has_table_privilege('authenticated', 'public.daymark_task_comments', 'select'),
  'subtasks and comments have RLS on and no grants to the app');

-- Reviewer picks, estimate and checklist validation.
select tests.as_person(tests.supervisor());
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, array[(select a from ids)], null, null, null,
  (select sup2 from ids), null, null)$$, '42501', 'That reviewer can''t review this task.', 'another supervisor can''t review');
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, array[(select a from ids)], null, null, null,
  (select a from ids), null, null)$$, '42501', null, 'an assignee can''t review their own task');
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, array[(select a from ids)], null, null, null,
  null, 0, null)$$, '22023', null, 'the estimate is at least a minute');
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, array[(select a from ids)], null, null, null,
  null, 6001, null)$$, '22023', null, 'the estimate is at most 6,000 minutes');
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, array[(select a from ids)], null, null, null,
  null, null, array(select 'S' || g from generate_series(1, 31) g))$$, '22023', null, 'at most 30 subtasks');
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, array[(select a from ids)], null, null, null,
  null, null, array['Fine', ' '])$$, '22023', null, 'a subtask needs a title');
select throws_ok($$select public.save_task(null, 'T', null, 'low', null, null, null, array[(select a from ids)], null, null, null,
  null, null, array[repeat('x', 141)])$$, '22023', null, 'a subtask is at most 140 characters');
-- The creator reviews their own task.
insert into tk select 'rev', public.save_task(null, 'Market report', null, 'high', null, null, null,
  array[(select a from ids)], null, null, null, tests.supervisor(), 90, array[' Draft ', 'Check']);
-- A peer intern reviews.
insert into tk select 'blk', public.save_task(null, 'Order supplies', null, 'medium', null, null, null,
  array[(select b from ids)], null, null, null, (select a from ids), null, null);
insert into tk select 'solo', public.save_task(null, 'File the forms', null, 'low', null, null, null,
  array[(select b from ids)], null, null, null, null, null, array['Scan']);
insert into tk select 'rev2', public.save_task(null, 'Update the wiki', null, 'low', null, null, null,
  array[(select a from ids)], null, null, null, tests.supervisor(), null, null);
insert into tk select 'rep', public.save_task(null, 'Daily notes', null, 'low', null, null, null,
  array[(select a from ids)], '{1,2,3,4,5}', '2026-10-16', null, null, null, array['Write']);
reset role;
select is((select reviewer_id from public.daymark_tasks where id = (select id from tk where name = 'blk')), (select a from ids),
  'a supervisor can pick a peer intern');

-- The managing supervisor reviews an admin's task.
select tests.as_person((select admin from ids));
select lives_ok($$select public.save_task(null, 'Induction', null, 'low', null, null, null, array[(select a from ids)], null, null,
  null, tests.supervisor(), null, null)$$, 'the managing supervisor can be picked');
reset role;

-- An intern's own task, reviewed by a peer, with C as a teammate.
select tests.as_person((select a from ids));
insert into tk select 'peer', public.save_task(null, 'Team slides', null, 'medium', null, null, null, null, null, null,
  array[(select c from ids)], (select b from ids), null, array['Outline']);
reset role;

insert into tk select name || '_item', i.id from tk join public.daymark_task_items i on i.task_id = tk.id
where tk.name in ('rev', 'blk', 'solo', 'rev2', 'peer');
insert into tk select tk.name || ':' || s.title, s.id from tk join public.daymark_task_subtasks s on s.item_id = tk.id;

-- The checklist is copied into each new copy, in order; repeat copies and later assignees get it too.
select results_eq($$select title, position from public.daymark_task_subtasks where item_id = (select id from tk where name = 'rev_item')
                    order by position$$,
  $$values ('Draft', 1), ('Check', 2)$$, 'the checklist is copied into the copy');
select tests.at('2026-10-13 00:05+09:30');
select private.job_tasks();
select is((select count(*)::int from public.daymark_task_subtasks s join public.daymark_task_items i on i.id = s.item_id
           where i.task_id = (select id from tk where name = 'rep')), 2, 'each repeat copy gets the checklist');
select tests.at('2026-10-12 07:00+09:30');
select tests.as_person(tests.supervisor());
select public.save_task((select id from tk where name = 'rev'), 'Market report', null, 'high', null, null, null,
  (select array[a, b] from ids), null, null, null, tests.supervisor(), 90, array['Draft', 'Check', 'Send']);
reset role;
select is((select count(*)::int from public.daymark_task_subtasks where item_id = (select id from tk where name = 'rev_item')), 2,
  'an edited checklist leaves existing copies alone');
select is((select count(*)::int from public.daymark_task_subtasks s join public.daymark_task_items i on i.id = s.item_id
           where i.task_id = (select id from tk where name = 'rev') and i.person_id = (select b from ids)), 3,
  'a new assignee gets the new checklist');

-- my_tasks: the new columns.
select tests.as_person((select a from ids));
select results_eq($$select reviewer_id, reviewer_name, estimate_minutes, spent_minutes, blocked_reason, subtasks_total,
                           subtasks_done, comments, review_requested_at, to_review, own
                    from public.my_tasks() where item_id = (select id from tk where name = 'rev_item')$$,
  $$select tests.supervisor(), 'Test Supervisor', 90, 0, null::text, 2, 0, 0, null::timestamptz, false, true$$,
  'my_tasks shows the reviewer, estimate, time spent and subtask counts');

-- With a reviewer, done is refused; in review waits for every subtask.
select throws_ok($$select public.set_task_status((select id from tk where name = 'rev_item'), 'done')$$,
  '42501', 'Send it for review. Your reviewer marks it done.', 'with a reviewer, done is refused');
select throws_ok($$select public.set_task_status((select id from tk where name = 'rev_item'), 'in_review')$$,
  '22023', 'Tick all subtasks first.', 'in review waits for every subtask');

-- Subtasks: the person adds, ticks and removes.
insert into tk select 'extra', public.add_subtask((select id from tk where name = 'rev_item'), ' Extra ');
select is((select (x->>'position')::int from jsonb_array_elements(public.task_thread((select id from tk where name = 'rev_item'))->'subtasks') x
            where x->>'id' = (select id::text from tk where name = 'extra')), 3,
  'a new subtask goes last');
select throws_ok($$select public.add_subtask((select id from tk where name = 'rev_item'), ' ')$$, '22023', null,
  'a subtask needs a title');
select public.remove_subtask((select id from tk where name = 'extra'));
select results_eq($$select x->>'title' from jsonb_array_elements(public.task_thread((select id from tk where name = 'rev_item'))->'subtasks') x$$,
  $$values ('Draft'), ('Check')$$, 'a removed subtask leaves the thread');
select throws_ok($$select public.set_subtask((select id from tk where name = 'extra'), true)$$, 'P0002', null,
  'a removed subtask can''t be ticked');
select public.set_subtask((select id from tk where name = 'rev_item:Draft'), true);
select results_eq($$select x->>'done_by_name', (x->>'done_at') is not null
                    from jsonb_array_elements(public.task_thread((select id from tk where name = 'rev_item'))->'subtasks') x$$,
  $$values ('v2.a', true), (null, false)$$, 'ticking records who and when');
select public.set_subtask((select id from tk where name = 'rev_item:Draft'), false);
select is((select subtasks_done from public.my_tasks() where item_id = (select id from tk where name = 'rev_item')), 0,
  'unticking clears it');
reset role;

-- The creator and the reviewer edit subtasks; a teammate, another intern and another supervisor can't.
select tests.as_person(tests.supervisor());
select lives_ok($$select public.remove_subtask(public.add_subtask((select id from tk where name = 'rev_item'), 'By the creator'))$$,
  'the creator adds and removes subtasks');
reset role;
select tests.as_person((select b from ids));
select lives_ok($$select public.set_subtask(public.add_subtask((select id from tk where name = 'peer_item'), 'By the reviewer'), true)$$,
  'the reviewer adds and ticks subtasks');
reset role;
select tests.as_person((select c from ids));
select throws_ok($$select public.add_subtask((select id from tk where name = 'peer_item'), 'X')$$, '42501', null,
  'a teammate can''t change subtasks');
select is(jsonb_array_length(public.task_thread((select id from tk where name = 'peer_item'))->'subtasks'), 2,
  'a teammate reads the thread');
select throws_ok($$select public.add_subtask((select id from tk where name = 'rev_item'), 'X')$$, '42501', null,
  'a non-participant can''t add subtasks');
select throws_ok($$select public.set_subtask((select id from tk where name = 'rev_item:Draft'), true)$$, '42501', null,
  'a non-participant can''t tick subtasks');
select throws_ok($$select public.task_thread((select id from tk where name = 'rev_item'))$$, '42501', null,
  'a non-participant can''t read the thread');
select throws_ok($$select public.add_task_comment((select id from tk where name = 'rev_item'), 'Hi')$$, '42501', null,
  'a non-participant can''t comment');
reset role;
select tests.as_person((select sup2 from ids));
select throws_ok($$select public.task_thread((select id from tk where name = 'peer_item'))$$, '42501', null,
  'another supervisor isn''t a participant');
reset role;

-- Send for review once every subtask is ticked.
select tests.as_person((select a from ids));
select public.set_subtask(id, true) from tk where name in ('rev_item:Draft', 'rev_item:Check');
select public.set_task_status((select id from tk where name = 'rev_item'), 'in_review');
select results_eq($$select status, review_requested_at from public.my_tasks() where item_id = (select id from tk where name = 'rev_item')$$,
  $$values ('in_review', '2026-10-12 07:00+09:30'::timestamptz)$$, 'all ticked, it goes in for review');
reset role;
select is((select count(*)::int from public.daymark_notifications where person_id = tests.supervisor() and kind = 'task'
           and title = 'Task to review' and link = '/clock/tasks'), 1, 'the reviewer is told');

select tests.as_person(tests.supervisor());
select results_eq($$select own, to_review from public.my_tasks()$$, $$values (false, true)$$,
  'my_tasks shows the reviewer the copies waiting for them');
select is((select subtasks_done from public.staff_tasks() where item_id = (select id from tk where name = 'rev_item')), 2,
  'staff_tasks has the new columns');
select throws_ok($$select public.review_task((select id from tk where name = 'rev_item'), false)$$, '22023', null,
  'needs changes requires a comment');
select throws_ok($$select public.review_task((select id from tk where name = 'rev_item'), false, repeat('x', 1001))$$, '22023', null,
  'the comment is at most 1,000 characters');
select public.review_task((select id from tk where name = 'rev_item'), false, 'Add the chart');
reset role;
select is((select status from public.daymark_task_items where id = (select id from tk where name = 'rev_item')), 'in_progress',
  'needs changes sends it back to in progress');
select is((select body from public.daymark_notifications where person_id = (select a from ids) and title = 'Changes needed: Market report'),
  'Add the chart', 'the person is told what to change');

select tests.as_person((select b from ids));
select throws_ok($$select public.review_task((select id from tk where name = 'rev_item'), true)$$, '42501', null,
  'only the reviewer reviews');
reset role;
select tests.as_person(tests.supervisor());
select throws_ok($$select public.review_task((select id from tk where name = 'rev_item'), true)$$, '22023', null,
  'only while in review');
reset role;
select tests.at('2026-10-12 07:10+09:30');
select tests.as_person((select a from ids));
select public.set_task_status((select id from tk where name = 'rev_item'), 'in_review');
reset role;
select tests.as_person(tests.supervisor());
select public.review_task((select id from tk where name = 'rev_item'), true);
reset role;
select results_eq($$select status, done_at is not null, reviewed_by, reviewed_at is not null from public.daymark_task_items
                    where id = (select id from tk where name = 'rev_item')$$,
  $$values ('done', true, tests.supervisor(), true)$$, 'approve makes it done');
select is((select count(*)::int from public.daymark_notifications where person_id = (select a from ids)
           and title = 'Approved: Market report'), 1, 'the person is told it''s approved');
select tests.as_person((select a from ids));
select results_eq($$select x->>'kind', x->>'body', (x->>'mine')::boolean
                    from jsonb_array_elements(public.task_thread((select id from tk where name = 'rev_item'))->'comments') x$$,
  $$values ('changes', 'Add the chart', false), ('approved', 'Approved.', false)$$, 'the review leaves comments, oldest first');
select throws_ok($$select public.add_subtask((select id from tk where name = 'rev_item'), 'Late')$$, '22023', null,
  'a done copy takes no new subtasks');

-- Without a reviewer: done waits for every subtask, and there's no review.
reset role;
select tests.as_person((select b from ids));
select throws_ok($$select public.set_task_status((select id from tk where name = 'solo_item'), 'done')$$, '22023',
  'Tick all subtasks first.', 'without a reviewer, done waits for every subtask');
select throws_ok($$select public.set_task_status((select id from tk where name = 'solo_item'), 'in_review')$$, '22023', null,
  'no reviewer, no review');
select public.set_subtask((select id from tk where name = 'solo_item:Scan'), true);
select public.set_task_status((select id from tk where name = 'solo_item'), 'done');
select is((select status from public.my_tasks() where item_id = (select id from tk where name = 'solo_item')), 'done',
  'then done works');

-- Log time: the person's only.
select throws_ok($$select public.log_task_time((select id from tk where name = 'rev_item'), 30)$$, '42501', null,
  'someone else can''t log time on a copy');
select throws_ok($$select public.log_task_time((select id from tk where name = 'blk_item'), 60001)$$, '22023', null,
  'time spent is at most 60,000 minutes');
select public.log_task_time((select id from tk where name = 'blk_item'), 45);
select is((select spent_minutes from public.my_tasks() where item_id = (select id from tk where name = 'blk_item')), 45,
  'the person logs a running total');
reset role;
select tests.as_person(tests.supervisor());
select throws_ok($$select public.log_task_time((select id from tk where name = 'blk_item'), 50)$$, '42501', null,
  'not even their supervisor');
reset role;

-- Blocked: notifies the creator and the reviewer, not the caller.
select tests.as_person((select c from ids));
select throws_ok($$select public.set_task_blocked((select id from tk where name = 'blk_item'), 'X')$$, '42501', null,
  'another intern can''t block it');
reset role;
select tests.as_person((select b from ids));
select throws_ok($$select public.set_task_blocked((select id from tk where name = 'blk_item'), repeat('x', 301))$$, '22023', null,
  'the reason is at most 300 characters');
select throws_ok($$select public.set_task_blocked((select id from tk where name = 'blk_item'), ' ')$$, '22023', null,
  'blocking needs a reason');
select public.set_task_blocked((select id from tk where name = 'blk_item'), 'Waiting on the card');
select is((select blocked_reason from public.my_tasks() where item_id = (select id from tk where name = 'blk_item')),
  'Waiting on the card', 'the copy is blocked');
reset role;
select set_eq($$select person_id, body from public.daymark_notifications where title = 'Blocked: Order supplies'$$,
  $$values (tests.supervisor(), 'Waiting on the card'), ((select a from ids), 'Waiting on the card')$$,
  'the creator and the reviewer are told why');

-- The 8 am summary: blocked copies and copies waiting for the supervisor's review (rev2).
select tests.as_person((select a from ids));
select public.set_task_status((select id from tk where name = 'rev2_item'), 'in_review');
reset role;
select tests.at('2026-10-13 08:05+09:30');
select private.job_digest();
select is((select body from public.daymark_notifications where kind = 'digest' and person_id = tests.supervisor()),
  '1 task overdue · 1 blocked · 1 waiting for your review.', 'the supervisor''s summary counts blocked and to-review copies');
select is((select body from public.daymark_notifications where kind = 'digest' and person_id = (select admin from ids)),
  '1 task overdue · 1 blocked.', 'an admin''s counts everyone''s blocked copies');
select tests.as_person(tests.supervisor());
select public.set_task_blocked((select id from tk where name = 'blk_item'), null);
reset role;
select results_eq($$select blocked_reason, blocked_at from public.daymark_task_items where id = (select id from tk where name = 'blk_item')$$,
  $$values (null::text, null::timestamptz)$$, 'their supervisor unblocks it');

-- Comments: participants only, notify the person, creator and reviewer once per copy every 10 minutes.
select tests.as_person((select c from ids));
select throws_ok($$select public.add_task_comment((select id from tk where name = 'peer_item'), ' ')$$, '22023', null,
  'a comment needs a body');
select throws_ok($$select public.add_task_comment((select id from tk where name = 'peer_item'), repeat('x', 1001))$$, '22023', null,
  'a comment is at most 1,000 characters');
select throws_ok($$select public.add_task_comment((select id from tk where name = 'peer_item'), 'On it',
  (select id from tk where name = 'rev_item:Draft'))$$, '22023', null,
  'a subtask comment is on one of this copy''s subtasks');
select public.add_task_comment((select id from tk where name = 'peer_item'), 'First pass done',
  (select id from tk where name = 'peer_item:Outline'));
select tests.at('2026-10-13 08:06+09:30');
select public.add_task_comment((select id from tk where name = 'peer_item'), 'And another');
reset role;
select set_eq($$select person_id from public.daymark_notifications where title = 'New comment: Team slides'$$,
  $$select unnest(array[a, b]) from ids$$, 'the person and the reviewer are told once, not the teammate');
select tests.at('2026-10-13 08:16+09:30');
select tests.as_person((select c from ids));
select public.add_task_comment((select id from tk where name = 'peer_item'), 'Later');
reset role;
select is((select count(*)::int from public.daymark_notifications where title = 'New comment: Team slides'), 4,
  'after 10 minutes they''re told again');
select tests.as_person((select a from ids));
select results_eq($$select x->>'author_name', x->>'body', (x->>'subtask_id') is not null, (x->>'mine')::boolean
                    from jsonb_array_elements(public.task_thread((select id from tk where name = 'peer_item'))->'comments') x$$,
  $$values ('v2.c', 'First pass done', true, false), ('v2.c', 'And another', false, false), ('v2.c', 'Later', false, false)$$,
  'the thread lists comments oldest first, with the subtask they''re on');
select is((select comments from public.my_tasks() where item_id = (select id from tk where name = 'peer_item')), 3,
  'my_tasks counts the comments');
reset role;

select * from finish();
rollback;

begin;
select plan(6);

-- Who has reminders on (Dilip, 9 Oct; D40).
create temp table ids as
select tests.create_intern('rs.a@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as a,
       tests.create_intern('rs.b@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as b,
       tests.create_person('rs.admin@test.dev', false, false, true) as admin;
grant select on ids to authenticated;
select tests.without_seed();
insert into public.daymark_push_subscriptions (person_id, endpoint, p256dh, auth, user_agent)
select a, 'https://push.example/rs-a', 'k', 'a', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)' from ids
union all
select b, 'https://push.example/rs-b', 'k', 'a', 'Mozilla/5.0 (Linux; Android 14)' from ids;

select tests.as_person((select a from ids));
select throws_ok($$select * from public.reminder_status()$$, '42501', null, 'an intern can''t see who has reminders on');
reset role;

select tests.as_person((select admin from ids));
select is((select count(*)::int from public.reminder_status()), 2, 'an admin sees every phone owner');
select is((select device from public.reminder_status() where person_id = (select a from ids)), 'iPhone', 'iPhone');
select is((select device from public.reminder_status() where person_id = (select b from ids)), 'Android', 'Android');
reset role;

-- The supervisor sees only their own interns: move B to another supervisor.
update public.daymark_placements set supervisor_id = tests.create_person('rs.sup2@test.dev', false, true, false)
where intern_id = (select b from ids);
select tests.as_person(tests.supervisor());
select is((select count(*)::int from public.reminder_status()), 1, 'a supervisor sees only their own interns');
select is((select person_id from public.reminder_status()), (select a from ids), 'and it is theirs');
reset role;

select * from finish();
rollback;

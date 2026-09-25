begin;
select plan(17);
select tests.without_seed();

insert into public.daymark_sites (id, name, address, latitude, longitude)
values ('00000000-0000-0000-0000-0000000e0046', 'Preview site', 'Test', -12.4785082, 130.9854825);
create temp table ids as
select tests.create_person('pv.admin@test.dev', false, false, true) as admin,
       tests.create_intern('pva@test.dev', '00000000-0000-0000-0000-0000000e0046', '{1}') as a,
       tests.create_intern('pv1@test.dev', '00000000-0000-0000-0000-0000000e0046', '{4}') as f1,
       tests.create_intern('pv2@test.dev', '00000000-0000-0000-0000-0000000e0046', '{4}') as f2,
       tests.create_intern('pv3@test.dev', '00000000-0000-0000-0000-0000000e0046', '{4}') as f3;
grant select on ids to authenticated;
create temp table out (k text primary key, v jsonb);
grant all on out to authenticated;
select tests.at('2026-10-05 10:00+09:30');   -- Mon 5 Oct

-- §8.9 preview = the server verdict before submit, with effects (§11.1 principle 3)
select tests.as_person((select a from ids));
insert into out values ('ok', public.preview_request('{"type":"extra_day","payload":{"date":"2026-10-07","start":"09:00","end":"17:00"},"reason":"Catching up"}'));
insert into out values ('bad', public.preview_request('{"type":"extra_day","payload":{"date":"2026-10-06","start":"09:00","end":"17:00"},"reason":"Too soon"}'));
insert into out values ('full', public.preview_request('{"type":"extra_day","payload":{"date":"2026-10-08","start":"09:00","end":"17:00"},"reason":"Thursday"}'));
reset role;
select ok(((select v from out where k = 'ok') ->> 'ok')::boolean, 'a valid request previews as ok');
select is((select v #>> '{effects,0}' from out where k = 'ok'), 'Adds Wed 7 Oct, 9:00 am–5:00 pm (7h 30m)', 'the effect line');
select is((select v #>> '{capacity,0,label}' from out where k = 'ok'), 'office 0/3 → 1/3', 'the office count before and after');
select ok(not ((select v from out where k = 'bad') ->> 'ok')::boolean, 'C4: less than 24 hours'' notice fails the preview');
select ok(((select v from out where k = 'bad') ->> 'message') is not null, 'with the reason');
select ok(((select v from out where k = 'full') ->> 'needs_extra_spot')::boolean, 'a 4th on Thursday needs an extra spot');
select is((select v #>> '{capacity,0,label}' from out where k = 'full'), 'Full — request an extra spot (needs admin approval)',
  'interns never see 4/3');
select is((select v #>> '{capacity,0,after}' from out where k = 'full')::int, 3, 'interns see at most 3');

-- Staff preview an existing request with the real count
select tests.as_person((select a from ids));
insert into out values ('req', public.create_request('extra_day', '{"date":"2026-10-08","start":"09:00","end":"17:00"}', 'Thursday'));
reset role;
select tests.as_person(tests.supervisor());
insert into out values ('staff', public.preview_request(jsonb_build_object('id', (select v ->> 'id' from out where k = 'req'))));
reset role;
select is((select v #>> '{capacity,0,label}' from out where k = 'staff'), 'office 3/3 → 4/3 (extra spot)', 'staff see the extra spot');

-- Review §2.7 supervisor confirmation
select tests.at('2026-10-05 09:05+09:30');
select tests.as_person((select a from ids));
insert into out values ('att', public.request_supervisor_confirmation('shift_in'));
reset role;
select is((select source || '/' || coalesce(confirmed_at::text, 'unconfirmed') from public.daymark_punches
           where id = (select (v ->> 'punch_id')::uuid from out where k = 'att')), 'supervisor/unconfirmed',
  'the punch waits for the supervisor');
select ok(exists (select 1 from public.daymark_notifications where person_id = tests.supervisor() and kind = 'attendance'),
  'the supervisor is asked to confirm');
select tests.as_person(tests.supervisor());
select public.decide_request((select (v #>> '{request,id}')::uuid from out where k = 'att'), 'approve', null, null);
reset role;
select ok((select confirmed_at is not null and confirmed_by = tests.supervisor() from public.daymark_punches
           where id = (select (v ->> 'punch_id')::uuid from out where k = 'att')), 'confirmed the same day');

-- §8.10 escalation after 72 h, once
select tests.at('2026-10-08 09:59+09:30');
select is((private.job_escalate() ->> 'escalated')::int, 0, 'not yet at 72 hours');
select tests.at('2026-10-08 10:01+09:30');
select is((private.job_escalate() ->> 'escalated')::int, 1, 'escalated after 72 hours');
select is((private.job_escalate() ->> 'escalated')::int, 0, 'only once');
select is((select count(*)::int from public.daymark_notifications where person_id = (select admin from ids) and kind = 'escalated'), 1,
  'the admin is told once');
select tests.as_person((select a from ids));
select throws_ok($$select public.run_job('escalate')$$, '42501', null, 'only admins run jobs');
reset role;

select * from finish();
rollback;

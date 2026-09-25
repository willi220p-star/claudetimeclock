begin;
select plan(11);

insert into public.daymark_sites (id, name, address, latitude, longitude)
values ('00000000-0000-0000-0000-0000000e0047', 'Catch-up site', 'Test', -12.4785082, 130.9854825);
-- Mondays 9:00–1:00 (240 min, no break) from 28 Sep; nothing clocked → two no-shows by Wed 7 Oct.
create temp table ids as
select tests.create_intern('cu@test.dev', '00000000-0000-0000-0000-0000000e0047', '{1}', '2026-09-28', '2026-10-30', '09:00', '13:00') as i,
       tests.create_intern('cf1@test.dev', '00000000-0000-0000-0000-0000000e0047', '{2}', '2026-09-28', '2026-10-30') as f1,
       tests.create_intern('cf2@test.dev', '00000000-0000-0000-0000-0000000e0047', '{2}', '2026-09-28', '2026-10-30') as f2,
       tests.create_intern('cf3@test.dev', '00000000-0000-0000-0000-0000000e0047', '{2}', '2026-09-28', '2026-10-30') as f3,
       tests.create_intern('cok@test.dev') as ok_intern;
grant select on ids to authenticated;
create temp table out (k text primary key, v jsonb);
grant all on out to authenticated;
select tests.at('2026-10-07 10:00+09:30');

select tests.as_person((select i from ids));
insert into out values ('plan', public.catch_up_options(private.current_placement((select i from ids))));
reset role;
select is(((select v from out where k = 'plan') ->> 'owed_minutes')::int, 480, 'two missed Mondays owe 8h');

-- Option A: longer upcoming Mondays (from Mon 12 Oct, ≥ 24 h away), end later first
select is((select v #>> '{a,requests,0,type}' from out where k = 'plan'), 'shift_change', 'option A changes day lengths');
select is((select v #>> '{a,requests,0,payload,end}' from out where k = 'plan'), '19:00', 'extends the end first, up to 7:00 pm');
select is(((select v from out where k = 'plan') #>> '{a,covers_minutes}')::int, 480, 'option A covers the balance');
select ok(((select v from out where k = 'plan') #>> '{a,fully_covers}')::boolean, 'and says so');

-- Option B: extra days at the usual times, skipping full Tuesdays (3/3) — never a 4th spot
select is((select v #>> '{b,requests,0,payload,date}' from out where k = 'plan'), '2026-10-09', 'option B starts Friday: Thursday 9:00 am is under 24 hours away');
select ok(not exists (select 1 from out, jsonb_array_elements(v -> 'b' -> 'requests') r
                      where extract(isodow from (r #>> '{payload,date}')::date) = 2), 'never proposes a full Tuesday');
select is(((select v from out where k = 'plan') #>> '{b,covers_minutes}')::int, 480, 'two extra 4-hour days');

-- Submit B: recomputed on the server, all requests filed together
select tests.as_person((select i from ids));
insert into out values ('sent', public.submit_catch_up(private.current_placement((select i from ids)), 'b'));
reset role;
select is((select count(*)::int from public.daymark_requests where intern_id = (select i from ids) and type = 'extra_day'
           and status = 'pending_supervisor'), 2, 'option B files two extra-day requests');

-- Nobody else can submit someone's plan; nothing owed means nothing proposed
select tests.as_person(tests.supervisor());
select throws_ok($$select public.submit_catch_up(private.current_placement((select i from ids)), 'a')$$, '42501', null,
  'only the intern submits their plan');
reset role;
select tests.at('2026-09-28 08:00+09:30');
select tests.as_person((select ok_intern from ids));
select is((public.catch_up_options(private.current_placement((select ok_intern from ids))) -> 'a' -> 'requests'), '[]'::jsonb,
  'no balance, no plan');
reset role;

select * from finish();
rollback;

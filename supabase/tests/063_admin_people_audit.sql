begin;
select plan(27);

-- Phase 7: people directory and audit search (§6, §11.3, §14).
create temp table ids as
select tests.create_person('aud.admin@test.dev', false, false, true, 'Ada Admin') as admin,
       tests.create_person('aud.sup@test.dev', false, true, false, 'Sid Supervisor') as sup,
       tests.create_intern('aud.live@test.dev') as live,
       tests.create_intern('aud.done@test.dev') as done,
       tests.create_person('aud.off@test.dev') as off;
grant select on ids to authenticated;
create temp table res (k text primary key, v jsonb);
grant all on res to authenticated;
update public.daymark_placements set status = 'completed', ended_on = '2026-10-30' where intern_id = (select done from ids);
update public.daymark_profiles set active = false where id = (select off from ids);
update public.daymark_profiles set must_change_password = true where id = (select live from ids);
update auth.users set last_sign_in_at = '2026-09-30 08:00+09:30' where id = (select live from ids);
select tests.at('2026-10-01 10:00+09:30');

-- people_directory: admin only
select tests.as_person((select live from ids));
select throws_ok($$select * from public.people_directory()$$, '42501', null, 'an intern cannot list people');
reset role;
select tests.as_person((select sup from ids));
select throws_ok($$select * from public.people_directory()$$, '42501', null, 'a supervisor cannot list people');
reset role;

select tests.as_person((select admin from ids));
create temp table dir as select * from public.people_directory();
reset role;
select is((select count(*)::int from dir), (select count(*)::int from public.daymark_profiles), 'every person is listed');
select is((select jsonb_build_array(email, is_intern, is_supervisor, is_admin, active, must_change_password, last_sign_in_at,
                                    placement_id, placement_status)
           from dir where id = (select live from ids)),
  jsonb_build_array('aud.live@test.dev', true, false, false, true, true, '2026-09-30 08:00+09:30'::timestamptz,
                    (select private.current_placement(live) from ids), 'active'),
  'an intern shows their sign-in email, roles, flags, last sign-in and live placement');
select ok((select placement_id is null and placement_status is null from dir where id = (select done from ids)),
  'an ended placement is not live');
select ok((select not active and placement_id is null from dir where id = (select off from ids)),
  'an inactive person is listed as inactive');
select is((select display_name || ' ' || email || ' ' || is_supervisor from dir where id = (select sup from ids)),
  'Sid Supervisor aud.sup@test.dev true', 'a supervisor shows their name and role');
-- §14 no password can be read by anyone
select is((select array_agg(a) from pg_proc p, unnest(p.proargnames) a
           where p.oid in ('public.people_directory()'::regprocedure, 'private.people_directory()'::regprocedure)
             and a ~* 'pass|hash|crypt|salt|token|secret' and a <> 'must_change_password'),
  null, 'no password, hash or token column');
select is((select array_agg(k order by k) from (select jsonb_object_keys(to_jsonb(d)) k from dir d where id = (select live from ids)) x),
  array['active', 'created_at', 'display_name', 'email', 'id', 'is_admin', 'is_intern', 'is_supervisor', 'last_sign_in_at',
        'must_change_password', 'placement_id', 'placement_status'],
  'the directory has exactly these columns');

-- audit_search: seed entries in known order
insert into public.daymark_audit_log (actor_id, action, table_name, row_id, before, after, at)
select (select admin from ids), 'test_a', 'daymark_sites', 's' || g, jsonb_build_object('n', g - 1), jsonb_build_object('n', g),
       '2026-10-01 00:00+00'::timestamptz + make_interval(hours => g)
from generate_series(1, 5) g;
insert into public.daymark_audit_log (actor_id, action, table_name, row_id, before, after, at)
select (select sup from ids), 'test_b', 'daymark_settings', '1', null, jsonb_build_object('n', g),
       '2026-10-02 00:00+00'::timestamptz + make_interval(hours => g)
from generate_series(1, 3) g;

select tests.as_person((select live from ids));
select throws_ok($$select public.audit_search()$$, '42501', null, 'an intern cannot search the audit log');
reset role;
select tests.as_person((select sup from ids));
select throws_ok($$select public.audit_search()$$, '42501', null, 'a supervisor cannot search the audit log');
reset role;

-- Keyset pagination, newest first
select tests.as_person((select admin from ids));
insert into res select 'p1', public.audit_search(action => 'test_a', page_size => 2);
insert into res select 'p2', public.audit_search(action => 'test_a', page_size => 2,
  before_id => (select (v ->> 'next_before_id')::bigint from res where k = 'p1'));
insert into res select 'p3', public.audit_search(action => 'test_a', page_size => 2,
  before_id => (select (v ->> 'next_before_id')::bigint from res where k = 'p2'));
reset role;
select is((select array_agg(x ->> 'row_id' order by n) from res, jsonb_array_elements(v -> 'rows') with ordinality e(x, n) where k = 'p1'),
  array['s5', 's4'], 'page 1 is the newest two');
select is((select array_agg(x ->> 'row_id' order by n) from res, jsonb_array_elements(v -> 'rows') with ordinality e(x, n) where k = 'p2'),
  array['s3', 's2'], 'page 2 carries on from the cursor');
select is((select array_agg(x ->> 'row_id' order by n) from res, jsonb_array_elements(v -> 'rows') with ordinality e(x, n) where k = 'p3'),
  array['s1'], 'page 3 has the oldest');
select is((select v -> 'next_before_id' from res where k = 'p3'), 'null'::jsonb, 'a short page has no next cursor');
select is((select v -> 'next_before_id' from res where k = 'p1'), (select v -> 'rows' -> 1 -> 'id' from res where k = 'p1'),
  'a full page gives the last id as the next cursor');
select is((select (v -> 'rows' -> 0) - 'id' - 'at' from res where k = 'p1'),
  jsonb_build_object('actor_id', (select admin from ids), 'actor_name', 'Ada Admin', 'action', 'test_a',
    'table_name', 'daymark_sites', 'row_id', 's5', 'before', '{"n":4}'::jsonb, 'after', '{"n":5}'::jsonb),
  'an entry has the actor''s name and the before and after');

-- Filters
select tests.as_person((select admin from ids));
select is((select array_agg(distinct x ->> 'action') from jsonb_array_elements(public.audit_search(table_name => 'daymark_settings') -> 'rows') x),
  array['test_b'], 'filter by table');
select is(jsonb_array_length(public.audit_search(actor => (select sup from ids)) -> 'rows'), 3, 'filter by actor');
select is((select array_agg(x ->> 'row_id') from jsonb_array_elements(public.audit_search(action => 'test_a',
            from_ts => '2026-10-01 02:00+00', to_ts => '2026-10-01 04:00+00') -> 'rows') x),
  array['s3', 's2'], 'filter by time: from is inclusive, to is exclusive');
select is(jsonb_array_length(public.audit_search(action => 'nothing') -> 'rows'), 0, 'no match is an empty page');
select is(jsonb_array_length(public.audit_search() -> 'rows'), least(50, (select count(*)::int from public.daymark_audit_log)),
  'the default page is 50 entries');
select throws_ok($$select public.audit_search(page_size => 0)$$,
  '22023', 'Show between 1 and 200 entries per page.', 'the page size is at least 1');
select throws_ok($$select public.audit_search(page_size => 201)$$,
  '22023', 'Show between 1 and 200 entries per page.', 'the page size is at most 200');
select throws_ok($$select public.audit_search(from_ts => '2026-10-02', to_ts => '2026-10-01')$$,
  '22023', 'The start of the range must be before its end.', 'the time range is checked');
reset role;

-- anon can run none of it
select ok(not has_function_privilege('anon', 'public.people_directory()', 'execute')
      and not has_function_privilege('anon', 'private.people_directory()', 'execute')
      and not has_function_privilege('anon', 'public.audit_search(text, text, uuid, timestamptz, timestamptz, bigint, integer)', 'execute')
      and not has_function_privilege('anon', 'private.audit_search(text, text, uuid, timestamptz, timestamptz, bigint, integer)', 'execute'),
  'anon cannot execute the people or audit RPCs');
select tests.as_anon();
select throws_ok($$select * from public.people_directory()$$, '42501', null, 'anon cannot list people');
reset role;

select * from finish();
rollback;

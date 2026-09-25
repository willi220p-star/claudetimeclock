begin;
select plan(12);

-- Two interns on the same days; only the first ended 31 days ago.
create temp table ids as
select tests.create_intern('gone@test.dev', null, '{1}', '2026-09-28', '2026-10-30') as gone,
       tests.create_intern('stay@test.dev', null, '{1,2,3,4,5}', '2026-09-28', '2026-12-18') as stay;
grant select on ids to authenticated, service_role;
select tests.consent_all(gone) from ids;
select tests.consent_all(stay) from ids;
select tests.clock((select gone from ids), 'shift_in', '2026-09-28 09:00+09:30');
select tests.clock((select gone from ids), 'shift_out', '2026-09-28 17:00+09:30');
select tests.clock((select stay from ids), 'shift_in', '2026-09-28 09:00+09:30');
select tests.clock((select stay from ids), 'shift_out', '2026-09-28 17:00+09:30');
select tests.at('2026-09-29 10:00+09:30');
select tests.as_person((select gone from ids));
select public.save_work_log('2026-09-28', 'Set up the client research folder.');
select public.create_request('extra_day', '{"date":"2026-10-02","start":"09:00","end":"13:00"}', 'Extra hours');
reset role;
select tests.as_person(tests.supervisor());
select public.confirm_completion(private.current_placement((select gone from ids)), 'Done');
reset role;
-- 31 days after it ended
select tests.at('2026-10-30 10:00+09:30');

select ok(exists (select 1 from public.retention_due() where intern_id = (select gone from ids)), 'the ended intern is due');
select ok(not exists (select 1 from public.retention_due() where intern_id = (select stay from ids)), 'the active intern is not');

select tests.as_person((select gone from ids));
select throws_ok($$select public.purge_intern((select gone from ids), 0)$$, '42501', null, 'signed-in people cannot purge');
reset role;

set local role service_role;
create temp table counts as select public.purge_intern((select gone from ids), 3) as j;
reset role;

select ok((select (j ->> 'punches')::int = 2 and (j ->> 'placements')::int = 1 and (j ->> 'profiles')::int = 1 from counts),
  'rows were deleted and counted');
select is((select count(*)::int from public.daymark_punches where user_id = (select gone from ids)), 0, 'no punches left');
select is((select count(*)::int from public.daymark_consent_records where person_id = (select gone from ids)), 0, 'no consent records left');
select is((select count(*)::int from public.daymark_placements where intern_id = (select gone from ids)), 0, 'no placement left');
select is((select count(*)::int from public.daymark_audit_log where actor_id = (select gone from ids) or row_id = (select gone from ids)::text), 0,
  'no audit rows about them left');
select ok(exists (select 1 from public.daymark_audit_log where action = 'retention_purge'
                  and row_id = encode(extensions.digest((select gone from ids)::text, 'sha256'), 'hex')
                  and (after ->> 'storage_objects')::int = 3), 'one audit row with a hash and the counts');
select ok(not exists (select 1 from public.daymark_audit_log where action = 'retention_purge'
                      and (after::text ilike '%gone@test.dev%' or after::text ilike '%gone%')), 'without personal data');
select is((select count(*)::int from public.daymark_punches where user_id = (select stay from ids)), 2, 'the other intern is untouched');

set local role service_role;
select throws_ok($$select public.purge_intern((select stay from ids), 0)$$, '22023', 'This intern is not due for deletion.',
  'an intern who isn''t due cannot be purged');
reset role;

select * from finish();
rollback;

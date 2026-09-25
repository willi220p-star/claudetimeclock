begin;
select plan(16);

create temp table ids as
select tests.create_person('ca@test.dev') as intern_a,
       tests.create_person('cb@test.dev') as intern_b;
grant select on ids to authenticated;

select ok(exists (select 1 from public.daymark_notices where version = '1.0'), 'collection notice v1.0 exists');
select is((select sha256 from public.daymark_notices where version = '1.0'),
          (select encode(extensions.digest(body, 'sha256'), 'hex') from public.daymark_notices where version = '1.0'),
          'the notice hash is the SHA-256 of its exact text');

select tests.at('2026-10-14 08:30:00+09:30');
select tests.as_person((select intern_a from ids));
select ok(not (public.my_consent() ->> 'notice_acknowledged')::boolean, 'nothing acknowledged yet');
select ok(not private.has_consent((select intern_a from ids), 'location'), 'no location consent yet');
select public.record_consent('location', 'granted');
select ok(not private.has_consent((select intern_a from ids), 'location'), 'consent needs the current notice acknowledged');
select public.record_consent('collection_notice', 'acknowledged');
select ok(private.has_consent((select intern_a from ids), 'location'), 'location consent granted');
select is((select recorded_at from public.daymark_consent_records where person_id = (select intern_a from ids) order by id desc limit 1),
  '2026-10-14 08:30:00+09:30'::timestamptz, 'recorded with the server clock');
select public.record_consent('location', 'withdrawn');
select ok(not private.has_consent((select intern_a from ids), 'location'), 'withdrawal takes effect');
select throws_ok($$select public.record_consent('location', 'acknowledged')$$, '22023', null, 'decisions fit the purpose');
select throws_ok($$select public.record_consent('medical_certificate', 'granted')$$, '22023', null,
  'a certificate consent names its leave request');
select throws_ok($$insert into public.daymark_consent_records (person_id, purpose, decision, notice_version, notice_sha256, recorded_by)
                   values ((select intern_a from ids), 'selfie', 'granted', '1.0', 'x', (select intern_a from ids))$$,
  '42501', null, 'consent is recorded only through the RPC');
reset role;

select tests.as_person((select intern_b from ids));
select is((select count(*)::int from public.daymark_consent_records where person_id = (select intern_a from ids)), 0,
  'another intern cannot see my consent records');
reset role;

select throws_ok($$update public.daymark_consent_records set decision = 'granted'$$, 'P0001', null, 'consent records are append-only');
select throws_ok($$delete from public.daymark_consent_records$$, 'P0001', null, 'consent records cannot be deleted');

-- A new notice version needs a fresh acknowledgement (review §2.4)
select tests.as_person((select intern_a from ids));
select public.record_consent('selfie', 'granted');
reset role;
select ok(private.has_consent((select intern_a from ids), 'selfie'), 'selfie consent under v1.0');
insert into public.daymark_notices (version, title, body) values ('1.1', 'Test notice', 'Changed text');
update public.daymark_settings set notice_version = '1.1';
select ok(not private.has_consent((select intern_a from ids), 'selfie'), 'a new notice version needs re-acknowledgement');

select * from finish();
rollback;

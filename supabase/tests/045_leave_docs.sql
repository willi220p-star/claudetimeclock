-- Leave certificates (§9.2, §14 storage, review §2.3 and rule 20): private bucket, owner upload
-- under their own folder, owner / their supervisor / admin read, consent per request, or
-- "sighted in person" instead of a file.
begin;
select plan(20);

create temp table ids as
select tests.create_person('ld.admin@test.dev', false, false, true) as admin,
       tests.supervisor() as sup,
       tests.create_person('ld.sup2@test.dev', false, true, false) as sup2,
       tests.create_intern('lda@test.dev') as a,
       tests.create_intern('ldb@test.dev') as b;
grant select on ids to authenticated;
create temp table req (k text primary key, id uuid);
grant all on req to authenticated;
create temp table obj (k text primary key, name text);
insert into obj select 'a', a || '/' || gen_random_uuid() || '.pdf' from ids;
grant all on obj to authenticated;
select tests.at('2026-10-05 10:00+09:30');

select is((select public::text || ' ' || file_size_limit || ' ' || array_to_string(allowed_mime_types, ',')
           from storage.buckets where id = 'daymark-leave-docs'),
  'false 5242880 application/pdf,image/jpeg,image/png', 'the bucket is private, 5 MB, PDF/JPG/PNG');

-- Upload: only the owner, only under their own folder, only a uuid file name with a known type
select tests.as_person((select a from ids));
select lives_ok($$insert into storage.objects (bucket_id, name, owner, owner_id)
  values ('daymark-leave-docs', (select name from obj where k = 'a'), (select a from ids), (select a from ids)::text)$$,
  'the intern uploads to their own folder');
select throws_ok($$insert into storage.objects (bucket_id, name, owner, owner_id)
  values ('daymark-leave-docs', (select b from ids) || '/' || gen_random_uuid() || '.pdf', (select a from ids), (select a from ids)::text)$$,
  '42501', null, 'nobody uploads into someone else''s folder');
select throws_ok($$insert into storage.objects (bucket_id, name, owner, owner_id)
  values ('daymark-leave-docs', (select a from ids) || '/' || gen_random_uuid() || '.exe', (select a from ids), (select a from ids)::text)$$,
  '42501', null, 'only PDF, JPG and PNG names');
update storage.objects set metadata = '{"changed":true}' where bucket_id = 'daymark-leave-docs';
reset role;
select is((select count(*)::int from storage.objects where bucket_id = 'daymark-leave-docs' and metadata ? 'changed'), 0,
  'uploads cannot be changed afterwards');

-- Read: owner, their supervisor, admin; nobody else
select tests.as_person((select a from ids));
select is((select count(*)::int from storage.objects where bucket_id = 'daymark-leave-docs'), 1, 'the owner reads it');
reset role;
select tests.as_person((select b from ids));
select is((select count(*)::int from storage.objects where bucket_id = 'daymark-leave-docs'), 0, 'another intern cannot');
reset role;
select tests.as_person((select sup from ids));
select is((select count(*)::int from storage.objects where bucket_id = 'daymark-leave-docs'), 1, 'their supervisor reads it');
reset role;
select tests.as_person((select sup2 from ids));
select is((select count(*)::int from storage.objects where bucket_id = 'daymark-leave-docs'), 0, 'another supervisor cannot');
reset role;
select tests.as_person((select admin from ids));
select is((select count(*)::int from storage.objects where bucket_id = 'daymark-leave-docs'), 1, 'the admin reads it');
reset role;

-- Attach to a leave request: needs consent for this request (review §2.3)
insert into req values ('lv', tests.ask((select a from ids), 'leave', '{"dates":["2026-10-07"],"kind":"sick"}', 'Flu, staying home'));
select tests.as_person((select a from ids));
select throws_ok(format($$select public.attach_leave_certificate(%L, %L)$$, (select id from req where k = 'lv'), (select name from obj where k = 'a')),
  'P0001', 'Agree to how we store your certificate before adding it.', 'no certificate without consent');
select public.record_consent('medical_certificate', 'granted', (select id from req where k = 'lv'));
select throws_ok(format($$select public.attach_leave_certificate(%L, %L)$$, (select id from req where k = 'lv'),
  (select a from ids) || '/' || gen_random_uuid() || '.pdf'),
  'P0001', 'We didn''t get your certificate. Upload it again.', 'the file must exist');
select throws_ok(format($$select public.attach_leave_certificate(%L, %L)$$, (select id from req where k = 'lv'),
  (select b from ids) || '/' || gen_random_uuid() || '.pdf'),
  '22023', 'That file isn''t one of your uploads.', 'only your own files');
select is(public.attach_leave_certificate((select id from req where k = 'lv'), (select name from obj where k = 'a')) ->> 'attachment_path',
  (select name from obj where k = 'a'), 'the certificate is attached');
reset role;
select ok(exists (select 1 from public.daymark_audit_log where action = 'attach_certificate'), 'attaching is audited');
select tests.as_person((select b from ids));
select throws_ok(format($$select public.attach_leave_certificate(%L, %L)$$, (select id from req where k = 'lv'), (select name from obj where k = 'a')),
  '42501', 'You can only add a certificate to your own leave request.', 'not to someone else''s request');
reset role;

-- Or the supervisor sights it in person (review rule 20)
select tests.as_person((select a from ids));
select throws_ok(format($$select public.mark_certificate_sighted(%L)$$, (select id from req where k = 'lv')),
  '42501', 'Your supervisor ticks this after seeing your certificate.', 'the intern cannot tick it');
reset role;
select tests.as_person((select sup2 from ids));
select throws_ok(format($$select public.mark_certificate_sighted(%L)$$, (select id from req where k = 'lv')),
  '22023', 'That request doesn''t exist.', 'another supervisor cannot tick it');
reset role;
select tests.as_person((select sup from ids));
select ok((public.mark_certificate_sighted((select id from req where k = 'lv')) ->> 'certificate_sighted')::boolean,
  'their supervisor ticks "certificate sighted"');
reset role;
select ok(exists (select 1 from public.daymark_audit_log where action = 'sight_certificate'), 'sighting is audited');

select * from finish();
rollback;

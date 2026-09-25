begin;
select plan(20);

select has_column('public', 'daymark_profiles', 'is_intern', 'is_intern flag');
select has_column('public', 'daymark_profiles', 'is_supervisor', 'is_supervisor flag');
select has_column('public', 'daymark_profiles', 'is_admin', 'is_admin flag');
select has_column('public', 'daymark_profiles', 'must_change_password', 'must_change_password flag');
select hasnt_column('public', 'daymark_profiles', 'role', 'the single role column is gone');

create temp table ids as
select tests.create_person('a1@test.dev', false, false, true) as admin_a,
       tests.create_person('i1@test.dev') as intern_i;
grant select on ids to authenticated;

-- private.is_admin()
select tests.as_person((select admin_a from ids));
select ok(private.is_admin(), 'an active admin is an admin');
reset role;
select tests.as_person((select intern_i from ids));
select ok(not private.is_admin(), 'an intern is not an admin');
reset role;

-- Last active admin guard (§6). Make admin_a the only active admin first.
update public.daymark_profiles set is_admin = false where is_admin and id <> (select admin_a from ids);
select throws_ok($$update public.daymark_profiles set is_admin = false where id = (select admin_a from ids)$$,
  'P0001', 'Keep at least one active admin. Make someone else an admin first.', 'last admin cannot be demoted');
select throws_ok($$update public.daymark_profiles set active = false where id = (select admin_a from ids)$$,
  'P0001', null, 'last admin cannot be deactivated');
select throws_ok($$delete from auth.users where id = (select admin_a from ids)$$,
  'P0001', null, 'last admin cannot be deleted');
update public.daymark_profiles set is_admin = true where id = (select intern_i from ids);
select lives_ok($$update public.daymark_profiles set is_admin = false where id = (select admin_a from ids)$$,
  'an admin can be demoted while another active admin exists');
update public.daymark_profiles set is_admin = true where id = (select admin_a from ids);
update public.daymark_profiles set is_admin = false where id = (select intern_i from ids);

-- Profiles are not directly writable by API roles
select tests.as_person((select admin_a from ids));
select throws_ok($$update public.daymark_profiles set display_name = 'x' where id = (select intern_i from ids)$$,
  '42501', null, 'profiles change only through RPCs');
select is((select count(*)::int from public.daymark_profiles where id = (select intern_i from ids)), 1,
  'admins read every profile');
reset role;
select tests.as_person((select intern_i from ids));
select is((select count(*)::int from public.daymark_profiles where id = (select admin_a from ids)), 0,
  'an intern cannot read another profile');
reset role;

-- Audit log is append-only (§14)
select lives_ok($$select private.audit('test', 'daymark_profiles', 'x', null, '{"a":1}')$$, 'private.audit writes a row');
select throws_ok($$update public.daymark_audit_log set action = 'y'$$, 'P0001', null, 'audit rows cannot be updated');
select throws_ok($$delete from public.daymark_audit_log$$, 'P0001', null, 'audit rows cannot be deleted');
select tests.as_person((select intern_i from ids));
select throws_ok($$insert into public.daymark_audit_log (action, table_name) values ('x', 'y')$$,
  '42501', null, 'API roles cannot write the audit log');
select is((select count(*)::int from public.daymark_audit_log), 0, 'interns cannot read the audit log');
reset role;
select tests.as_person((select admin_a from ids));
select ok((select count(*) from public.daymark_audit_log where action = 'test') = 1, 'admins read the audit log');
reset role;

select * from finish();
rollback;

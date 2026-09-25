begin;
select plan(27);

-- §14 password leaks removed
select hasnt_table('public', 'daymark_login_secrets', 'the plain-text password table is gone');
select hasnt_function('public', 'sign_in_email', 'sign_in_email is gone');
select hasnt_function('public', 'recovery_email_ready', 'recovery_email_ready is gone');
select hasnt_function('public', 'save_own_password', 'save_own_password is gone');
select hasnt_function('public', 'reset_password_by_email', 'reset_password_by_email is gone');
select hasnt_function('public', 'create_staff_login', 'create_staff_login is gone');
select hasnt_function('public', 'set_staff_password', 'set_staff_password is gone');
select hasnt_function('public', 'delete_staff_login', 'delete_staff_login is gone (D12)');
select hasnt_function('public', 'set_login_email', 'set_login_email is gone');
select is((select count(*)::int from information_schema.columns
           where table_schema in ('public', 'private') and column_name ilike '%password%'
             and column_name <> 'must_change_password'), 0, 'no column can hold a password');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon cannot use the private schema');

create temp table ids as
select tests.create_person('boss@test.dev', false, false, true) as admin_a,
       tests.create_person('int@test.dev') as intern_i;
grant select on ids to authenticated;

-- create_person
select tests.as_person((select intern_i from ids));
select throws_ok($$select public.create_person('X Y', 'xy@test.dev', 'Password-12345', true, false, false)$$,
  '42501', null, 'only an admin adds people');
reset role;

select tests.as_person((select admin_a from ids));
select lives_ok($$select public.create_person('Sam Lee', 'sam@one.dev', 'Password-12345', true, false, false)$$,
  'an admin adds an intern');
select throws_ok($$select public.create_person('Sam Two', 'not-an-email', 'Password-12345', true, false, false)$$,
  '22023', 'Enter a real email address.', 'email is validated');
select throws_ok($$select public.create_person('Sam Two', 'sam2@one.dev', 'short-pass1', true, false, false)$$,
  '22023', 'Use a password between 12 and 72 characters.', 'password needs 12+ characters (D11)');
select throws_ok($$select public.create_person('Sam Again', 'SAM@one.dev', 'Password-12345', true, false, false)$$,
  '23505', null, 'an email is used once');
select throws_ok($$select public.create_person('Nobody', 'nobody@one.dev', 'Password-12345', false, false, false)$$,
  '22023', 'Give the person at least one role.', 'a person needs a role');
select lives_ok($$select public.create_person('Sam Lee', 'sam@two.dev', 'Password-12345', true, false, false)$$,
  'a second Sam gets a different login id');
reset role;

select ok((select must_change_password and is_intern and not is_admin from public.daymark_profiles
           where contact_email = 'sam@one.dev'), 'new people must change their password');
select is((select count(distinct login_id)::int from public.daymark_profiles where contact_email like 'sam@%'), 2,
  'login ids stay unique');

-- set_person_password: write-only, forces a change, audited without the password
select tests.as_person((select intern_i from ids));
select throws_ok($$select public.set_person_password((select admin_a from ids), 'Password-99999')$$,
  '42501', null, 'only an admin sets a password');
reset role;
update public.daymark_profiles set must_change_password = false where id = (select intern_i from ids);
select tests.as_person((select admin_a from ids));
select public.set_person_password((select intern_i from ids), 'Password-99999');
reset role;
select ok((select must_change_password from public.daymark_profiles where id = (select intern_i from ids)),
  'an admin-set password must be changed at next sign-in');
select ok(not exists (select 1 from public.daymark_audit_log
                      where action = 'set_password' and (after::text ilike '%Password-99999%' or before::text ilike '%Password-99999%')),
  'the audit log never contains the password');

-- The person's own change clears the flag
update auth.users set encrypted_password = extensions.crypt('Password-mine-1', extensions.gen_salt('bf', 4))
where id = (select intern_i from ids);
select ok(not (select must_change_password from public.daymark_profiles where id = (select intern_i from ids)),
  'changing your own password clears must_change_password');

-- set_person_access and set_person_email
select tests.as_person((select admin_a from ids));
select public.set_person_access((select intern_i from ids), true, true, false, true);
select public.set_person_email((select intern_i from ids), 'new.mail@test.dev');
reset role;
select ok((select is_supervisor from public.daymark_profiles where id = (select intern_i from ids)), 'roles updated');
select ok(exists (select 1 from public.daymark_audit_log where action = 'set_access' and row_id = (select intern_i from ids)::text),
  'role changes are audited');
select is((select email from auth.users where id = (select intern_i from ids))::text, 'new.mail@test.dev',
  'sign-in email updated');

select * from finish();
rollback;

-- Create a staff login in one database call.
-- The privileged work stays in private. The public wrapper is invoker-only
-- so PostgREST can reach it without exposing a security-definer function.

create or replace function private.create_staff_login(
  display_name text,
  login_id text,
  password text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text := btrim(display_name);
  clean_login text := lower(btrim(login_id));
  new_id uuid := gen_random_uuid();
  staff_email text;
  created public.daymark_profiles%rowtype;
begin
  if not private.is_admin() then
    raise exception 'Only an active admin can add people'
      using errcode = '42501';
  end if;

  if clean_login !~ '^[a-z0-9][a-z0-9._-]{1,31}$' then
    raise exception 'Use 2–32 letters, numbers, dots, dashes, or underscores.'
      using errcode = '22023';
  end if;

  if char_length(clean_name) < 1 or char_length(clean_name) > 80 then
    raise exception 'Enter a name up to 80 characters.'
      using errcode = '22023';
  end if;

  if char_length(password) < 8 or char_length(password) > 72 then
    raise exception 'Use a password between 8 and 72 characters.'
      using errcode = '22023';
  end if;

  staff_email := clean_login || '@daymark.example.com';

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    email_change_token_current,
    phone_change,
    phone_change_token,
    reauthentication_token,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    is_sso_user,
    is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000',
    new_id,
    'authenticated',
    'authenticated',
    staff_email,
    extensions.crypt(password, extensions.gen_salt('bf', 6)),
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    jsonb_build_object(
      'provider', 'email',
      'providers', jsonb_build_array('email'),
      'role', 'staff'
    ),
    '{}'::jsonb,
    now(),
    now(),
    false,
    false
  );

  insert into auth.identities (
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) values (
    new_id,
    jsonb_build_object(
      'sub', new_id::text,
      'email', staff_email,
      'email_verified', true
    ),
    'email',
    new_id::text,
    now(),
    now(),
    now()
  );

  insert into public.daymark_profiles (id, login_id, display_name, role, active)
  values (new_id, clean_login, clean_name, 'staff', true)
  returning * into created;

  return jsonb_build_object(
    'id', created.id,
    'login_id', created.login_id,
    'display_name', created.display_name,
    'role', created.role,
    'active', created.active,
    'created_at', created.created_at
  );
exception
  when unique_violation then
    raise exception 'That login ID is already in use'
      using errcode = '23505';
end;
$$;

revoke all on function private.create_staff_login(text, text, text) from public;
revoke all on function private.create_staff_login(text, text, text) from anon;
grant execute on function private.create_staff_login(text, text, text) to authenticated;
grant execute on function private.create_staff_login(text, text, text) to service_role;

create or replace function public.create_staff_login(
  display_name text,
  login_id text,
  password text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.create_staff_login(display_name, login_id, password);
$$;

revoke all on function public.create_staff_login(text, text, text) from public;
revoke all on function public.create_staff_login(text, text, text) from anon;
grant execute on function public.create_staff_login(text, text, text) to authenticated;
grant execute on function public.create_staff_login(text, text, text) to service_role;

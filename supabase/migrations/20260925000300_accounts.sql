-- Phase 1: remove every way to read a password, email sign-in, admin account RPCs (§14, D11, D12).

drop function if exists public.sign_in_email(text);
drop function if exists private.sign_in_email(text);
drop function if exists public.recovery_email_ready(text);
drop function if exists private.recovery_email_ready(text);
drop function if exists public.save_own_password(text);
drop function if exists private.save_own_password(text);
drop function if exists public.reset_password_by_email(text, text);
drop function if exists private.reset_password_by_email(text, text);
drop function if exists public.create_staff_login(text, text, text, text);
drop function if exists private.create_staff_login(text, text, text, text);
drop function if exists public.create_staff_login(text, text, text);
drop function if exists private.create_staff_login(text, text, text);
drop function if exists public.set_staff_password(uuid, text);
drop function if exists private.set_staff_password(uuid, text);
drop function if exists public.delete_staff_login(uuid);
drop function if exists private.delete_staff_login(uuid);
drop function if exists public.set_login_email(uuid, text);
drop function if exists private.set_login_email(uuid, text);
drop table if exists public.daymark_login_secrets;

revoke usage on schema private from anon;

create or replace function private.require_admin()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Only an active admin can do that.' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.clean_email(email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean text := lower(btrim(coalesce(email, '')));
begin
  if clean !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a real email address.' using errcode = '22023';
  end if;
  return clean;
end;
$$;

create or replace function private.check_password(password text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if char_length(coalesce(password, '')) not between 12 and 72 then
    raise exception 'Use a password between 12 and 72 characters.' using errcode = '22023';
  end if;
end;
$$;

-- Sign everyone out of this login (review loophole 16).
create or replace function private.end_sessions(target_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.refresh_tokens where user_id = target_id::text;
  delete from auth.sessions where user_id = target_id;
$$;

create or replace function private.create_person(
  display_name text,
  email text,
  password text,
  is_intern boolean,
  is_supervisor boolean,
  is_admin boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text := btrim(coalesce(display_name, ''));
  clean_email text;
  base text;
  login text;
  n integer := 1;
  new_id uuid := gen_random_uuid();
begin
  perform private.require_admin();
  clean_email := private.clean_email(email);
  perform private.check_password(password);

  if char_length(clean_name) not between 1 and 80 then
    raise exception 'Enter a name up to 80 characters.' using errcode = '22023';
  end if;
  if not (coalesce(is_intern, false) or coalesce(is_supervisor, false) or coalesce(is_admin, false)) then
    raise exception 'Give the person at least one role.' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = clean_email) then
    raise exception 'That email is already on a login.' using errcode = '23505';
  end if;

  -- login_id is kept as an internal handle; people sign in with their email.
  base := left(regexp_replace(regexp_replace(split_part(clean_email, '@', 1), '[^a-z0-9._-]', '', 'g'), '^[^a-z0-9]+', ''), 28);
  if char_length(base) < 2 then
    base := 'person';
  end if;
  login := base;
  while exists (select 1 from public.daymark_profiles p where p.login_id = login) loop
    n := n + 1;
    login := base || '-' || n;
  end loop;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated', clean_email,
    extensions.crypt(password, extensions.gen_salt('bf', 10)), now(),
    '', '', '', '', '', '', '', '',
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')), '{}'::jsonb,
    now(), now(), false, false
  );

  insert into auth.identities (user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (
    new_id,
    jsonb_build_object('sub', new_id::text, 'email', clean_email, 'email_verified', true),
    'email', new_id::text, now(), now(), now()
  );

  insert into public.daymark_profiles (
    id, login_id, display_name, contact_email, active,
    is_intern, is_supervisor, is_admin, must_change_password
  ) values (
    new_id, login, clean_name, clean_email, true,
    coalesce(is_intern, false), coalesce(is_supervisor, false), coalesce(is_admin, false), true
  );

  perform private.audit('create_person', 'daymark_profiles', new_id::text, null,
    jsonb_build_object('email', clean_email, 'is_intern', is_intern, 'is_supervisor', is_supervisor, 'is_admin', is_admin));

  return jsonb_build_object('id', new_id, 'login_id', login, 'display_name', clean_name, 'email', clean_email);
end;
$$;

-- Write-only: the password is hashed and never stored or returned anywhere else.
create or replace function private.set_person_password(target_id uuid, password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  perform private.check_password(password);
  if not exists (select 1 from public.daymark_profiles where id = target_id) then
    raise exception 'That person is not in DGK Clock.' using errcode = '22023';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(password, extensions.gen_salt('bf', 10)),
      updated_at = now()
  where id = target_id;

  -- The auth.users trigger just cleared the flag; an admin-set password must be changed.
  update public.daymark_profiles set must_change_password = true where id = target_id;
  perform private.end_sessions(target_id);
  perform private.audit('set_password', 'daymark_profiles', target_id::text, null, '{"must_change_password": true}');
end;
$$;

create or replace function private.set_person_access(
  target_id uuid,
  is_intern boolean,
  is_supervisor boolean,
  is_admin boolean,
  active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.daymark_profiles%rowtype;
  after_row public.daymark_profiles%rowtype;
begin
  perform private.require_admin();
  if not (coalesce(is_intern, false) or coalesce(is_supervisor, false) or coalesce(is_admin, false)) then
    raise exception 'Give the person at least one role.' using errcode = '22023';
  end if;

  select * into before_row from public.daymark_profiles where id = target_id;
  if not found then
    raise exception 'That person is not in DGK Clock.' using errcode = '22023';
  end if;

  update public.daymark_profiles p
  set is_intern = coalesce(set_person_access.is_intern, false),
      is_supervisor = coalesce(set_person_access.is_supervisor, false),
      is_admin = coalesce(set_person_access.is_admin, false),
      active = coalesce(set_person_access.active, true)
  where p.id = target_id
  returning * into after_row;

  if not after_row.active then
    perform private.end_sessions(target_id);
  end if;

  perform private.audit('set_access', 'daymark_profiles', target_id::text,
    jsonb_build_object('is_intern', before_row.is_intern, 'is_supervisor', before_row.is_supervisor,
                       'is_admin', before_row.is_admin, 'active', before_row.active),
    jsonb_build_object('is_intern', after_row.is_intern, 'is_supervisor', after_row.is_supervisor,
                       'is_admin', after_row.is_admin, 'active', after_row.active));
end;
$$;

create or replace function private.set_person_email(target_id uuid, email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text;
  old_email text;
begin
  perform private.require_admin();
  clean := private.clean_email(email);

  select u.email into old_email from auth.users u where u.id = target_id;
  if not found or not exists (select 1 from public.daymark_profiles where id = target_id) then
    raise exception 'That person is not in DGK Clock.' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = clean and u.id <> target_id) then
    raise exception 'That email is already on a login.' using errcode = '23505';
  end if;

  update auth.users
  set email = clean, email_confirmed_at = now(), email_change = '', email_change_token_new = '',
      email_change_token_current = '', updated_at = now()
  where id = target_id;

  update auth.identities
  set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(clean), true), updated_at = now()
  where user_id = target_id and provider = 'email';

  update public.daymark_profiles set contact_email = clean where id = target_id;
  perform private.audit('set_email', 'daymark_profiles', target_id::text,
    jsonb_build_object('email', old_email), jsonb_build_object('email', clean));
end;
$$;

-- A person changing their own password (reset link or first sign-in) clears the flag.
create or replace function private.on_auth_password_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.daymark_profiles set must_change_password = false
  where id = new.id and must_change_password;
  return new;
end;
$$;

create trigger daymark_password_changed
  after update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function private.on_auth_password_changed();

-- Public wrappers (SECURITY INVOKER) for the client.
create or replace function public.create_person(
  display_name text, email text, password text,
  is_intern boolean, is_supervisor boolean, is_admin boolean
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_person(display_name, email, password, is_intern, is_supervisor, is_admin); $$;

create or replace function public.set_person_password(target_id uuid, password text)
returns void language sql security invoker set search_path = ''
as $$ select private.set_person_password(target_id, password); $$;

create or replace function public.set_person_access(
  target_id uuid, is_intern boolean, is_supervisor boolean, is_admin boolean, active boolean
)
returns void language sql security invoker set search_path = ''
as $$ select private.set_person_access(target_id, is_intern, is_supervisor, is_admin, active); $$;

create or replace function public.set_person_email(target_id uuid, email text)
returns void language sql security invoker set search_path = ''
as $$ select private.set_person_email(target_id, email); $$;

revoke all on function private.require_admin() from public, anon;
revoke all on function private.clean_email(text) from public, anon;
revoke all on function private.check_password(text) from public, anon;
revoke all on function private.end_sessions(uuid) from public, anon, authenticated;
revoke all on function private.on_auth_password_changed() from public, anon, authenticated;
revoke all on function private.create_person(text, text, text, boolean, boolean, boolean) from public, anon;
revoke all on function private.set_person_password(uuid, text) from public, anon;
revoke all on function private.set_person_access(uuid, boolean, boolean, boolean, boolean) from public, anon;
revoke all on function private.set_person_email(uuid, text) from public, anon;
revoke all on function public.create_person(text, text, text, boolean, boolean, boolean) from public, anon;
revoke all on function public.set_person_password(uuid, text) from public, anon;
revoke all on function public.set_person_access(uuid, boolean, boolean, boolean, boolean) from public, anon;
revoke all on function public.set_person_email(uuid, text) from public, anon;

grant execute on function private.require_admin() to authenticated;
grant execute on function private.clean_email(text) to authenticated;
grant execute on function private.check_password(text) to authenticated;
grant execute on function private.create_person(text, text, text, boolean, boolean, boolean) to authenticated;
grant execute on function private.set_person_password(uuid, text) to authenticated;
grant execute on function private.set_person_access(uuid, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function private.set_person_email(uuid, text) to authenticated;
grant execute on function public.create_person(text, text, text, boolean, boolean, boolean) to authenticated;
grant execute on function public.set_person_password(uuid, text) to authenticated;
grant execute on function public.set_person_access(uuid, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.set_person_email(uuid, text) to authenticated;

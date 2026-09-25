-- All four punches stay inside 200m of the Regus first-floor office.
-- Password reset emails go to the real address saved on the login.

alter table public.daymark_profiles
  add column if not exists contact_email text;

alter table public.daymark_profiles
  drop constraint if exists daymark_profiles_contact_email_check;

alter table public.daymark_profiles
  add constraint daymark_profiles_contact_email_check
  check (
    contact_email is null
    or contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  );

create unique index if not exists daymark_profiles_contact_email_key
  on public.daymark_profiles (lower(contact_email))
  where contact_email is not null;

create or replace function private.enforce_punch_sequence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  last_event text;
  staff_ok boolean;
  metres double precision;
  site_latitude constant double precision := -12.4785082;
  site_longitude constant double precision := 130.9854825;
begin
  new.occurred_at := now();

  if new.photo_path !~ ('^' || new.user_id::text || '/[0-9a-f-]{36}\.jpg$') then
    raise exception 'Photo path does not belong to this person';
  end if;

  select exists (
    select 1
    from public.daymark_profiles
    where id = new.user_id
      and role = 'staff'
      and active = true
  ) into staff_ok;

  if not staff_ok then
    raise exception 'This account cannot record a punch';
  end if;

  metres := private.distance_metres(new.latitude, new.longitude, site_latitude, site_longitude);

  if metres > 200 then
    raise exception 'You are out of the range. Be in the location. You are about % away.',
      case
        when metres < 1000 then round(metres)::text || ' m'
        else trim(to_char(round(metres / 100.0) / 10, 'FM999990.0')) || ' km'
      end;
  end if;

  if new.place_name is not null then
    new.place_name := left(btrim(new.place_name), 240);
    if new.place_name = '' then
      new.place_name := null;
    end if;
  end if;

  if new.place_name is null then
    new.place_name := 'Regus, first floor, 1 Palmerston Circuit, Palmerston City, Palmerston NT 0830';
  end if;

  select event_type into last_event
  from public.daymark_punches
  where user_id = new.user_id
  order by occurred_at desc, created_at desc
  limit 1;

  if new.event_type = 'shift_in' and last_event is not null and last_event <> 'shift_out' then
    raise exception 'Finish the open shift before clocking in again';
  elsif new.event_type = 'shift_out' and last_event is distinct from 'shift_in' and last_event is distinct from 'break_out' then
    raise exception 'Clock in before clocking out of the shift';
  elsif new.event_type = 'break_in' and last_event is distinct from 'shift_in' and last_event is distinct from 'break_out' then
    raise exception 'Clock in to a shift before starting a break';
  elsif new.event_type = 'break_out' and last_event is distinct from 'break_in' then
    raise exception 'Start a break before ending it';
  end if;

  return new;
end;
$$;

drop function if exists public.create_staff_login(text, text, text);
drop function if exists private.create_staff_login(text, text, text);

create or replace function private.create_staff_login(
  display_name text,
  login_id text,
  password text,
  email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text := btrim(display_name);
  clean_login text := lower(btrim(login_id));
  clean_email text := nullif(lower(btrim(coalesce(email, ''))), '');
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

  if clean_email is null or clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a real email address.'
      using errcode = '22023';
  end if;

  staff_email := clean_email;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000',
    new_id,
    'authenticated',
    'authenticated',
    staff_email,
    extensions.crypt(password, extensions.gen_salt('bf', 6)),
    now(),
    '', '', '', '', '', '', '', '',
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'staff'),
    '{}'::jsonb,
    now(),
    now(),
    false,
    false
  );

  insert into auth.identities (
    user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    new_id,
    jsonb_build_object('sub', new_id::text, 'email', staff_email, 'email_verified', true),
    'email',
    new_id::text,
    now(),
    now(),
    now()
  );

  insert into public.daymark_profiles (id, login_id, display_name, role, active, contact_email)
  values (new_id, clean_login, clean_name, 'staff', true, clean_email)
  returning * into created;

  insert into public.daymark_login_secrets (user_id, password)
  values (new_id, password);

  return jsonb_build_object(
    'id', created.id,
    'login_id', created.login_id,
    'display_name', created.display_name,
    'role', created.role,
    'active', created.active,
    'created_at', created.created_at,
    'contact_email', created.contact_email
  );
exception
  when unique_violation then
    if sqlerrm ilike '%email%' or sqlerrm ilike '%contact_email%' then
      raise exception 'That email is already on a login'
        using errcode = '23505';
    end if;
    raise exception 'That login ID is already in use'
      using errcode = '23505';
end;
$$;

revoke all on function private.create_staff_login(text, text, text, text) from public;
revoke all on function private.create_staff_login(text, text, text, text) from anon;
grant execute on function private.create_staff_login(text, text, text, text) to authenticated;
grant execute on function private.create_staff_login(text, text, text, text) to service_role;

create or replace function public.create_staff_login(
  display_name text,
  login_id text,
  password text,
  email text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.create_staff_login(display_name, login_id, password, email);
end;
$$;

revoke all on function public.create_staff_login(text, text, text, text) from public;
revoke all on function public.create_staff_login(text, text, text, text) from anon;
grant execute on function public.create_staff_login(text, text, text, text) to authenticated;
grant execute on function public.create_staff_login(text, text, text, text) to service_role;

create or replace function private.set_login_email(target_id uuid, email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := lower(btrim(email));
  allowed boolean;
begin
  if not private.is_admin() then
    raise exception 'Only an active admin can save an email'
      using errcode = '42501';
  end if;

  if clean !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or right(clean, length('@daymark.example.com')) = '@daymark.example.com' then
    raise exception 'Enter a real email address.'
      using errcode = '22023';
  end if;

  select exists (
    select 1 from public.daymark_profiles
    where id = target_id and role in ('admin', 'staff')
  ) into allowed;

  if not allowed then
    raise exception 'That login is not in DGK Clock.'
      using errcode = '22023';
  end if;

  update auth.users
  set email = clean,
      email_confirmed_at = now(),
      email_change = '',
      email_change_token_new = '',
      email_change_token_current = '',
      updated_at = now()
  where id = target_id;

  update auth.identities
  set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(clean), true),
      updated_at = now()
  where user_id = target_id
    and provider = 'email';

  update public.daymark_profiles
  set contact_email = clean
  where id = target_id;
exception
  when unique_violation then
    raise exception 'That email is already on a login'
      using errcode = '23505';
end;
$$;

revoke all on function private.set_login_email(uuid, text) from public;
revoke all on function private.set_login_email(uuid, text) from anon;
grant execute on function private.set_login_email(uuid, text) to authenticated;
grant execute on function private.set_login_email(uuid, text) to service_role;

create or replace function public.set_login_email(target_id uuid, email text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.set_login_email(target_id, email);
end;
$$;

revoke all on function public.set_login_email(uuid, text) from public;
revoke all on function public.set_login_email(uuid, text) from anon;
grant execute on function public.set_login_email(uuid, text) to authenticated;
grant execute on function public.set_login_email(uuid, text) to service_role;

create or replace function private.sign_in_email(login_id text)
returns text
language sql
security definer
set search_path = ''
as $$
  select u.email
  from public.daymark_profiles p
  join auth.users u on u.id = p.id
  where p.login_id = lower(btrim(sign_in_email.login_id))
    and p.active
  limit 1;
$$;

revoke all on function private.sign_in_email(text) from public;
grant execute on function private.sign_in_email(text) to anon;
grant execute on function private.sign_in_email(text) to authenticated;
grant execute on function private.sign_in_email(text) to service_role;

create or replace function public.sign_in_email(login_id text)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.sign_in_email(login_id);
$$;

revoke all on function public.sign_in_email(text) from public;
grant execute on function public.sign_in_email(text) to anon;
grant execute on function public.sign_in_email(text) to authenticated;
grant execute on function public.sign_in_email(text) to service_role;

create or replace function private.recovery_email_ready(email text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.daymark_profiles p
    join auth.users u on u.id = p.id
    where p.active
      and lower(u.email) = lower(btrim(recovery_email_ready.email))
      and right(lower(u.email), length('@daymark.example.com')) <> '@daymark.example.com'
  );
$$;

revoke all on function private.recovery_email_ready(text) from public;
grant execute on function private.recovery_email_ready(text) to anon;
grant execute on function private.recovery_email_ready(text) to authenticated;
grant execute on function private.recovery_email_ready(text) to service_role;

create or replace function public.recovery_email_ready(email text)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.recovery_email_ready(email);
$$;

revoke all on function public.recovery_email_ready(text) from public;
grant execute on function public.recovery_email_ready(text) to anon;
grant execute on function public.recovery_email_ready(text) to authenticated;
grant execute on function public.recovery_email_ready(text) to service_role;

create or replace function private.save_own_password(password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_id uuid := auth.uid();
begin
  if current_id is null then
    raise exception 'Sign in before saving a password.'
      using errcode = '42501';
  end if;

  if char_length(password) < 8 or char_length(password) > 72 then
    raise exception 'Use a password between 8 and 72 characters.'
      using errcode = '22023';
  end if;

  insert into public.daymark_login_secrets (user_id, password, updated_at)
  values (current_id, password, now())
  on conflict (user_id) do update
  set password = excluded.password,
      updated_at = excluded.updated_at;
end;
$$;

revoke all on function private.save_own_password(text) from public;
revoke all on function private.save_own_password(text) from anon;
grant execute on function private.save_own_password(text) to authenticated;
grant execute on function private.save_own_password(text) to service_role;

create or replace function public.save_own_password(password text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.save_own_password(password);
end;
$$;

revoke all on function public.save_own_password(text) from public;
revoke all on function public.save_own_password(text) from anon;
grant execute on function public.save_own_password(text) to authenticated;
grant execute on function public.save_own_password(text) to service_role;

revoke all on function public.reset_password_by_email(text, text) from anon;
revoke all on function public.reset_password_by_email(text, text) from authenticated;
revoke all on function private.reset_password_by_email(text, text) from anon;
revoke all on function private.reset_password_by_email(text, text) from authenticated;

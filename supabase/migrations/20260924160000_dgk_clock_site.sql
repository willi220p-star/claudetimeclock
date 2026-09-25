-- DGK Clock: place names, admin password lookup, staff deletion, and the Palmerston geofence.

alter table public.daymark_punches
  add column if not exists place_name text;

alter table public.daymark_punches
  drop constraint if exists daymark_punches_place_name_check;

alter table public.daymark_punches
  add constraint daymark_punches_place_name_check
  check (place_name is null or char_length(btrim(place_name)) between 1 and 160);

create table if not exists public.daymark_login_secrets (
  user_id uuid primary key references public.daymark_profiles (id) on delete cascade,
  password text not null,
  updated_at timestamptz not null default now(),
  constraint daymark_login_secrets_password_check check (char_length(password) between 8 and 72)
);

alter table public.daymark_login_secrets enable row level security;

drop policy if exists "Admins can read login passwords" on public.daymark_login_secrets;
create policy "Admins can read login passwords"
  on public.daymark_login_secrets
  for select
  to authenticated
  using ((select private.is_admin()));

revoke all on table public.daymark_login_secrets from anon;
revoke all on table public.daymark_login_secrets from public;
grant select on table public.daymark_login_secrets to authenticated;
grant select, insert, update, delete on table public.daymark_login_secrets to service_role;

create or replace function private.distance_metres(
  latitude double precision,
  longitude double precision,
  site_latitude double precision,
  site_longitude double precision
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 6371000 * 2 * asin(least(1, sqrt(
    power(sin(radians(site_latitude - latitude) / 2), 2)
    + cos(radians(latitude)) * cos(radians(site_latitude))
      * power(sin(radians(site_longitude - longitude) / 2), 2)
  )));
$$;

revoke all on function private.distance_metres(double precision, double precision, double precision, double precision) from public;
revoke all on function private.distance_metres(double precision, double precision, double precision, double precision) from anon;
grant execute on function private.distance_metres(double precision, double precision, double precision, double precision) to authenticated;
grant execute on function private.distance_metres(double precision, double precision, double precision, double precision) to service_role;

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

  if new.event_type = 'shift_in' and metres > 200 then
    raise exception 'You are about % from the Resus building at Services Australia, Palmerston. Clock in only works within 200 metres of that building. You need to be there.',
      case
        when metres < 1000 then round(metres)::text || ' m'
        else trim(to_char(round(metres / 100.0) / 10, 'FM999990.0')) || ' km'
      end;
  end if;

  if new.event_type = 'shift_in' and metres <= 200 then
    new.place_name := 'Resus building, Services Australia, Palmerston';
  elsif new.place_name is not null then
    new.place_name := left(btrim(new.place_name), 160);
    if new.place_name = '' then
      new.place_name := null;
    end if;
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

  insert into public.daymark_profiles (id, login_id, display_name, role, active)
  values (new_id, clean_login, clean_name, 'staff', true)
  returning * into created;

  insert into public.daymark_login_secrets (user_id, password)
  values (new_id, password);

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

create or replace function private.set_staff_password(target_id uuid, password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  staff_ok boolean;
begin
  if not private.is_admin() then
    raise exception 'Only an active admin can change a password'
      using errcode = '42501';
  end if;

  if char_length(password) < 8 or char_length(password) > 72 then
    raise exception 'Use a password between 8 and 72 characters.'
      using errcode = '22023';
  end if;

  select exists (
    select 1 from public.daymark_profiles
    where id = target_id and role = 'staff'
  ) into staff_ok;

  if not staff_ok then
    raise exception 'Only a staff login can have its password changed here'
      using errcode = '22023';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(password, extensions.gen_salt('bf', 6)),
      updated_at = now()
  where id = target_id;

  insert into public.daymark_login_secrets (user_id, password, updated_at)
  values (target_id, password, now())
  on conflict (user_id) do update
  set password = excluded.password,
      updated_at = excluded.updated_at;
end;
$$;

create or replace function private.delete_staff_login(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  staff_ok boolean;
begin
  if not private.is_admin() then
    raise exception 'Only an active admin can delete a person'
      using errcode = '42501';
  end if;

  select exists (
    select 1 from public.daymark_profiles
    where id = target_id and role = 'staff'
  ) into staff_ok;

  if not staff_ok then
    raise exception 'Only a staff login can be deleted'
      using errcode = '22023';
  end if;

  delete from auth.sessions where user_id = target_id;
  delete from auth.refresh_tokens where user_id = target_id::text;
  delete from auth.users where id = target_id;
end;
$$;

revoke all on function private.set_staff_password(uuid, text) from public;
revoke all on function private.set_staff_password(uuid, text) from anon;
revoke all on function private.delete_staff_login(uuid) from public;
revoke all on function private.delete_staff_login(uuid) from anon;
grant execute on function private.set_staff_password(uuid, text) to authenticated;
grant execute on function private.set_staff_password(uuid, text) to service_role;
grant execute on function private.delete_staff_login(uuid) to authenticated;
grant execute on function private.delete_staff_login(uuid) to service_role;

create or replace function public.set_staff_password(target_id uuid, password text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.set_staff_password(target_id, password);
end;
$$;

create or replace function public.delete_staff_login(target_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.delete_staff_login(target_id);
end;
$$;

revoke all on function public.set_staff_password(uuid, text) from public;
revoke all on function public.set_staff_password(uuid, text) from anon;
revoke all on function public.delete_staff_login(uuid) from public;
revoke all on function public.delete_staff_login(uuid) from anon;
grant execute on function public.set_staff_password(uuid, text) to authenticated;
grant execute on function public.set_staff_password(uuid, text) to service_role;
grant execute on function public.delete_staff_login(uuid) to authenticated;
grant execute on function public.delete_staff_login(uuid) to service_role;

drop policy if exists "Admins can delete clock photos" on storage.objects;
create policy "Admins can delete clock photos"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'daymark-photos'
    and (select private.is_admin())
  );

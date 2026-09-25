-- Forgot-password reset for staff and admin, and a 200m clock-in/out radius at Regus Australia, Palmerston.

alter table public.daymark_punches
  drop constraint if exists daymark_punches_place_name_check;

alter table public.daymark_punches
  add constraint daymark_punches_place_name_check
  check (place_name is null or char_length(btrim(place_name)) between 1 and 240);

grant usage on schema private to anon;

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

  if new.event_type in ('shift_in', 'shift_out') and metres > 200 then
    raise exception 'You are not in the location. Be at Regus Australia, 1 Palmerston Circuit, Palmerston. You are about % away.',
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

  if metres <= 200 and new.place_name is null then
    new.place_name := 'Regus Australia, 1 Palmerston Circuit, Palmerston NT 0830';
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

create or replace function private.reset_password_by_email(email text, password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_email text := lower(btrim(email));
  target_id uuid;
  login text;
  active_ok boolean;
begin
  if clean_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and clean_email !~ '^[a-z0-9][a-z0-9._-]{1,31}$' then
    raise exception 'Enter the email on your login.'
      using errcode = '22023';
  end if;

  if position('@' in clean_email) = 0 then
    clean_email := clean_email || '@daymark.example.com';
  end if;

  if char_length(password) < 8 or char_length(password) > 72 then
    raise exception 'Use a password between 8 and 72 characters.'
      using errcode = '22023';
  end if;

  select id into target_id
  from auth.users
  where lower(auth.users.email) = clean_email;

  if target_id is null then
    raise exception 'No login uses that email.'
      using errcode = 'P0002';
  end if;

  select p.login_id, p.active
  into login, active_ok
  from public.daymark_profiles p
  where p.id = target_id
    and p.role in ('admin', 'staff');

  if login is null then
    raise exception 'No login uses that email.'
      using errcode = 'P0002';
  end if;

  if not active_ok then
    raise exception 'This login is paused. Ask an admin to turn it back on.'
      using errcode = '42501';
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

  return jsonb_build_object('login_id', login);
end;
$$;

revoke all on function private.reset_password_by_email(text, text) from public;
grant execute on function private.reset_password_by_email(text, text) to anon;
grant execute on function private.reset_password_by_email(text, text) to authenticated;
grant execute on function private.reset_password_by_email(text, text) to service_role;

create or replace function public.reset_password_by_email(email text, password text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.reset_password_by_email(email, password);
end;
$$;

revoke all on function public.reset_password_by_email(text, text) from public;
grant execute on function public.reset_password_by_email(text, text) to anon;
grant execute on function public.reset_password_by_email(text, text) to authenticated;
grant execute on function public.reset_password_by_email(text, text) to service_role;

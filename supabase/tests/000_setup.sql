-- Test helpers shared by every pgTAP file. Runs first (files run in name order) and is
-- committed on purpose so later files can use it. `supabase db reset` removes it.
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

-- A person with a login. Local test password only.
create or replace function tests.create_person(
  p_email text,
  p_intern boolean default true,
  p_supervisor boolean default false,
  p_admin boolean default false,
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email,
    extensions.crypt('Password-1234', extensions.gen_salt('bf', 4)), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );
  insert into public.daymark_profiles (id, login_id, display_name, is_intern, is_supervisor, is_admin, contact_email)
  values (uid, 't' || left(replace(uid::text, '-', ''), 12), coalesce(p_name, split_part(p_email, '@', 1)),
          p_intern, p_supervisor, p_admin, p_email);
  return uid;
end;
$$;

-- Act as a signed-in person for the rest of the transaction.
create or replace function tests.as_person(p_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_id::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- Freeze the business clock (read by private.clock_now()) for this transaction.
create or replace function tests.at(p_ts text)
returns void
language sql
as $$
  select set_config('daymark.test_now', p_ts, true);
$$;

grant execute on all functions in schema tests to anon, authenticated;

select plan(1);
select has_function('tests', 'create_person', 'test helpers are installed');
select * from finish();

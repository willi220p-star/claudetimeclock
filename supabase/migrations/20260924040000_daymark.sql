-- Daymark time clock: profiles, punches, private helpers, and photo storage.
-- Applied to the personal Supabase project.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;
grant usage on schema private to service_role;

create table public.daymark_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  login_id text not null,
  display_name text not null,
  role text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint daymark_profiles_login_id_format check (login_id ~ '^[a-z0-9][a-z0-9._-]{1,31}$'),
  constraint daymark_profiles_role_check check (role in ('admin', 'staff')),
  constraint daymark_profiles_display_name_check check (char_length(btrim(display_name)) between 1 and 80)
);

create unique index daymark_profiles_login_id_key on public.daymark_profiles (login_id);

create table public.daymark_punches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.daymark_profiles (id) on delete cascade,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  photo_path text not null,
  created_at timestamptz not null default now(),
  constraint daymark_punches_event_type_check check (event_type in ('shift_in', 'shift_out', 'break_in', 'break_out')),
  constraint daymark_punches_latitude_check check (latitude between -90 and 90),
  constraint daymark_punches_longitude_check check (longitude between -180 and 180),
  constraint daymark_punches_accuracy_check check (accuracy_m is null or accuracy_m >= 0),
  constraint daymark_punches_photo_path_check check (photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$')
);

create index daymark_punches_user_time_idx
  on public.daymark_punches (user_id, occurred_at desc);

alter table public.daymark_profiles enable row level security;
alter table public.daymark_punches enable row level security;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.daymark_profiles
    where id = (select auth.uid())
      and role = 'admin'
      and active = true
  );
$$;

revoke all on function private.is_admin() from public;
revoke all on function private.is_admin() from anon;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_admin() to service_role;

create or replace function private.enforce_punch_sequence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  last_event text;
  staff_ok boolean;
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

revoke all on function private.enforce_punch_sequence() from public;
revoke all on function private.enforce_punch_sequence() from anon;
grant execute on function private.enforce_punch_sequence() to authenticated;
grant execute on function private.enforce_punch_sequence() to service_role;

create trigger daymark_punches_sequence
  before insert on public.daymark_punches
  for each row
  execute function private.enforce_punch_sequence();

create policy "Profiles are visible to the owner and admins"
  on public.daymark_profiles
  for select
  to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

create policy "Admins can update profiles"
  on public.daymark_profiles
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "Punches are visible to the owner and admins"
  on public.daymark_punches
  for select
  to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy "Staff can insert their own punches"
  on public.daymark_punches
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

revoke all on table public.daymark_profiles from anon;
revoke all on table public.daymark_punches from anon;
grant select, update on table public.daymark_profiles to authenticated;
grant select, insert on table public.daymark_punches to authenticated;
grant select, insert, update, delete on table public.daymark_profiles to service_role;
grant select, insert, update, delete on table public.daymark_punches to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('daymark-photos', 'daymark-photos', false, 5242880, array['image/jpeg']::text[])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Staff upload their own clock photos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'daymark-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
  );

create policy "Clock photos are readable by the owner and admins"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'daymark-photos'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select private.is_admin())
    )
  );

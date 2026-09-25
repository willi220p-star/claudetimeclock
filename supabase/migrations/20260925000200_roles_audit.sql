-- Phase 1: role flags, last-admin guard, append-only audit log (§6, §14).

alter table public.daymark_profiles
  add column is_intern boolean not null default false,
  add column is_supervisor boolean not null default false,
  add column is_admin boolean not null default false,
  add column must_change_password boolean not null default false;

update public.daymark_profiles
set is_admin = (role = 'admin'),
    is_intern = (role = 'staff');

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.daymark_profiles
    where id = (select auth.uid()) and is_admin and active
  );
$$;

alter table public.daymark_profiles drop column role;

-- §6 Guard: never remove or deactivate the last active admin.
-- ponytail: two admins demoting each other in concurrent transactions could both pass; add a
-- table lock here if the admin count ever grows past a handful.
create or replace function private.guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_admin and old.active
     and (tg_op = 'DELETE' or not new.is_admin or not new.active)
     and not exists (
       select 1 from public.daymark_profiles
       where is_admin and active and id <> old.id
     ) then
    raise exception 'Keep at least one active admin. Make someone else an admin first.'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.guard_last_admin() from public, anon, authenticated;

create trigger daymark_profiles_last_admin
  before update or delete on public.daymark_profiles
  for each row execute function private.guard_last_admin();

-- Profiles change only through audited RPCs.
revoke insert, update, delete on table public.daymark_profiles from anon, authenticated;

-- §14 Audit log: append-only for everyone, including the admin.
create table public.daymark_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,              -- no FK on purpose: the row outlives a purged person
  action text not null,
  table_name text not null,
  row_id text,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

create index daymark_audit_log_at_idx on public.daymark_audit_log (at desc);
create index daymark_audit_log_row_idx on public.daymark_audit_log (table_name, row_id);
create index daymark_audit_log_actor_idx on public.daymark_audit_log (actor_id);

alter table public.daymark_audit_log enable row level security;

create policy "Admins read the audit log" on public.daymark_audit_log
  for select to authenticated using ((select private.is_admin()));

revoke all on table public.daymark_audit_log from public, anon, authenticated;
grant select on table public.daymark_audit_log to authenticated;
grant select, insert on table public.daymark_audit_log to service_role;

-- Only the retention purge may remove rows, inside its own transaction (ADR 0003).
create or replace function private.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('daymark.purging', true) = 'on' then
    return old;
  end if;
  raise exception 'The audit log cannot be changed.' using errcode = 'P0001';
end;
$$;

revoke all on function private.audit_log_append_only() from public, anon, authenticated;

create trigger daymark_audit_log_append_only
  before update or delete on public.daymark_audit_log
  for each row execute function private.audit_log_append_only();

create or replace function private.audit(
  action text,
  table_name text,
  row_id text,
  before jsonb,
  after jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.daymark_audit_log (actor_id, action, table_name, row_id, before, after, at)
  values ((select auth.uid()), action, table_name, row_id, before, after, private.clock_now());
$$;

revoke all on function private.audit(text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function private.audit(text, text, text, jsonb, jsonb) to service_role;

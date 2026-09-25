-- Phase 1: business clock, Darwin calendar helpers, settings, site and closure days.

-- §3 Test clock. Every rule reads time through this, never now() directly.
-- daymark.test_now is honoured only for the postgres session user (pgTAP), and only when set.
create or replace function private.clock_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when session_user = 'postgres' and nullif(current_setting('daymark.test_now', true), '') is not null
      then current_setting('daymark.test_now', true)::timestamptz
    else now()
  end;
$$;

create or replace function private.darwin_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (private.clock_now() at time zone 'Australia/Darwin')::date;
$$;

-- The instant of a Darwin wall-clock time on a Darwin date.
create or replace function private.darwin_at(d date, t time)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (d + t) at time zone 'Australia/Darwin';
$$;

revoke all on function private.clock_now() from public, anon;
revoke all on function private.darwin_today() from public, anon;
revoke all on function private.darwin_at(date, time) from public, anon;
grant execute on function private.clock_now() to authenticated, service_role;
grant execute on function private.darwin_today() to authenticated, service_role;
grant execute on function private.darwin_at(date, time) to authenticated, service_role;

-- §10 settings singleton
create table public.daymark_settings (
  id integer primary key default 1 check (id = 1),
  fortnight_anchor date not null default '2026-09-28' check (extract(isodow from fortnight_anchor) = 1),
  grace_minutes integer not null default 15 check (grace_minutes between 0 and 120),
  max_day_minutes integer not null default 600 check (max_day_minutes between 60 and 720),
  break_threshold_minutes integer not null default 300,
  break_minutes integer not null default 30,
  escalation_hours integer not null default 72 check (escalation_hours > 0),
  retention_days integer not null default 30 check (retention_days between 1 and 365),
  notice_hours integer not null default 24,
  punch_fix_days integer not null default 7,
  sick_backdate_days integer not null default 2,
  -- security review §5
  max_accuracy_m integer not null default 150 check (max_accuracy_m > 0),
  punch_fix_min_reason integer not null default 20,
  punch_fix_max_per_fortnight integer not null default 2,
  cert_retention_days integer not null default 7,
  idle_signout_minutes integer not null default 30,
  notice_version text not null default '1.0',
  updated_at timestamptz not null default now()
);

insert into public.daymark_settings (id) values (1);

-- §10 sites
create table public.daymark_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  address text not null check (char_length(btrim(address)) between 1 and 240),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_m integer not null default 200 check (radius_m between 20 and 2000),
  standard_capacity integer not null default 3 check (standard_capacity > 0),
  hard_capacity integer not null default 4,
  window_start time not null default '07:00',
  window_end time not null default '19:00',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint daymark_sites_capacity_check check (hard_capacity >= standard_capacity),
  constraint daymark_sites_window_check check (window_end > window_start)
);

-- The real office (D10: real data belongs in a migration, not only the local seed).
insert into public.daymark_sites (name, address, latitude, longitude)
values ('Regus Palmerston', 'Regus, Level 1, 1 Palmerston Circuit, Palmerston City NT 0830', -12.4785082, 130.9854825);

-- §10 closure days. site_id null = every site.
create table public.daymark_closure_days (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references public.daymark_sites (id) on delete cascade,
  day date not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null default 'public_holiday' check (kind in ('public_holiday', 'office_closure')),
  created_at timestamptz not null default now()
);

create unique index daymark_closure_days_site_day_key
  on public.daymark_closure_days (coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid), day);
create index daymark_closure_days_site_idx on public.daymark_closure_days (site_id);
create index daymark_closure_days_day_idx on public.daymark_closure_days (day);

insert into public.daymark_closure_days (day, name) values
  ('2026-01-01', 'New Year''s Day'),
  ('2026-01-26', 'Australia Day'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-06', 'Easter Monday'),
  ('2026-05-04', 'May Day'),
  ('2026-06-08', 'King''s Birthday'),
  ('2026-07-24', 'Darwin Show Day'),
  ('2026-08-03', 'Picnic Day'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-28', 'Boxing Day (observed)'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-01-26', 'Australia Day'),
  ('2027-03-26', 'Good Friday'),
  ('2027-03-29', 'Easter Monday'),
  ('2027-04-26', 'ANZAC Day (observed)'),
  ('2027-05-03', 'May Day'),
  ('2027-06-14', 'King''s Birthday'),
  ('2027-07-23', 'Darwin Show Day'),
  ('2027-08-02', 'Picnic Day'),
  ('2027-12-27', 'Christmas Day (observed)'),
  ('2027-12-28', 'Boxing Day (observed)');

alter table public.daymark_settings enable row level security;
alter table public.daymark_sites enable row level security;
alter table public.daymark_closure_days enable row level security;

-- Reference data is readable by anyone signed in. Changes come through admin RPCs (Phase 7).
create policy "Signed-in people read settings" on public.daymark_settings
  for select to authenticated using (true);
create policy "Signed-in people read sites" on public.daymark_sites
  for select to authenticated using (true);
create policy "Signed-in people read closure days" on public.daymark_closure_days
  for select to authenticated using (true);

revoke all on table public.daymark_settings, public.daymark_sites, public.daymark_closure_days from public, anon, authenticated;
grant select on table public.daymark_settings, public.daymark_sites, public.daymark_closure_days to authenticated;
grant all on table public.daymark_settings, public.daymark_sites, public.daymark_closure_days to service_role;

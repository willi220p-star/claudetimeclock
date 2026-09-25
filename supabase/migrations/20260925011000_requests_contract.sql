-- Phase 2: shared schema that Phases 3 and 5 build on in parallel. The requests table (§9, §10)
-- and supervisor-confirmation columns on punches (review §2.7, D6). Behaviour (validation,
-- state machine, effects) is added by Phase 5; overtime upserts by Phase 3.

create table public.daymark_requests (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.daymark_placements (id) on delete cascade,
  intern_id uuid not null references public.daymark_profiles (id) on delete cascade,
  type text not null check (type in (
    'swap', 'shift_change', 'extra_day', 'leave', 'punch_fix', 'overtime', 'pattern_change', 'attendance'
  )),
  status text not null default 'pending_supervisor'
    check (status in ('pending_supervisor', 'pending_admin', 'approved', 'declined', 'cancelled')),
  payload jsonb not null default '{}',
  dates date[] not null default '{}',            -- every date the request touches (C7, indexes)
  reason text check (reason is null or char_length(reason) <= 1000),
  attachment_path text,
  certificate_sighted boolean not null default false,
  needs_extra_spot boolean not null default false,
  requested_minutes integer check (requested_minutes is null or requested_minutes >= 0),
  approved_minutes integer check (approved_minutes is null or approved_minutes >= 0),
  supervisor_decision text check (supervisor_decision in ('approved', 'declined')),
  supervisor_id uuid references public.daymark_profiles (id) on delete set null,
  supervisor_decided_at timestamptz,
  supervisor_note text check (supervisor_note is null or char_length(supervisor_note) <= 500),
  admin_decision text check (admin_decision in ('approved', 'declined')),
  admin_id uuid references public.daymark_profiles (id) on delete set null,
  admin_decided_at timestamptz,
  admin_note text check (admin_note is null or char_length(admin_note) <= 500),
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daymark_requests_approved_within_requested
    check (approved_minutes is null or requested_minutes is null or approved_minutes <= requested_minutes)
);

create index daymark_requests_placement_idx on public.daymark_requests (placement_id, created_at desc);
create index daymark_requests_intern_idx on public.daymark_requests (intern_id);
create index daymark_requests_supervisor_idx on public.daymark_requests (supervisor_id);
create index daymark_requests_admin_idx on public.daymark_requests (admin_id);
create index daymark_requests_pending_idx on public.daymark_requests (created_at)
  where status in ('pending_supervisor', 'pending_admin');
create index daymark_requests_escalation_idx on public.daymark_requests (created_at)
  where status = 'pending_supervisor' and escalated_at is null;
create index daymark_requests_dates_idx on public.daymark_requests using gin (dates);
-- One overtime request per placement and day (R5.4.7 upsert target).
create unique index daymark_requests_overtime_day_key on public.daymark_requests (placement_id, (dates[1]))
  where type = 'overtime';

alter table public.daymark_requests enable row level security;
create policy "Requests follow the placement" on public.daymark_requests
  for select to authenticated using ((select private.can_view_placement(placement_id)));
revoke all on table public.daymark_requests from public, anon, authenticated;
grant select on table public.daymark_requests to authenticated;
grant all on table public.daymark_requests to service_role;

alter table public.daymark_pattern_versions
  add constraint daymark_pattern_versions_request_fkey foreign key (request_id)
  references public.daymark_requests (id) on delete set null;
alter table public.daymark_scheduled_days
  add constraint daymark_scheduled_days_request_fkey foreign key (origin_request_id)
  references public.daymark_requests (id) on delete set null;
alter table public.daymark_schedule_history
  add constraint daymark_schedule_history_request_fkey foreign key (request_id)
  references public.daymark_requests (id) on delete set null;

-- Supervisor confirmation path: a punch with source 'supervisor' counts only once confirmed.
alter table public.daymark_punches
  add column confirmed_by uuid references public.daymark_profiles (id) on delete set null,
  add column confirmed_at timestamptz;
create index daymark_punches_confirmed_by_idx on public.daymark_punches (confirmed_by);

-- Weekly sign-off, timesheet export and pay rates (Dilip, 12 Oct; D43).
-- Contract: docs/superpowers/specs/2026-10-12-signoff-contract.md.
-- A week runs Monday to Sunday. Once it has ended and nothing is open, the placement's supervisor
-- (or an admin) signs it. A later change to a counted day reopens it: the row is kept with the
-- reason, never deleted, so the history stays. The admin exports signed days as CSV.

-- ---------------------------------------------------------------------------
-- 1. Pay: paid placements record an hourly rate only (payroll does tax and super).
-- ---------------------------------------------------------------------------
alter table public.daymark_placements
  add column paid boolean not null default false,
  add column hourly_rate numeric(8,2),
  -- coalesce: a bare `hourly_rate > 0` is null for a null rate, and a null check passes.
  add constraint daymark_placements_pay_check check (not paid or coalesce(hourly_rate, 0) > 0);

-- ---------------------------------------------------------------------------
-- 2. Sign-offs
-- ---------------------------------------------------------------------------
create table public.daymark_week_signoffs (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.daymark_placements (id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  signed_by uuid references public.daymark_profiles (id) on delete set null,
  signed_at timestamptz not null,
  counted_minutes integer not null,
  reopened_at timestamptz,
  reopened_reason text
);
-- One live sign-off per week; reopened rows stay as history.
create unique index daymark_week_signoffs_live_idx on public.daymark_week_signoffs (placement_id, week_start)
  where reopened_at is null;
create index daymark_week_signoffs_placement_idx on public.daymark_week_signoffs (placement_id, week_start);
create index daymark_week_signoffs_signed_by_idx on public.daymark_week_signoffs (signed_by);

alter table public.daymark_week_signoffs enable row level security;
revoke all on table public.daymark_week_signoffs from public, anon, authenticated;
grant all on table public.daymark_week_signoffs to service_role;

-- The placement's supervisor or an admin; nobody else, interns included.
create or replace function private.require_week_signer(placement uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.is_admin() or exists (
            select 1 from public.daymark_placements pl
            join public.daymark_profiles p on p.id = pl.supervisor_id and p.active
            where pl.id = placement and pl.supervisor_id = (select auth.uid()))) then
    raise exception 'Only the placement''s supervisor or an admin can do that.' using errcode = '42501';
  end if;
end;
$$;

-- What stops a week being signed, in plain English.
create or replace function private.week_open_items(placement uuid, week_start date)
returns table (kind text, work_date date, label text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  week_end date := week_open_items.week_start + 6;
begin
  perform private.require_week_signer(placement);
  return query
  select x.kind, x.work_date, x.label from (
    select 'no_clock_out'::text as kind, s.work_date, 'No clock-out on ' || private.fmt_day(s.work_date) as label
    from public.daymark_shifts s
    where s.placement_id = placement and s.work_date between week_open_items.week_start and week_end
      and s.clock_out_at is null and s.work_date < private.darwin_today()
    union all
    -- An attendance request is the unconfirmed punch below, so it is listed once, as that.
    select 'pending_request', d.d,
           upper(left(private.request_label(q.type), 1)) || substr(private.request_label(q.type), 2)
             || ' request waiting on ' || private.fmt_day(d.d)
    from public.daymark_requests q
    cross join lateral (select min(t) as d from unnest(q.dates) t
                        where t between week_open_items.week_start and week_end) d
    where q.placement_id = placement and q.status in ('pending_supervisor', 'pending_admin')
      and q.type <> 'attendance' and d.d is not null
    union all
    -- A typed-in or offline time waits for the supervisor until confirmed; a declined or cancelled
    -- confirmation has been dealt with (the punch stays and counts 0).
    select 'unconfirmed_time', (u.occurred_at at time zone 'Australia/Darwin')::date,
           'Unconfirmed time on ' || private.fmt_day((u.occurred_at at time zone 'Australia/Darwin')::date)
    from public.daymark_punches u
    where u.placement_id = placement and u.source = 'supervisor' and u.confirmed_at is null
      and (u.occurred_at at time zone 'Australia/Darwin')::date between week_open_items.week_start and week_end
      and not exists (select 1 from public.daymark_requests q
                      where q.type = 'attendance' and q.payload ->> 'punch_id' = u.id::text
                        and q.status in ('declined', 'cancelled'))
  ) x
  order by x.work_date, x.kind;
end;
$$;

create or replace function private.sign_week(placement uuid, week_start date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  signed public.daymark_week_signoffs%rowtype;
begin
  perform private.require_week_signer(placement);
  if sign_week.week_start is null or extract(isodow from sign_week.week_start) <> 1 then
    raise exception 'A week starts on a Monday.' using errcode = '22023';
  end if;
  if private.darwin_today() < sign_week.week_start + 7 then
    raise exception 'You can sign a week once it has ended.' using errcode = '22023';
  end if;
  if exists (select 1 from private.week_open_items(placement, sign_week.week_start)) then
    raise exception 'Fix the open items first.' using errcode = 'P0001', hint = 'open_items';
  end if;
  if exists (select 1 from public.daymark_week_signoffs w
             where w.placement_id = placement and w.week_start = sign_week.week_start and w.reopened_at is null) then
    raise exception 'Already signed.' using errcode = 'P0001';
  end if;

  begin
    insert into public.daymark_week_signoffs (placement_id, week_start, signed_by, signed_at, counted_minutes)
    values (placement, sign_week.week_start, (select auth.uid()), private.clock_now(),
            (select coalesce(sum(r.counted), 0)::int from public.daymark_day_results r
             where r.placement_id = placement and r.work_date between sign_week.week_start and sign_week.week_start + 6))
    returning * into signed;
  exception when unique_violation then  -- signed at the same moment by someone else
    raise exception 'Already signed.' using errcode = 'P0001';
  end;
  perform private.audit('sign_week', 'daymark_week_signoffs', signed.id::text, null, to_jsonb(signed));
  return jsonb_build_object('signed_at', signed.signed_at, 'counted_minutes', signed.counted_minutes);
end;
$$;

create or replace function private.week_signoffs(from_date date, to_date date)
returns table (placement_id uuid, week_start date, signed_by_name text, signed_at timestamptz, counted_minutes integer)
language sql
stable
security definer
set search_path = ''
as $$
  select w.placement_id, w.week_start, coalesce(p.display_name, 'Someone'), w.signed_at, w.counted_minutes
  from public.daymark_week_signoffs w
  join public.daymark_placements pl on pl.id = w.placement_id
  left join public.daymark_profiles p on p.id = w.signed_by
  where w.reopened_at is null and w.week_start between from_date and to_date
    and (private.is_admin() or pl.supervisor_id = (select auth.uid()))
  order by w.week_start, w.placement_id;
$$;

create or replace function private.signoff_export(from_date date, to_date date)
returns table (intern_name text, placement_id uuid, week_start date, work_date date, counted_minutes integer,
               break_minutes integer, paid boolean, hourly_rate numeric, amount numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select p.display_name, pl.id, w.week_start, r.work_date, r.counted, r.break, pl.paid, pl.hourly_rate,
         case when pl.paid then round(r.counted / 60.0 * pl.hourly_rate, 2) end
  from public.daymark_week_signoffs w
  join public.daymark_placements pl on pl.id = w.placement_id
  join public.daymark_profiles p on p.id = pl.intern_id
  join public.daymark_day_results r on r.placement_id = w.placement_id
    and r.work_date between w.week_start and w.week_start + 6
  where w.reopened_at is null and w.week_start between from_date and to_date
  order by p.display_name, r.work_date;
end;
$$;

create or replace function private.set_placement_pay(placement uuid, paid boolean, hourly_rate numeric default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_pay jsonb;
begin
  perform private.require_admin();
  if set_placement_pay.paid is null then
    raise exception 'Say whether the placement is paid.' using errcode = '22023';
  end if;
  if set_placement_pay.paid and coalesce(set_placement_pay.hourly_rate, 0) <= 0 then
    raise exception 'Set an hourly rate above 0.' using errcode = '22023';
  end if;
  select jsonb_build_object('paid', pl.paid, 'hourly_rate', pl.hourly_rate) into old_pay
  from public.daymark_placements pl where pl.id = placement for update;
  if old_pay is null then
    raise exception 'That placement doesn''t exist.' using errcode = 'P0002';
  end if;
  -- Unpaid has no rate.
  update public.daymark_placements pl
  set paid = set_placement_pay.paid,
      hourly_rate = case when set_placement_pay.paid then set_placement_pay.hourly_rate end
  where pl.id = placement;
  perform private.audit('set_placement_pay', 'daymark_placements', placement::text, old_pay,
    jsonb_build_object('paid', set_placement_pay.paid,
                       'hourly_rate', case when set_placement_pay.paid then set_placement_pay.hourly_rate end));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Reopening: a counted day in a live signed week changed. A recompute that changes nothing
-- doesn't write the row (recompute_day), and the update trigger fires on counted/break only.
-- ---------------------------------------------------------------------------
create or replace function private.reopen_signed_week()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.daymark_day_results;
  w public.daymark_week_signoffs%rowtype;
  intern text;
begin
  if current_setting('daymark.purging', true) = 'on' then  -- the whole placement is going
    return null;
  end if;
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  update public.daymark_week_signoffs x
  set reopened_at = private.clock_now(), reopened_reason = 'Times changed on ' || private.fmt_day(r.work_date)
  where x.placement_id = r.placement_id and x.week_start = r.work_date - (extract(isodow from r.work_date)::int - 1)
    and x.reopened_at is null
  returning * into w;
  if w.id is null then
    return null;
  end if;
  select p.display_name into intern
  from public.daymark_placements pl join public.daymark_profiles p on p.id = pl.intern_id
  where pl.id = r.placement_id;
  if w.signed_by is not null then
    perform private.notify(w.signed_by, 'times', 'A signed week reopened',
      'Times changed for ' || coalesce(intern, 'an intern') || ' in the week of ' || private.fmt_day(w.week_start)
        || '. Sign it again in Timesheets.', '/supervisor/timesheets');
  end if;
  perform private.audit('reopen_week', 'daymark_week_signoffs', w.id::text, null, to_jsonb(w));
  return null;
end;
$$;

create trigger daymark_day_results_reopen_write
  after insert or delete on public.daymark_day_results
  for each row execute function private.reopen_signed_week();
create trigger daymark_day_results_reopen_update
  after update on public.daymark_day_results
  for each row when ((old.counted, old.break) is distinct from (new.counted, new.break))
  execute function private.reopen_signed_week();

-- ---------------------------------------------------------------------------
-- 4. Reminders: Monday and Tuesday mornings, weeks to sign by Tuesday 5 pm.
-- ---------------------------------------------------------------------------
create or replace function private.push_kind_options()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['reminder_shift', 'reminder_break', 'reminder_clock_out', 'reminder_tomorrow', 'digest', 'announcement',
               'signoff', 'schedule', 'times', 'request', 'attendance', 'work_based', 'escalated']::text[];
$$;
alter table public.daymark_settings
  alter column push_kinds set default array['reminder_shift', 'reminder_break', 'reminder_clock_out', 'reminder_tomorrow',
    'digest', 'announcement', 'signoff', 'schedule', 'times', 'request', 'attendance', 'work_based', 'escalated']::text[];
update public.daymark_settings set push_kinds = array(select distinct k from unnest(push_kinds || array['signoff']) k order by 1)
where id = 1;

alter table public.daymark_reminders_sent drop constraint daymark_reminders_sent_kind_check;
alter table public.daymark_reminders_sent add constraint daymark_reminders_sent_kind_check
  check (kind in ('not_clocked_in', 'long_break', 'forgot_clock_out', 'shift_soon', 'clock_out', 'shift_tomorrow', 'digest',
                  'signoff'));

create or replace function private.job_signoff_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_ts timestamptz := private.clock_now();
  today date := private.darwin_today();
  last_week date := today - (extract(isodow from today)::int - 1) - 7;
  r record;
  sent integer := 0;
begin
  if not coalesce('signoff' = any (select unnest(s.push_kinds) from public.daymark_settings s where s.id = 1), false)
     or extract(isodow from today) not in (1, 2)
     or now_ts < private.darwin_at(today, time '09:00') or now_ts >= private.darwin_at(today, time '12:00') then
    return 0;
  end if;
  for r in
    select p.id as person_id, count(*)::int as weeks
    from public.daymark_profiles p
    join public.daymark_placements pl on pl.supervisor_id = p.id and pl.status in ('active', 'extended', 'target_reached')
    where p.active and p.is_supervisor
      and exists (select 1 from public.daymark_day_results d
                  where d.placement_id = pl.id and d.work_date between last_week and last_week + 6
                    and (d.counted > 0 or d.scheduled > 0))
      and not exists (select 1 from public.daymark_week_signoffs w
                      where w.placement_id = pl.id and w.week_start = last_week and w.reopened_at is null)
    group by p.id
  loop
    insert into public.daymark_reminders_sent (person_id, kind, work_date) values (r.person_id, 'signoff', today)
    on conflict do nothing;
    if found then
      perform private.notify(r.person_id, 'signoff', 'Weeks to sign',
        r.weeks || case when r.weeks = 1 then ' week' else ' weeks' end || ' to sign by Tuesday 5 pm.',
        '/supervisor/timesheets');
      sent := sent + 1;
    end if;
  end loop;
  return sent;
end;
$$;

create or replace function private.job_reminders()
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.job_day_reminders() + private.job_evening_reminders() + private.job_digest()
         + private.job_signoff_reminders();
$$;

-- ---------------------------------------------------------------------------
-- 5. Wrappers and grants
-- ---------------------------------------------------------------------------
create or replace function public.set_placement_pay(placement uuid, paid boolean, hourly_rate numeric default null)
returns void language sql security invoker set search_path = ''
as $$ select private.set_placement_pay(placement, paid, hourly_rate); $$;
create or replace function public.week_open_items(placement uuid, week_start date)
returns table (kind text, work_date date, label text)
language sql stable security invoker set search_path = ''
as $$ select * from private.week_open_items(placement, week_start); $$;
create or replace function public.sign_week(placement uuid, week_start date)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.sign_week(placement, week_start); $$;
create or replace function public.week_signoffs(from_date date, to_date date)
returns table (placement_id uuid, week_start date, signed_by_name text, signed_at timestamptz, counted_minutes integer)
language sql stable security invoker set search_path = ''
as $$ select * from private.week_signoffs(from_date, to_date); $$;
create or replace function public.signoff_export(from_date date, to_date date)
returns table (intern_name text, placement_id uuid, week_start date, work_date date, counted_minutes integer,
               break_minutes integer, paid boolean, hourly_rate numeric, amount numeric)
language sql stable security invoker set search_path = ''
as $$ select * from private.signoff_export(from_date, to_date); $$;

revoke all on function private.require_week_signer(uuid) from public, anon;
revoke all on function private.week_open_items(uuid, date) from public, anon;
revoke all on function private.sign_week(uuid, date) from public, anon;
revoke all on function private.week_signoffs(date, date) from public, anon;
revoke all on function private.signoff_export(date, date) from public, anon;
revoke all on function private.set_placement_pay(uuid, boolean, numeric) from public, anon;
revoke all on function private.reopen_signed_week() from public, anon, authenticated;
revoke all on function private.job_signoff_reminders() from public, anon, authenticated;
revoke all on function private.job_reminders() from public, anon, authenticated;
revoke all on function public.set_placement_pay(uuid, boolean, numeric) from public, anon;
revoke all on function public.week_open_items(uuid, date) from public, anon;
revoke all on function public.sign_week(uuid, date) from public, anon;
revoke all on function public.week_signoffs(date, date) from public, anon;
revoke all on function public.signoff_export(date, date) from public, anon;
grant execute on function private.require_week_signer(uuid) to authenticated;
grant execute on function private.week_open_items(uuid, date) to authenticated;
grant execute on function private.sign_week(uuid, date) to authenticated;
grant execute on function private.week_signoffs(date, date) to authenticated;
grant execute on function private.signoff_export(date, date) to authenticated;
grant execute on function private.set_placement_pay(uuid, boolean, numeric) to authenticated;
grant execute on function public.set_placement_pay(uuid, boolean, numeric) to authenticated;
grant execute on function public.week_open_items(uuid, date) to authenticated;
grant execute on function public.sign_week(uuid, date) to authenticated;
grant execute on function public.week_signoffs(date, date) to authenticated;
grant execute on function public.signoff_export(date, date) to authenticated;

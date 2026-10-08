-- 8 Oct requests (Dilip):
--   1. Before the first clock-in of a day the intern picks Full day (9–5, 8 h with break) or
--      Work-based (5 h, no break). A work-based day takes no break and, once the supervisor or admin
--      approves it, counts as the full rostered day.
--   2. Interns who forgot a step type the missing time (when they arrived, when their break ended).
--      It's a supervisor-confirmed punch: counts 0 until staff approve the attendance request.
--   3. Staff add a break inside a session.
--   4. Staff mark a rostered day absent (leave kind 'absent'): its hours stay owed.
--   5. Anyone deletes their own notifications.

-- ---------------------------------------------------------------------------
-- 1. Day kinds
-- ---------------------------------------------------------------------------
create table public.daymark_day_kinds (
  placement_id uuid not null references public.daymark_placements (id) on delete cascade,
  work_date date not null,
  kind text not null check (kind in ('full_day', 'work_based')),
  status text check (status in ('pending', 'approved', 'declined')),   -- work-based only
  decided_by uuid references public.daymark_profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (placement_id, work_date),
  constraint daymark_day_kinds_kind_status_check check ((kind = 'work_based') = (status is not null))
);
create index daymark_day_kinds_pending_idx on public.daymark_day_kinds (status) where status = 'pending';

alter table public.daymark_day_kinds enable row level security;
create policy "Day kinds follow the placement" on public.daymark_day_kinds
  for select to authenticated using ((select private.can_view_placement(placement_id)));
revoke all on table public.daymark_day_kinds from public, anon, authenticated;
grant select on table public.daymark_day_kinds to authenticated;
grant all on table public.daymark_day_kinds to service_role;

-- The intern picks today's kind; it can change until staff decide a work-based day.
create or replace function private.choose_day_kind(kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  pl public.daymark_placements%rowtype := private.live_placement(me);
  today date := private.darwin_today();
  saved public.daymark_day_kinds%rowtype;
begin
  if pl.id is null then
    raise exception 'You don''t have an active placement.' using errcode = 'P0001';
  end if;
  if kind is null or kind not in ('full_day', 'work_based') then
    raise exception 'Pick Full day or Work-based.' using errcode = '22023';
  end if;
  if exists (select 1 from public.daymark_day_kinds d
             where d.placement_id = pl.id and d.work_date = today and d.status in ('approved', 'declined')) then
    raise exception 'Today''s day type is already decided.' using errcode = 'P0001';
  end if;

  insert into public.daymark_day_kinds (placement_id, work_date, kind, status, created_at)
  values (pl.id, today, kind, case when kind = 'work_based' then 'pending' end, private.clock_now())
  on conflict (placement_id, work_date) do update set kind = excluded.kind, status = excluded.status
  returning * into saved;

  if kind = 'work_based' then
    perform private.notify(pl.supervisor_id, 'work_based', 'Work-based day to approve',
      (select x.display_name from public.daymark_profiles x where x.id = me) || ' is doing a work-based day on '
        || private.fmt_day(today) || '. Approve it to count the full day.', '/supervisor/approvals');
  end if;
  perform private.recompute_day(pl.id, today);
  return to_jsonb(saved);
end;
$$;

create or replace function private.decide_day_kind(placement uuid, work_date date, decision text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype := private.require_placement_manager(placement);
  saved public.daymark_day_kinds%rowtype;
begin
  if decision is null or decision not in ('approve', 'decline') then
    raise exception 'Choose approve or decline.' using errcode = '22023';
  end if;
  update public.daymark_day_kinds d
  set status = case decision when 'approve' then 'approved' else 'declined' end,
      decided_by = (select auth.uid()), decided_at = private.clock_now()
  where d.placement_id = placement and d.work_date = decide_day_kind.work_date and d.status = 'pending'
  returning * into saved;
  if not found then
    raise exception 'That work-based day isn''t waiting for a decision.' using errcode = 'P0001';
  end if;
  perform private.recompute_day(placement, work_date);
  perform private.audit('decide_day_kind', 'daymark_placements', placement::text, null,
    jsonb_build_object('work_date', work_date, 'status', saved.status));
  perform private.notify(pl.intern_id, 'work_based',
    case decision when 'approve' then 'Work-based day approved' else 'Work-based day declined' end,
    private.fmt_day(work_date) || case decision when 'approve' then ' counts as a full day.'
                                   else ' counts the hours you worked.' end, '/clock/progress');
  return to_jsonb(saved);
end;
$$;

-- compute_day: a work-based day takes no break; approved, it counts the full rostered day.
create or replace function private.compute_day(placement uuid, work_date date)
returns public.daymark_day_results
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.daymark_day_results;
  st public.daymark_settings%rowtype;
  sd public.daymark_scheduled_days%rowtype;
  dk public.daymark_day_kinds%rowtype;
  assigned_break integer;
  n_shifts integer;
  first_in timestamptz;
  last_out timestamptz;
  last_open boolean;
  last_auto boolean;
  raw_seconds numeric;
  gap_minutes integer;
  approved integer;
  staff_edited boolean;
begin
  select * into st from public.daymark_settings s where s.id = 1;
  select p.break_minutes into assigned_break from public.daymark_placements p where p.id = placement;
  select * into sd from public.daymark_scheduled_days d
  where d.placement_id = placement and d.work_date = compute_day.work_date and d.status = 'scheduled';
  select * into dk from public.daymark_day_kinds k where k.placement_id = placement and k.work_date = compute_day.work_date;

  select count(*), min(s.clock_in_at)
  into n_shifts, first_in
  from public.daymark_shifts s
  where s.placement_id = placement and s.work_date = compute_day.work_date;

  select s.clock_out_at, s.clock_out_at is null, s.auto_closed
  into last_out, last_open, last_auto
  from public.daymark_shifts s
  where s.placement_id = placement and s.work_date = compute_day.work_date
  order by s.clock_in_at desc
  limit 1;

  with c as (
    select s.clock_in_at, s.clock_out_at,
           s.clock_in_at - lag(s.clock_out_at) over (order by s.clock_in_at) as gap
    from public.daymark_shifts s
    where s.placement_id = placement and s.work_date = compute_day.work_date
      and s.clock_out_at is not null and not s.auto_closed and not s.unverified
  )
  select coalesce(sum(extract(epoch from c.clock_out_at - c.clock_in_at)), 0),
         coalesce(floor(sum(extract(epoch from greatest(c.gap, interval '0'))) / 60), 0)::integer
  into raw_seconds, gap_minutes
  from c;

  r.placement_id := placement;
  r.work_date := work_date;
  r.raw := floor(raw_seconds / 60)::integer;                                        -- R5.4.1
  -- R5.4.2: breaks taken are unpaid gaps, topped up to the assigned break; a work-based day has none.
  r.break := case when dk.kind = 'work_based' then 0
                  when r.raw > st.break_threshold_minutes
                  then greatest(0, coalesce(assigned_break, st.break_minutes) - gap_minutes) else 0 end;
  r.worked := r.raw - r.break;                                                      -- R5.4.3
  r.countable := least(r.worked, st.max_day_minutes);                               -- R5.4.4
  r.over_max := greatest(0, r.worked - st.max_day_minutes);                         -- R5.4.4
  r.scheduled := coalesce(sd.planned_minutes, 0);                                   -- R5.4.5
  r.base := least(r.countable, r.scheduled);                                        -- R5.4.6
  r.overtime := greatest(0, r.countable - r.scheduled);                             -- R5.4.7

  select q.approved_minutes into approved
  from public.daymark_requests q
  where q.placement_id = placement and q.type = 'overtime' and q.dates[1] = compute_day.work_date
    and q.status = 'approved';
  r.approved_ot := least(coalesce(approved, 0), r.overtime);                        -- R5.4.8
  select exists (
    select 1 from public.daymark_shifts s
    join public.daymark_punches x on x.id in (s.in_punch_id, s.out_punch_id)
    where s.placement_id = placement and s.work_date = compute_day.work_date and x.source = 'staff_edit'
  ) into staff_edited;
  if staff_edited then
    r.approved_ot := r.overtime;                                                    -- D24
  end if;
  -- An approved work-based day with time worked counts the whole rostered day (Dilip, 8 Oct).
  if dk.status = 'approved' and r.raw > 0 then
    r.base := greatest(r.base, r.scheduled);
  end if;
  r.counted := r.base + r.approved_ot;                                              -- R5.4.9

  r.closed := private.clock_now() >= private.darwin_at(work_date, '19:00');          -- R5.4.10
  r.short := case when r.closed then greatest(0, r.scheduled - r.base) end;         -- R5.4.10
  r.late := r.scheduled > 0 and first_in is not null
            and first_in > private.darwin_at(work_date, sd.start_time)
                           + make_interval(mins => st.grace_minutes);               -- R5.4.12
  r.left_early := r.closed and r.scheduled > 0 and n_shifts > 0 and not last_open and not last_auto
                  and last_out < private.darwin_at(work_date, sd.end_time) and r.short > 0
                  and dk.kind is distinct from 'work_based';                        -- R5.4.13
  r.no_show := r.closed and r.scheduled > 0 and n_shifts = 0;                       -- R5.5.2
  r.auto_closed := coalesce(last_auto, false);
  r.unscheduled := r.scheduled = 0 and n_shifts > 0;
  r.unverified := exists (
    select 1 from public.daymark_shifts s
    where s.placement_id = placement and s.work_date = compute_day.work_date and s.unverified
  );
  r.computed_at := private.clock_now();
  return r;
end;
$$;

-- The first clock-in of a day needs today's kind picked (the app asks above the button).
create or replace function private.require_day_kind(person uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.daymark_day_kinds d
    where d.placement_id = (private.live_placement(person)).id and d.work_date = private.darwin_today()
  ) then
    raise exception 'Pick Full day or Work-based before you clock in.' using errcode = 'P0001', hint = 'day_kind';
  end if;
end;
$$;

create or replace function private.start_clock(event_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  reason text;
  gestures text[] := array[
    'Hold up three fingers', 'Give a thumbs up', 'Touch your left ear', 'Touch your right ear',
    'Hold up two fingers', 'Put your hand flat under your chin', 'Point at the camera', 'Wave with an open hand'
  ];
  row public.daymark_clock_challenges%rowtype;
begin
  reason := private.clock_block_reason(me, start_clock.event_type, private.clock_now());
  if reason is not null then
    raise exception '%', reason using errcode = 'P0001';
  end if;
  perform private.require_clocking_consent(me);
  if start_clock.event_type = 'shift_in' then
    perform private.require_day_kind(me);
  end if;

  insert into public.daymark_clock_challenges (person_id, event_type, gesture, issued_at, expires_at)
  values (me, start_clock.event_type, gestures[1 + floor(random() * array_length(gestures, 1))::int],
          private.clock_now(), private.clock_now() + interval '90 seconds')
  returning * into row;

  return jsonb_build_object(
    'challenge_id', row.id, 'event_type', row.event_type, 'gesture', row.gesture,
    'expires_at', row.expires_at, 'photo_path', me || '/' || row.id || '.jpg'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Typed-in times: the intern forgot to clock in or to end a break. The time is a punch waiting
-- for the supervisor (counts 0 until the attendance request is approved), and staff are told.
-- ---------------------------------------------------------------------------
create or replace function private.report_missed_time(event text, at_time time, note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  pl public.daymark_placements%rowtype := private.live_placement(me);
  ts timestamptz;
  last_at timestamptz;
  punch uuid;
  clean text := nullif(btrim(note), '');
  what text;
  name text := (select x.display_name from public.daymark_profiles x where x.id = me);
begin
  if not exists (select 1 from public.daymark_profiles x where x.id = me and x.is_intern and x.active) then
    raise exception 'Only interns clock in.' using errcode = '42501';
  end if;
  if pl.id is null then
    raise exception 'You don''t have an active placement.' using errcode = 'P0001';
  end if;
  if event is null or event not in ('shift_in', 'break_end') then
    raise exception 'Pick when you arrived or when your break ended.' using errcode = '22023';
  end if;
  if at_time is null then
    raise exception 'Enter the time.' using errcode = '22023';
  end if;
  if char_length(coalesce(clean, '')) > 200 then
    raise exception 'Keep the note under 200 characters.' using errcode = '22023';
  end if;
  perform private.require_clocking_consent(me);
  if event = 'shift_in' then
    perform private.require_day_kind(me);
  end if;

  ts := private.darwin_at(private.darwin_today(), at_time);
  if ts > private.clock_now() then
    raise exception 'That time hasn''t happened yet.' using errcode = '22023';
  end if;
  select max(x.occurred_at) into last_at from public.daymark_punches x
  where x.user_id = me and x.event_type in ('shift_in', 'shift_out');
  if last_at is not null and ts <= last_at then
    raise exception 'Pick a time after your last clock (%).', private.fmt_clock((last_at at time zone 'Australia/Darwin')::time)
      using errcode = '22023';
  end if;

  -- Same rules as a live clock at that time (sequence, placement dates, capacity); counts once confirmed.
  insert into public.daymark_punches (user_id, event_type, is_break, source, occurred_at, verification_method, user_agent)
  values (me, 'shift_in', event = 'break_end', 'supervisor', ts, 'supervisor', private.request_user_agent())
  returning id into punch;

  what := case event when 'shift_in' then 'arrived at ' else 'ended their break at ' end || private.fmt_clock(at_time);
  insert into public.daymark_requests (placement_id, intern_id, type, payload, reason)
  values (pl.id, me, 'attendance', jsonb_build_object('punch_id', punch, 'event_type', 'shift_in'),
          'Typed in: ' || what || coalesce('. ' || clean, ''));

  perform private.notify(pl.supervisor_id, 'attendance', name || ' typed in a time',
    name || ' ' || what || ' on ' || private.fmt_day(private.darwin_today()) || '. Confirm it in Approvals.',
    '/supervisor/approvals');
  perform private.notify_admins('attendance', name || ' typed in a time',
    name || ' ' || what || ' on ' || private.fmt_day(private.darwin_today()) || '.', '/admin/requests');
  return jsonb_build_object('punch_id', punch, 'occurred_at', ts);
end;
$$;

create or replace function private.request_label(type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case type
    when 'swap' then 'swap' when 'shift_change' then 'shift change' when 'extra_day' then 'extra day'
    when 'leave' then 'leave' when 'punch_fix' then 'punch fix' when 'overtime' then 'overtime'
    when 'pattern_change' then 'pattern change' when 'attendance' then 'typed-in time'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Staff add a break inside a closed session (splits it in two).
-- ---------------------------------------------------------------------------
create or replace function private.staff_add_break(placement uuid, work_date date, break_start time, break_end time, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype := private.require_placement_manager(placement);
  me uuid := (select auth.uid());
  clean text := btrim(reason);
  ts_start timestamptz;
  ts_end timestamptz;
begin
  if clean is null or char_length(clean) not between 5 and 200 then
    raise exception 'Give a reason of 5 to 200 characters.' using errcode = '22023';
  end if;
  if break_start is null or break_end is null or break_end <= break_start then
    raise exception 'The break has to end after it starts.' using errcode = '22023';
  end if;
  ts_start := private.darwin_at(work_date, break_start);
  ts_end := private.darwin_at(work_date, break_end);
  if ts_end > private.clock_now() then
    raise exception 'Breaks are added for times in the past.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.daymark_shifts s
    where s.placement_id = pl.id and s.work_date = staff_add_break.work_date
      and s.clock_in_at < ts_start and s.clock_out_at > ts_end
  ) then
    raise exception 'Pick a break inside one of the sessions on %.', private.fmt_day(work_date) using errcode = '22023';
  end if;

  insert into public.daymark_punches (user_id, placement_id, event_type, is_break, occurred_at, source,
                                      verification_method, confirmed_by, confirmed_at)
  values (pl.intern_id, pl.id, 'shift_out', true, ts_start, 'staff_edit', 'staff_edit', me, private.clock_now()),
         (pl.intern_id, pl.id, 'shift_in', true, ts_end, 'staff_edit', 'staff_edit', me, private.clock_now());

  perform private.audit('staff_add_break', 'daymark_placements', pl.id::text, null,
    jsonb_build_object('work_date', work_date, 'start', break_start, 'end', break_end, 'reason', clean));
  perform private.notify(pl.intern_id, 'times', 'A break was added',
    coalesce((select x.display_name from public.daymark_profiles x where x.id = me), 'Your supervisor')
      || ' added a break ' || private.fmt_clock(break_start) || '–' || private.fmt_clock(break_end)
      || ' on ' || private.fmt_day(work_date) || '. Reason: ' || clean, '/clock/schedule');
  return jsonb_build_object('start', ts_start, 'end', ts_end);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Absent: staff mark a rostered day absent. It's leave of kind 'absent', so its hours stay owed.
-- ---------------------------------------------------------------------------
alter table public.daymark_scheduled_days drop constraint daymark_scheduled_days_leave_kind_check;
alter table public.daymark_scheduled_days add constraint daymark_scheduled_days_leave_kind_check
  check (leave_kind in ('sick', 'personal', 'absent'));

create or replace function private.staff_mark_absent(day uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.daymark_scheduled_days%rowtype;
  pl public.daymark_placements%rowtype;
  clean text := btrim(reason);
begin
  select * into d from public.daymark_scheduled_days x where x.id = day for update;
  if not found then
    raise exception 'That roster day is gone.' using errcode = 'P0002';
  end if;
  pl := private.require_placement_manager(d.placement_id);
  if d.status <> 'scheduled' then
    raise exception 'Only a rostered day can be marked absent.' using errcode = '22023';
  end if;
  if clean is null or char_length(clean) not between 3 and 200 then
    raise exception 'Give a reason of 3 to 200 characters.' using errcode = '22023';
  end if;

  update public.daymark_scheduled_days x set status = 'leave', leave_kind = 'absent', updated_at = private.clock_now()
  where x.id = d.id;
  insert into public.daymark_schedule_history (scheduled_day_id, before, after, changed_by, changed_at)
  values (d.id, jsonb_build_object('status', d.status),
          jsonb_build_object('status', 'leave', 'leave_kind', 'absent', 'reason', clean),
          (select auth.uid()), private.clock_now());
  perform private.audit('staff_mark_absent', 'daymark_scheduled_days', d.id::text,
    jsonb_build_object('work_date', d.work_date, 'status', d.status), jsonb_build_object('reason', clean));
  perform private.notify(pl.intern_id, 'schedule', 'Marked absent',
    private.fmt_day(d.work_date) || ' is marked absent: ' || clean
      || '. Those hours are still owed; pick catch-up days on Today.', '/clock');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Delete your own notifications (all, or the ones picked).
-- ---------------------------------------------------------------------------
create or replace function private.delete_my_notifications(ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.daymark_notifications x
  where x.person_id = (select auth.uid()) and (ids is null or x.id = any (ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers and grants
-- ---------------------------------------------------------------------------
create or replace function public.choose_day_kind(kind text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.choose_day_kind(kind); $$;

create or replace function public.decide_day_kind(placement uuid, work_date date, decision text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.decide_day_kind(placement, work_date, decision); $$;

create or replace function public.report_missed_time(event text, at_time time, note text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.report_missed_time(event, at_time, note); $$;

create or replace function public.staff_add_break(placement uuid, work_date date, break_start time, break_end time, reason text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.staff_add_break(placement, work_date, break_start, break_end, reason); $$;

create or replace function public.staff_mark_absent(day uuid, reason text)
returns void language sql security invoker set search_path = ''
as $$ select private.staff_mark_absent(day, reason); $$;

create or replace function public.delete_my_notifications(ids uuid[] default null)
returns integer language sql security invoker set search_path = ''
as $$ select private.delete_my_notifications(ids); $$;

revoke all on function private.choose_day_kind(text) from public, anon;
revoke all on function private.decide_day_kind(uuid, date, text) from public, anon;
revoke all on function private.require_day_kind(uuid) from public, anon;
revoke all on function private.report_missed_time(text, time, text) from public, anon;
revoke all on function private.staff_add_break(uuid, date, time, time, text) from public, anon;
revoke all on function private.staff_mark_absent(uuid, text) from public, anon;
revoke all on function private.delete_my_notifications(uuid[]) from public, anon;
revoke all on function public.choose_day_kind(text) from public, anon;
revoke all on function public.decide_day_kind(uuid, date, text) from public, anon;
revoke all on function public.report_missed_time(text, time, text) from public, anon;
revoke all on function public.staff_add_break(uuid, date, time, time, text) from public, anon;
revoke all on function public.staff_mark_absent(uuid, text) from public, anon;
revoke all on function public.delete_my_notifications(uuid[]) from public, anon;

grant execute on function private.choose_day_kind(text) to authenticated;
grant execute on function private.decide_day_kind(uuid, date, text) to authenticated;
grant execute on function private.require_day_kind(uuid) to authenticated;
grant execute on function private.report_missed_time(text, time, text) to authenticated;
grant execute on function private.staff_add_break(uuid, date, time, time, text) to authenticated;
grant execute on function private.staff_mark_absent(uuid, text) to authenticated;
grant execute on function private.delete_my_notifications(uuid[]) to authenticated;
grant execute on function public.choose_day_kind(text) to authenticated;
grant execute on function public.decide_day_kind(uuid, date, text) to authenticated;
grant execute on function public.report_missed_time(text, time, text) to authenticated;
grant execute on function public.staff_add_break(uuid, date, time, time, text) to authenticated;
grant execute on function public.staff_mark_absent(uuid, text) to authenticated;
grant execute on function public.delete_my_notifications(uuid[]) to authenticated;

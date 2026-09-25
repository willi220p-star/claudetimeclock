-- Phase 5: the exact server verdict before submit (§8.9 preview_request, §11.1 principle 3),
-- the supervisor-confirmation clocking path (security review §2.7, D6), and escalation after
-- 72 hours (§8.10, R5.12.1).

-- Capacity lines for the days a request adds. Interns never see a 4th spot as possible (R5.3.3).
create or replace function private.preview_capacity(site uuid, placement uuid, new_dates date[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (select * from public.daymark_sites x where x.id = site),
  staff as (select private.is_staff() as yes)
  select coalesce(jsonb_agg(jsonb_build_object(
      'date', d.day,
      'headcount', case when staff.yes then n.cnt else least(n.cnt, s.standard_capacity) end,
      'after', case when staff.yes then n.cnt + 1 else least(n.cnt + 1, s.standard_capacity) end,
      'label', case
        when not staff.yes and n.cnt + 1 > s.standard_capacity then 'Full — request an extra spot (needs admin approval)'
        when not staff.yes then 'office ' || least(n.cnt, s.standard_capacity) || '/' || s.standard_capacity || ' → '
          || case when n.cnt + 1 >= s.standard_capacity then 'Full' else (n.cnt + 1) || '/' || s.standard_capacity end
        else 'office ' || n.cnt || '/' || s.standard_capacity || ' → ' || (n.cnt + 1) || '/' || s.standard_capacity
          || case when n.cnt + 1 > s.standard_capacity then ' (extra spot)' else '' end
      end
    ) order by d.day), '[]')
  from unnest(new_dates) d(day)
  cross join s
  cross join staff
  cross join lateral (
    select count(*)::integer as cnt from public.daymark_scheduled_days x
    where x.site_id = site and x.work_date = d.day and x.status = 'scheduled' and x.placement_id <> placement
  ) n;
$$;

create or replace function private.preview_request(req jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  r public.daymark_requests%rowtype;
  pl public.daymark_placements%rowtype;
  v record;
  p jsonb;
  day public.daymark_scheduled_days%rowtype;
  effects text[] := '{}';
  d date;
  s time;
  e time;
begin
  if req ? 'id' then
    select * into r from public.daymark_requests x where x.id = (req ->> 'id')::uuid;
    if not found or not private.can_view_placement(r.placement_id) then
      raise exception 'That request doesn''t exist.' using errcode = '42501';
    end if;
  else
    pl := private.live_placement(me);
    if pl.id is null then
      return jsonb_build_object('ok', false, 'message', 'You don''t have an active placement, so you can''t make requests.',
        'needs_extra_spot', false, 'dates', '[]'::jsonb, 'effects', '[]'::jsonb, 'capacity', '[]'::jsonb);
    end if;
    r.id := gen_random_uuid();
    r.placement_id := pl.id;
    r.intern_id := me;
    r.type := req ->> 'type';
    r.status := 'pending_supervisor';
    r.payload := coalesce(req -> 'payload', '{}');
    r.dates := '{}';
    r.reason := req ->> 'reason';
    r.created_at := private.clock_now();
  end if;
  select * into pl from public.daymark_placements x where x.id = r.placement_id;

  begin
    select * into v from private.check_request(r);
  exception when others then
    return jsonb_build_object('ok', false, 'message', 'Check the details and try again.', 'needs_extra_spot', false,
      'dates', '[]'::jsonb, 'effects', '[]'::jsonb, 'capacity', '[]'::jsonb);
  end;

  if v.ok then
    p := jsonb_strip_nulls(r.payload);
    case r.type
    when 'swap' then
      select * into day from public.daymark_scheduled_days x where x.id = (p ->> 'scheduled_day_id')::uuid;
      s := coalesce((p ->> 'start')::time, day.start_time);
      e := coalesce((p ->> 'end')::time, day.end_time);
      effects := array[private.fmt_day(day.work_date) || ' moves to ' || private.fmt_day((p ->> 'new_date')::date)
        || ', ' || private.fmt_clock(s) || '–' || private.fmt_clock(e)];
    when 'shift_change' then
      select * into day from public.daymark_scheduled_days x where x.id = (p ->> 'scheduled_day_id')::uuid;
      effects := array[private.fmt_day(day.work_date) || ' becomes ' || private.fmt_clock((p ->> 'start')::time) || '–'
        || private.fmt_clock((p ->> 'end')::time) || ' (was ' || private.fmt_clock(day.start_time) || '–'
        || private.fmt_clock(day.end_time) || ')'];
    when 'extra_day' then
      s := (p ->> 'start')::time;
      e := (p ->> 'end')::time;
      effects := array['Adds ' || private.fmt_day((p ->> 'date')::date) || ', ' || private.fmt_clock(s) || '–'
        || private.fmt_clock(e) || ' (' || private.fmt_duration(
          (extract(epoch from e - s) / 60)::integer - case when e - s > interval '300 minutes' then 30 else 0 end) || ')'];
    when 'leave' then
      for d in select x::date from jsonb_array_elements_text(p -> 'dates') x order by 1 loop
        effects := effects || (private.fmt_day(d) || ' becomes ' || (p ->> 'kind') || ' leave (the hours stay owed)');
      end loop;
    when 'punch_fix' then
      effects := array['On ' || private.fmt_day((p ->> 'date')::date)
        || coalesce(' your clock-in becomes ' || private.fmt_clock((p ->> 'clock_in')::time), '')
        || case when p ? 'clock_in' and p ? 'clock_out' then ' and' else '' end
        || coalesce(' your clock-out becomes ' || private.fmt_clock((p ->> 'clock_out')::time), '')];
    when 'overtime' then
      effects := array['Counts up to ' || private.fmt_duration(coalesce(r.requested_minutes, 0)) || ' of overtime on '
        || private.fmt_day(r.dates[1])];
    when 'pattern_change' then
      effects := array['From ' || private.fmt_day((p ->> 'effective_from')::date) || ' your usual days become '
        || (select string_agg(to_char(date '2026-09-27' + x.weekday, 'Dy') || ' ' || private.fmt_clock(x.start_time)
                              || '–' || private.fmt_clock(x.end_time), ', ' order by x.weekday)
            from private.parse_pattern(p -> 'pattern') x)];
    when 'attendance' then
      effects := array['Confirms the ' || case p ->> 'event_type' when 'shift_out' then 'clock-out' else 'clock-in' end
        || ' at ' || private.fmt_clock(((select x.occurred_at from public.daymark_punches x
                                         where x.id = (p ->> 'punch_id')::uuid) at time zone 'Australia/Darwin')::time)];
    else
      null;
    end case;
  end if;

  return jsonb_build_object(
    'ok', v.ok,
    'message', v.message,
    'needs_extra_spot', coalesce(v.needs_extra_spot, false),
    'dates', to_jsonb(coalesce(v.dates, '{}')),
    'effects', to_jsonb(effects),
    'capacity', case when v.ok then private.preview_capacity(pl.site_id, pl.id, coalesce(v.new_dates, '{}')) else '[]'::jsonb end
  );
end;
$$;

-- Review §2.7: without location/selfie (or when GPS fails), the intern asks their supervisor to
-- confirm them. The punch still obeys the window, sequence and placement rules; it counts only
-- once the supervisor approves the attendance request the same day.
create or replace function private.request_supervisor_confirmation(event_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  pl public.daymark_placements := private.live_placement(me);
  punch uuid;
  saved public.daymark_requests%rowtype;
begin
  if not exists (select 1 from public.daymark_profiles x where x.id = me and x.is_intern and x.active) then
    raise exception 'Only interns clock in.' using errcode = '42501';
  end if;
  if request_supervisor_confirmation.event_type not in ('shift_in', 'shift_out') then
    raise exception 'Pick clock in or clock out.' using errcode = '22023';
  end if;

  insert into public.daymark_punches (user_id, event_type, source, occurred_at, verification_method, user_agent)
  values (me, request_supervisor_confirmation.event_type, 'supervisor', private.clock_now(), 'supervisor', private.request_user_agent())
  returning id into punch;

  insert into public.daymark_requests (placement_id, intern_id, type, payload, reason)
  values (pl.id, me, 'attendance', jsonb_build_object('punch_id', punch, 'event_type', request_supervisor_confirmation.event_type),
          'Supervisor confirmation')
  returning * into saved;

  perform private.notify(pl.supervisor_id, 'attendance', 'Confirm ' || (select display_name from public.daymark_profiles where id = me) || ' is in',
    'They ' || case request_supervisor_confirmation.event_type when 'shift_in' then 'clocked in' else 'clocked out' end
      || ' without location or a selfie. Confirm today if you can see them at the office.', '/supervisor/approvals');
  return jsonb_build_object('punch_id', punch, 'request', to_jsonb(saved));
end;
$$;

-- §8.10 hourly, idempotent: flag requests pending with a supervisor for too long; tell admins once.
create or replace function private.job_escalate()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    update public.daymark_requests x
    set escalated_at = private.clock_now()
    where x.status = 'pending_supervisor' and x.escalated_at is null
      and x.created_at < private.clock_now()
          - make_interval(hours => (select s.escalation_hours from public.daymark_settings s where s.id = 1))
    returning x.id, x.type, x.intern_id, x.dates
  loop
    perform private.notify_admins('escalated', 'A ' || private.request_label(r.type) || ' request is waiting',
      (select display_name from public.daymark_profiles where id = r.intern_id) || '''s request ('
        || private.fmt_days(r.dates) || ') has waited over 72 hours. You can decide it now.', '/admin/requests');
    n := n + 1;
  end loop;
  return jsonb_build_object('escalated', n);
end;
$$;

create or replace function private.run_job(name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.require_admin();
  result := case run_job.name
    when 'auto_close' then private.job_auto_close()
    when 'day_close' then private.job_day_close()
    when 'reconcile' then private.job_reconcile()
    when 'escalate' then private.job_escalate()
    when 'retention_reminders' then jsonb_build_object('reminders', private.job_retention_reminders())
    when 'clock_guard' then jsonb_build_object('fake_clock', private.job_clock_guard())
  end;
  if result is null then
    raise exception 'Pick a job: auto_close, day_close, reconcile, escalate, retention_reminders or clock_guard.'
      using errcode = '22023';
  end if;
  perform private.audit('run_job', 'cron.job', run_job.name, null, result);
  return result;
end;
$$;

create or replace function public.preview_request(req jsonb)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.preview_request(req); $$;

create or replace function public.request_supervisor_confirmation(event_type text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.request_supervisor_confirmation(event_type); $$;

revoke all on function private.preview_capacity(uuid, uuid, date[]) from public, anon;
revoke all on function private.preview_request(jsonb) from public, anon;
revoke all on function private.request_supervisor_confirmation(text) from public, anon;
revoke all on function private.job_escalate() from public, anon, authenticated;
revoke all on function public.preview_request(jsonb) from public, anon;
revoke all on function public.request_supervisor_confirmation(text) from public, anon;
grant execute on function private.preview_capacity(uuid, uuid, date[]) to authenticated;
grant execute on function private.preview_request(jsonb) to authenticated;
grant execute on function private.request_supervisor_confirmation(text) to authenticated;
grant execute on function public.preview_request(jsonb) to authenticated;
grant execute on function public.request_supervisor_confirmation(text) to authenticated;

select cron.schedule('daymark-escalate', '0 * * * *', 'select private.job_escalate()');
select cron.schedule('daymark-retention-reminders', '31 16 * * *', 'select private.job_retention_reminders()');  -- 02:01 Darwin
select cron.schedule('daymark-clock-guard', '32 16 * * *', 'select private.job_clock_guard()');                -- 02:02 Darwin

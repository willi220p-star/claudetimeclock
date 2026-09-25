-- Phase 5: the request state machine (§9.3) and the effects of final approval (§9.2).
--   pending_supervisor ──approve──▶ approved, or pending_admin when an extra spot (R5.3.4) or the
--                                    punch-fix limit (review rule 14) needs the admin
--   pending_* ──decline (note)──▶ declined        pending_* ──intern cancel──▶ cancelled
--   pending_admin ──admin approve──▶ approved     the admin may decide any pending step
-- Every step re-runs the validation under the capacity locks; nothing is automatic (R5.12.2).

create or replace function private.request_label(type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case type
    when 'swap' then 'swap' when 'shift_change' then 'shift change' when 'extra_day' then 'extra day'
    when 'leave' then 'leave' when 'punch_fix' then 'punch fix' when 'overtime' then 'overtime'
    when 'pattern_change' then 'pattern change' when 'attendance' then 'supervisor confirmation'
  end;
$$;

create or replace function private.notify_admins(kind text, title text, body text, link text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.daymark_notifications (person_id, kind, title, body, link, created_at)
  select p.id, kind, title, coalesce(body, ''), link, private.clock_now()
  from public.daymark_profiles p
  where p.is_admin and p.active and p.id is distinct from (select auth.uid());
$$;

-- The effect of the final approval, in the caller's transaction (§9.2). allow_extra is true only
-- when the admin approved, so a 4th spot needs the admin (R5.3.4, R5.3.7).
create or replace function private.apply_request(r public.daymark_requests, actor uuid, allow_extra boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p jsonb := jsonb_strip_nulls(r.payload);
  day public.daymark_scheduled_days%rowtype;
  now_ts timestamptz := private.clock_now();
  new_id uuid;
  ver uuid;
  d date;
begin
  case r.type
  when 'swap' then
    select * into day from public.daymark_scheduled_days x where x.id = (p ->> 'scheduled_day_id')::uuid for update;
    update public.daymark_scheduled_days x set status = 'moved', updated_at = now_ts where x.id = day.id;
    new_id := private.add_scheduled_day(r.placement_id, (p ->> 'new_date')::date,
      coalesce((p ->> 'start')::time, day.start_time), coalesce((p ->> 'end')::time, day.end_time), 'swap', r.id, allow_extra);
    insert into public.daymark_schedule_history (scheduled_day_id, before, after, changed_by, request_id, changed_at)
    values (day.id, jsonb_build_object('status', day.status),
            jsonb_build_object('status', 'moved', 'moved_to', p ->> 'new_date', 'new_day_id', new_id), actor, r.id, now_ts);
  when 'shift_change' then
    select * into day from public.daymark_scheduled_days x where x.id = (p ->> 'scheduled_day_id')::uuid for update;
    update public.daymark_scheduled_days x
    set start_time = (p ->> 'start')::time, end_time = (p ->> 'end')::time, source = 'shift_change',
        origin_request_id = r.id, updated_at = now_ts
    where x.id = day.id;
    insert into public.daymark_schedule_history (scheduled_day_id, before, after, changed_by, request_id, changed_at)
    values (day.id, jsonb_build_object('start_time', day.start_time, 'end_time', day.end_time, 'source', day.source),
            jsonb_build_object('start_time', (p ->> 'start')::time, 'end_time', (p ->> 'end')::time, 'source', 'shift_change'),
            actor, r.id, now_ts);
  when 'extra_day' then
    perform private.add_scheduled_day(r.placement_id, (p ->> 'date')::date, (p ->> 'start')::time, (p ->> 'end')::time,
      'extra_day', r.id, allow_extra);
  when 'leave' then                                                      -- hours stay owed (R5.6.4)
    with changed as (
      update public.daymark_scheduled_days x
      set status = 'leave', leave_kind = p ->> 'kind', updated_at = now_ts
      where x.placement_id = r.placement_id and x.work_date = any (r.dates) and x.status = 'scheduled'
      returning x.id
    )
    insert into public.daymark_schedule_history (scheduled_day_id, before, after, changed_by, request_id, changed_at)
    select c.id, '{"status":"scheduled"}', jsonb_build_object('status', 'leave', 'leave_kind', p ->> 'kind'), actor, r.id, now_ts
    from changed c;
  when 'punch_fix' then                                                  -- originals are kept
    d := (p ->> 'date')::date;
    insert into public.daymark_punches (user_id, placement_id, event_type, occurred_at, source, verification_method, replaces_punch_id)
    select r.intern_id, r.placement_id, x.event_type, private.darwin_at(d, x.t), 'punch_fix', 'punch_fix', x.replaces
    from (values ('shift_in', (p ->> 'clock_in')::time, (p ->> 'replaces_in_punch_id')::uuid),
                 ('shift_out', (p ->> 'clock_out')::time, (p ->> 'replaces_out_punch_id')::uuid)) x (event_type, t, replaces)
    where x.t is not null
    order by x.t;
    perform private.audit('punch_fix', 'daymark_requests', r.id::text, null, p);
  when 'pattern_change' then                                             -- §8.6
    d := (p ->> 'effective_from')::date;
    delete from public.daymark_pattern_versions v where v.placement_id = r.placement_id and v.effective_from = d;
    insert into public.daymark_pattern_versions (placement_id, effective_from, request_id, created_by)
    values (r.placement_id, d, r.id, actor) returning id into ver;
    insert into public.daymark_pattern_days (pattern_version_id, weekday, start_time, end_time)
    select ver, x.weekday, x.start_time, x.end_time from private.parse_pattern(p -> 'pattern') x;
    perform private.regenerate(r.placement_id, d, allow_extra);
  when 'attendance' then                                                 -- review §2.7
    update public.daymark_punches x set confirmed_by = actor, confirmed_at = now_ts
    where x.id = (p ->> 'punch_id')::uuid;
  when 'overtime' then
    null;                                                                -- approved_minutes is the effect (R5.4.8)
  end case;
end;
$$;

create or replace function private.create_request(type text, payload jsonb, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  pl public.daymark_placements;
  saved public.daymark_requests%rowtype;
  label text := private.request_label(create_request.type);
begin
  if not exists (select 1 from public.daymark_profiles x where x.id = me and x.is_intern and x.active) then
    raise exception 'Only interns make requests.' using errcode = '42501';
  end if;
  if create_request.type = 'overtime' then
    raise exception 'Overtime requests are made for you when a day closes. You can add a reason to one.' using errcode = '22023';
  end if;
  if create_request.type = 'attendance' then
    raise exception 'To clock in without location or a selfie, ask your supervisor to confirm you instead.' using errcode = '22023';
  end if;
  pl := private.live_placement(me);
  if pl.id is null then
    raise exception 'You don''t have an active placement, so you can''t make requests.' using errcode = 'P0001';
  end if;
  if char_length(reason) > 1000 then
    raise exception 'Keep the reason under 1,000 characters.' using errcode = '22023';
  end if;

  insert into public.daymark_requests (placement_id, intern_id, type, payload, reason)
  values (pl.id, me, create_request.type, jsonb_strip_nulls(coalesce(payload, '{}')), nullif(btrim(reason), ''))
  returning * into saved;                                                -- validated by daymark_requests_validate

  perform private.audit('create_request', 'daymark_requests', saved.id::text, null, to_jsonb(saved));
  perform private.notify(pl.supervisor_id, 'request', 'New ' || label || ' request',
    (select x.display_name from public.daymark_profiles x where x.id = me) || ' asked for a ' || label
      || ' (' || private.fmt_days(saved.dates) || ').', '/supervisor/approvals');
  return to_jsonb(saved);
end;
$$;

create or replace function private.cancel_request(request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  r public.daymark_requests%rowtype;
  before_row jsonb;
  label text;
begin
  select * into r from public.daymark_requests x where x.id = request_id for update;
  if not found or r.intern_id is distinct from me then
    raise exception 'You can only cancel your own requests.' using errcode = '42501';
  end if;
  if r.status not in ('pending_supervisor', 'pending_admin') then
    raise exception 'Only pending requests can be cancelled.' using errcode = 'P0001';
  end if;
  if r.type = 'overtime' then
    raise exception 'Overtime requests can''t be cancelled. Your supervisor will decide.' using errcode = 'P0001';
  end if;
  before_row := to_jsonb(r);
  label := private.request_label(r.type);

  update public.daymark_requests x set status = 'cancelled', updated_at = private.clock_now()
  where x.id = r.id returning * into r;

  perform private.audit('cancel_request', 'daymark_requests', r.id::text, before_row, to_jsonb(r));
  perform private.notify((select p.supervisor_id from public.daymark_placements p where p.id = r.placement_id),
    'request', 'A ' || label || ' request was cancelled',
    (select x.display_name from public.daymark_profiles x where x.id = me) || ' cancelled their ' || label
      || ' (' || private.fmt_days(r.dates) || ').', '/supervisor/approvals');
  if before_row ->> 'status' = 'pending_admin' or r.escalated_at is not null then
    perform private.notify_admins('request', 'A ' || label || ' request was cancelled',
      (select x.display_name from public.daymark_profiles x where x.id = me) || ' cancelled their ' || label
        || ' (' || private.fmt_days(r.dates) || ').', '/admin/requests');
  end if;
  return to_jsonb(r);
end;
$$;

-- R5.4.8: the intern explains a system-created overtime request.
create or replace function private.add_request_reason(request_id uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  r public.daymark_requests%rowtype;
begin
  select * into r from public.daymark_requests x where x.id = request_id for update;
  if not found or r.intern_id is distinct from me then
    raise exception 'You can only add a reason to your own requests.' using errcode = '42501';
  end if;
  if r.type <> 'overtime' or r.status not in ('pending_supervisor', 'pending_admin') then
    raise exception 'You can add a reason only to a pending overtime request.' using errcode = 'P0001';
  end if;
  if nullif(btrim(reason), '') is null then
    raise exception 'Add a short reason.' using errcode = '22023';
  end if;
  if char_length(reason) > 1000 then
    raise exception 'Keep the reason under 1,000 characters.' using errcode = '22023';
  end if;
  update public.daymark_requests x set reason = btrim(add_request_reason.reason), updated_at = private.clock_now()
  where x.id = r.id returning * into r;
  return to_jsonb(r);
end;
$$;

create or replace function private.decide_request(request_id uuid, decision text, note text, approved_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  as_admin boolean := private.is_admin();
  now_ts timestamptz := private.clock_now();
  clean_note text := nullif(btrim(note), '');
  r public.daymark_requests%rowtype;
  pl public.daymark_placements%rowtype;
  before_row jsonb;
  label text;
  who text;
  v record;
  over boolean;
  minutes integer;
  sys text;
begin
  if decision is null or decision not in ('approve', 'decline') then
    raise exception 'Choose approve or decline.' using errcode = '22023';
  end if;
  select * into r from public.daymark_requests x where x.id = request_id for update;
  if not found or not private.can_view_placement(r.placement_id) then
    raise exception 'That request doesn''t exist.' using errcode = '22023';
  end if;
  if r.intern_id = me then                                                -- review rule 13
    raise exception 'You can''t decide your own request. Another supervisor or the DGK admin will.' using errcode = '42501';
  end if;
  select * into pl from public.daymark_placements x where x.id = r.placement_id;
  if not as_admin and not (pl.supervisor_id = me and exists (
    select 1 from public.daymark_profiles x where x.id = me and x.is_supervisor and x.active)) then
    raise exception 'Only this intern''s supervisor or the DGK admin can decide this request.' using errcode = '42501';
  end if;
  if r.status not in ('pending_supervisor', 'pending_admin') then
    raise exception 'This request has already been decided or cancelled.' using errcode = 'P0001';
  end if;
  if r.status = 'pending_admin' and not as_admin then
    raise exception 'This request is with the DGK admin now.' using errcode = '42501';
  end if;
  if char_length(clean_note) > 500 then
    raise exception 'Keep the note under 500 characters.' using errcode = '22023';
  end if;
  if approved_minutes is not null and (r.type <> 'overtime' or decision <> 'approve') then
    raise exception 'Approved minutes are only for approving overtime.' using errcode = '22023';
  end if;
  before_row := to_jsonb(r);
  label := private.request_label(r.type);
  select x.display_name into who from public.daymark_profiles x where x.id = r.intern_id;

  if decision = 'decline' then
    if clean_note is null then
      raise exception 'Add a note so the intern knows why.' using errcode = '22023';
    end if;
    update public.daymark_requests x
    set status = 'declined', updated_at = now_ts,
        supervisor_decision = case when as_admin then x.supervisor_decision else 'declined' end,
        supervisor_id = case when as_admin then x.supervisor_id else me end,
        supervisor_decided_at = case when as_admin then x.supervisor_decided_at else now_ts end,
        supervisor_note = case when as_admin then x.supervisor_note else clean_note end,
        admin_decision = case when as_admin then 'declined' end,
        admin_id = case when as_admin then me end,
        admin_decided_at = case when as_admin then now_ts end,
        admin_note = case when as_admin then clean_note end
    where x.id = r.id returning * into r;
    perform private.audit('decline_request', 'daymark_requests', r.id::text, before_row, to_jsonb(r));
    perform private.notify(r.intern_id, 'request', 'Your ' || label || ' was declined',
      private.fmt_days(r.dates) || ': ' || clean_note, '/clock/requests');
    return to_jsonb(r);
  end if;

  -- Approve: re-check everything now, under the capacity locks (R5.3.6)
  select * into v from private.check_request(r);
  if not v.ok then
    raise exception 'This can''t be approved: %', v.message using errcode = 'P0001', hint = 'decline';
  end if;
  over := r.type = 'punch_fix' and private.punch_fix_over_limit(r);

  if not as_admin and (v.needs_extra_spot or over) then
    sys := case
      when v.needs_extra_spot and not r.needs_extra_spot then
        'Capacity changed since this was asked: ' || private.fmt_days(v.extra_dates)
        || case when cardinality(v.extra_dates) = 1 then ' is' else ' are' end
        || ' now full, so it needs an extra spot. The DGK admin decides.'
      when v.needs_extra_spot then
        private.fmt_days(v.extra_dates) || case when cardinality(v.extra_dates) = 1 then ' is' else ' are' end
        || ' full, so this needs an extra spot. The DGK admin decides.'
      else 'This is more than ' || (select s.punch_fix_max_per_fortnight from public.daymark_settings s where s.id = 1)
        || ' punch fixes in 14 days, so the DGK admin decides.' end;
    update public.daymark_requests x
    set status = 'pending_admin', updated_at = now_ts, supervisor_decision = 'approved', supervisor_id = me,
        supervisor_decided_at = now_ts, supervisor_note = clean_note, needs_extra_spot = v.needs_extra_spot,
        dates = v.dates, system_note = sys
    where x.id = r.id returning * into r;
    perform private.audit('forward_request', 'daymark_requests', r.id::text, before_row, to_jsonb(r));
    perform private.notify(r.intern_id, 'request', 'Your ' || label || ' is with the DGK admin', sys, '/clock/requests');
    perform private.notify_admins('request', 'A ' || label || ' needs you',
      who || ' · ' || private.fmt_days(r.dates) || '. ' || sys, '/admin/requests');
    return to_jsonb(r);
  end if;

  if r.type = 'overtime' then                                             -- R5.4.8 all or part
    minutes := coalesce(approved_minutes, r.requested_minutes);
    if minutes < 0 or minutes > r.requested_minutes then
      raise exception 'Approve between 0 and % of overtime.', private.fmt_duration(r.requested_minutes) using errcode = '22023';
    end if;
  end if;

  update public.daymark_requests x
  set status = 'approved', updated_at = now_ts, needs_extra_spot = v.needs_extra_spot, dates = v.dates,
      approved_minutes = minutes,
      supervisor_decision = case when as_admin then x.supervisor_decision else 'approved' end,
      supervisor_id = case when as_admin then x.supervisor_id else me end,
      supervisor_decided_at = case when as_admin then x.supervisor_decided_at else now_ts end,
      supervisor_note = case when as_admin then x.supervisor_note else clean_note end,
      admin_decision = case when as_admin then 'approved' end,
      admin_id = case when as_admin then me end,
      admin_decided_at = case when as_admin then now_ts end,
      admin_note = case when as_admin then clean_note end
  where x.id = r.id returning * into r;

  perform private.apply_request(r, me, as_admin);
  if over then
    perform private.audit('override_punch_fix_limit', 'daymark_requests', r.id::text, null,
      jsonb_build_object('intern_id', r.intern_id, 'dates', r.dates));
  end if;
  perform private.audit('approve_request', 'daymark_requests', r.id::text, before_row, to_jsonb(r));
  perform private.notify(r.intern_id, 'request', 'Your ' || label || ' was approved',
    private.fmt_days(r.dates) || case when r.type = 'overtime' then ': ' || private.fmt_duration(minutes) || ' approved.' else '.' end,
    '/clock/requests');
  if as_admin and pl.supervisor_id is distinct from me then
    perform private.notify(pl.supervisor_id, 'request', 'The DGK admin approved a ' || label,
      who || ' · ' || private.fmt_days(r.dates) || '.', '/supervisor/approvals');
  end if;
  return to_jsonb(r);
end;
$$;

create or replace function public.create_request(type text, payload jsonb, reason text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_request(type, payload, reason); $$;

create or replace function public.cancel_request(request_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.cancel_request(request_id); $$;

create or replace function public.add_request_reason(request_id uuid, reason text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.add_request_reason(request_id, reason); $$;

create or replace function public.decide_request(request_id uuid, decision text, note text default null,
  approved_minutes integer default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.decide_request(request_id, decision, note, approved_minutes); $$;

revoke all on function private.request_label(text) from public, anon, authenticated;
revoke all on function private.notify_admins(text, text, text, text) from public, anon, authenticated;
revoke all on function private.apply_request(public.daymark_requests, uuid, boolean) from public, anon, authenticated;
revoke all on function private.create_request(text, jsonb, text) from public, anon;
revoke all on function private.cancel_request(uuid) from public, anon;
revoke all on function private.add_request_reason(uuid, text) from public, anon;
revoke all on function private.decide_request(uuid, text, text, integer) from public, anon;
revoke all on function public.create_request(text, jsonb, text) from public, anon;
revoke all on function public.cancel_request(uuid) from public, anon;
revoke all on function public.add_request_reason(uuid, text) from public, anon;
revoke all on function public.decide_request(uuid, text, text, integer) from public, anon;
grant execute on function private.create_request(text, jsonb, text) to authenticated;
grant execute on function private.cancel_request(uuid) to authenticated;
grant execute on function private.add_request_reason(uuid, text) to authenticated;
grant execute on function private.decide_request(uuid, text, text, integer) to authenticated;
grant execute on function public.create_request(text, jsonb, text) to authenticated;
grant execute on function public.cancel_request(uuid) to authenticated;
grant execute on function public.add_request_reason(uuid, text) to authenticated;
grant execute on function public.decide_request(uuid, text, text, integer) to authenticated;

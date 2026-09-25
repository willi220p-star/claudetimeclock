-- Phase 3: nightly jobs (§8.11, §10 jobs table): auto-close (R5.5.1 as changed by D3), day close
-- (R5.4.7 overtime requests, R5.5.2–R5.5.3 no-shows, R5.11.1 target reached) and reconcile.
-- All idempotent, callable by the admin through public.run_job, scheduled with pg_cron.

-- Mirrors formatMinutes in src/lib/minutes.ts: "7h 30m", "45m", "1h 30m ahead".
create or replace function private.fmt_minutes(minutes integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when abs(minutes) / 60 > 0 and abs(minutes) % 60 > 0 then abs(minutes) / 60 || 'h ' || abs(minutes) % 60 || 'm'
              when abs(minutes) % 60 > 0 then abs(minutes) % 60 || 'm'
              else abs(minutes) / 60 || 'h' end
         || case when minutes < 0 then ' ahead' else '' end;
$$;

-- R5.5.1 / D3 (19:05): every shift still open once its day has closed gets a system clock-out at
-- its own clock-in instant, so it counts 0 until a punch fix is approved. The intern is told.
create or replace function private.job_auto_close()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  n integer := 0;
begin
  for s in
    select x.placement_id, x.work_date, x.clock_in_at, p.intern_id
    from public.daymark_shifts x
    join public.daymark_placements p on p.id = x.placement_id
    where x.clock_out_at is null
      and private.darwin_at(x.work_date, '19:00') <= private.clock_now()           -- never an open day
    order by x.work_date, x.placement_id
  loop
    insert into public.daymark_punches (user_id, placement_id, event_type, source, occurred_at)
    values (s.intern_id, s.placement_id, 'shift_out', 'auto_close', s.clock_in_at);  -- R5.1.7 system punch
    perform private.notify(s.intern_id, 'auto_close', 'You didn''t clock out on ' || private.fmt_day(s.work_date),
      'That shift counts 0 hours for now. Send a punch fix with the time you finished so it counts.',
      '/clock/requests');
    n := n + 1;
  end loop;
  return jsonb_build_object('auto_closed', n);
end;
$$;

-- R5.4.7 / R5.4.8 / §8.11: bring a closed day's overtime request in line with its overtime.
-- Creates it (pending_supervisor), follows a pending one, cancels a pending one that dropped
-- to 0, and clamps an approval above the new overtime (audited, supervisor told).
-- Returns what it did, or null.
-- ponytail: a system-cancelled request is not reopened if a later fix brings overtime back
-- (the one-per-day index keeps it); reopen it here if that ever happens in practice.
create or replace function private.sync_overtime(placement uuid, work_date date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  ot integer;
  q public.daymark_requests%rowtype;
  after_row public.daymark_requests%rowtype;
  pl record;
begin
  select coalesce(max(r.overtime), 0) into ot from public.daymark_day_results r
  where r.placement_id = placement and r.work_date = sync_overtime.work_date;
  select p.intern_id, p.supervisor_id, pr.display_name as name into pl
  from public.daymark_placements p join public.daymark_profiles pr on pr.id = p.intern_id
  where p.id = placement;
  select * into q from public.daymark_requests x
  where x.placement_id = placement and x.type = 'overtime' and x.dates[1] = sync_overtime.work_date
  for update;

  if q.id is null then
    if ot = 0 then
      return null;
    end if;
    insert into public.daymark_requests (placement_id, intern_id, type, status, payload, dates, requested_minutes,
                                         created_at, updated_at)
    values (placement, pl.intern_id, 'overtime', 'pending_supervisor', jsonb_build_object('work_date', work_date),
            array[work_date], ot, private.clock_now(), private.clock_now());
    perform private.notify(pl.supervisor_id, 'overtime', 'Overtime to review',
      pl.name || ' worked ' || private.fmt_minutes(ot) || ' past their scheduled time on ' || private.fmt_day(work_date) || '.',
      '/supervisor/approvals');
    perform private.notify(pl.intern_id, 'overtime', 'Add a reason for your overtime',
      'You worked ' || private.fmt_minutes(ot) || ' extra on ' || private.fmt_day(work_date)
        || '. Add a reason so your supervisor can approve it.', '/clock/requests');
    return 'created';
  end if;

  if q.status in ('pending_supervisor', 'pending_admin') then
    if ot = 0 then
      update public.daymark_requests x set status = 'cancelled', updated_at = private.clock_now()
      where x.id = q.id returning * into after_row;
      perform private.audit('overtime_cancelled', 'daymark_requests', q.id::text, to_jsonb(q), to_jsonb(after_row));
      perform private.notify(pl.intern_id, 'overtime', 'Overtime request closed',
        'After a correction you have no overtime on ' || private.fmt_day(work_date) || ', so that request is closed.',
        '/clock/requests');
      return 'cancelled';
    end if;
    if q.requested_minutes is distinct from ot then
      update public.daymark_requests x set requested_minutes = ot, updated_at = private.clock_now() where x.id = q.id;
      return 'updated';
    end if;
  elsif q.status = 'approved' and q.approved_minutes > ot then
    update public.daymark_requests x
    set requested_minutes = ot, approved_minutes = ot, updated_at = private.clock_now()
    where x.id = q.id returning * into after_row;
    perform private.audit('overtime_clamped', 'daymark_requests', q.id::text, to_jsonb(q), to_jsonb(after_row));
    perform private.notify(pl.supervisor_id, 'overtime_clamped', 'Approved overtime lowered',
      'A correction lowered ' || pl.name || '''s overtime on ' || private.fmt_day(work_date) || ' to '
        || private.fmt_minutes(ot) || ', below the ' || private.fmt_minutes(q.approved_minutes)
        || ' you approved. It now counts ' || private.fmt_minutes(ot) || '.',
      '/supervisor/intern?id=' || placement);
    return 'clamped';
  end if;
  return null;
end;
$$;

-- §8.11 day close (19:10).
create or replace function private.job_day_close()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := private.darwin_today();
  fs date := private.fortnight_start(private.darwin_today());
  k record;
  done text;
  alert_link text;
  n_days integer := 0;
  n_no_show_alerts integer := 0;
  n_target integer := 0;
  ot jsonb := '{}';
  auto jsonb;
begin
  auto := private.job_auto_close();                                                 -- anything still open first

  -- Recompute yesterday and today (closes them, marks no-shows R5.5.2). Punch triggers keep the
  -- shifts current, so no rebuild is needed; unchanged days are not written.
  for k in
    select d.placement_id, d.work_date from public.daymark_scheduled_days d
    where d.work_date between today - 1 and today and d.status in ('scheduled', 'leave')
    union
    select s.placement_id, s.work_date from public.daymark_shifts s where s.work_date between today - 1 and today
    union
    select r.placement_id, r.work_date from public.daymark_day_results r where r.work_date between today - 1 and today
  loop
    perform private.recompute_day(k.placement_id, k.work_date);
    n_days := n_days + 1;
  end loop;

  -- R5.4.7 overtime requests for closed days in the punch-fix reach (14 days covers 7).
  for k in
    select r.placement_id, r.work_date from public.daymark_day_results r
    where r.work_date between today - 14 and today and r.overtime > 0 and (r.work_date < today or r.closed)
    union
    select q.placement_id, q.dates[1] from public.daymark_requests q
    where q.type = 'overtime' and q.status in ('pending_supervisor', 'pending_admin', 'approved')
      and q.dates[1] between today - 14 and today
  loop
    done := private.sync_overtime(k.placement_id, k.work_date);
    if done is not null then
      ot := jsonb_set(ot, array[done], to_jsonb(coalesce((ot ->> done)::integer, 0) + 1));
    end if;
  end loop;

  -- R5.5.3 two or more no-shows this fortnight: tell the supervisor once per fortnight per intern.
  for k in
    select p.id, p.supervisor_id, pr.display_name as name, count(*)::integer as n
    from public.daymark_day_results r
    join public.daymark_placements p on p.id = r.placement_id
    join public.daymark_profiles pr on pr.id = p.intern_id
    where r.work_date between fs and today and r.no_show and p.status in ('active', 'extended')
    group by p.id, p.supervisor_id, pr.display_name
    having count(*) >= 2
  loop
    alert_link := '/supervisor/intern?id=' || k.id || '&fortnight=' || fs;
    if not exists (select 1 from public.daymark_notifications x
                   where x.person_id = k.supervisor_id and x.kind = 'no_shows' and x.link = alert_link) then
      perform private.notify(k.supervisor_id, 'no_shows', k.name || ' has missed ' || k.n || ' days this fortnight',
        'They had scheduled days with no clock-in since ' || private.fmt_day(fs) || '. Check in with them.', alert_link);
      n_no_show_alerts := n_no_show_alerts + 1;
    end if;
  end loop;

  -- R5.11.1 counted total reaches the target: target_reached, supervisor told (clock-in then blocked, A5).
  for k in
    update public.daymark_placements p
    set status = 'target_reached', target_reached_at = private.clock_now()
    where p.status in ('active', 'extended')
      and p.target_minutes <= (select coalesce(sum(r.counted), 0) from public.daymark_day_results r where r.placement_id = p.id)
    returning p.id, p.intern_id, p.supervisor_id, p.target_minutes
  loop
    perform private.audit('target_reached', 'daymark_placements', k.id::text, null,
      jsonb_build_object('status', 'target_reached', 'target_minutes', k.target_minutes));
    perform private.notify(k.supervisor_id, 'target_reached',
      (select pr.display_name from public.daymark_profiles pr where pr.id = k.intern_id) || ' reached their target hours',
      'Confirm completion, or extend the placement.', '/supervisor/intern?id=' || k.id);
    perform private.notify(k.intern_id, 'target_reached', 'You''ve reached your target hours',
      'Well done. Your supervisor will confirm what happens next.', '/clock/progress');
    n_target := n_target + 1;
  end loop;

  return jsonb_build_object('auto_closed', auto -> 'auto_closed', 'days', n_days, 'overtime', ot,
                            'no_show_alerts', n_no_show_alerts, 'target_reached', n_target);
end;
$$;

-- §8.2 nightly reconciliation (02:00).
create or replace function private.job_reconcile()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('drift', private.reconcile_day_results(14));
$$;

-- §10 manual runs by the admin, audited.
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
  end;
  if result is null then
    raise exception 'Pick a job: auto_close, day_close or reconcile.' using errcode = '22023';
  end if;
  perform private.audit('run_job', 'cron.job', run_job.name, null, result);
  return result;
end;
$$;

create or replace function public.run_job(name text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.run_job(name); $$;

revoke all on function private.fmt_minutes(integer) from public, anon;
revoke all on function private.job_auto_close() from public, anon, authenticated;
revoke all on function private.sync_overtime(uuid, date) from public, anon, authenticated;
revoke all on function private.job_day_close() from public, anon, authenticated;
revoke all on function private.job_reconcile() from public, anon, authenticated;
revoke all on function private.run_job(text) from public, anon;
revoke all on function public.run_job(text) from public, anon;
grant execute on function private.fmt_minutes(integer) to authenticated;
grant execute on function private.run_job(text) to authenticated;
grant execute on function public.run_job(text) to authenticated;

-- A2 schedules with pg_cron (UTC; Darwin is UTC+09:30 all year). cron.schedule upserts by name.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
select cron.schedule('daymark-auto-close', '35 9 * * *', 'select private.job_auto_close()');   -- 19:05 Darwin
select cron.schedule('daymark-day-close', '40 9 * * *', 'select private.job_day_close()');     -- 19:10 Darwin
select cron.schedule('daymark-reconcile', '30 16 * * *', 'select private.job_reconcile()');    -- 02:00 Darwin

-- Phase 6 (D14 reversed): weekly check-ins, the Monday summary and its job (§11.3, §12 supervisor 8),
-- and two in-app alerts for supervisors: late clock-in and left early.

-- Monday of the week holding d (R5.7.1 weeks run Mon–Sun).
create or replace function private.monday(d date)
returns date
language sql
immutable
set search_path = ''
as $$
  select d - (extract(isodow from d)::integer - 1);
$$;

-- ---------------------------------------------------------------------------
-- Check-ins
-- ---------------------------------------------------------------------------

-- The intern's supervisor (or an admin) rates one week. One row per placement and week; a second
-- save for the same week edits it.
create or replace function private.save_checkin(
  placement uuid,
  week_start date,
  reliability integer,
  quality integer,
  communication integer,
  comment text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype := private.require_placement_manager(placement);
  note text := nullif(btrim(coalesce(save_checkin.comment, '')), '');
  before_row public.daymark_checkins%rowtype;
  after_row public.daymark_checkins%rowtype;
begin
  if pl.intern_id = (select auth.uid()) then
    raise exception 'You can''t check in on your own placement.' using errcode = '42501';
  end if;
  if week_start is null or extract(isodow from week_start) <> 1 then
    raise exception 'Pick the Monday that starts the week.' using errcode = '22023';
  end if;
  if week_start > private.darwin_today() then
    raise exception 'That week hasn''t started yet.' using errcode = '22023';
  end if;
  if week_start + 6 < pl.start_date or week_start > coalesce(pl.ended_on, pl.planned_end_date) then
    raise exception 'That week is outside the placement.' using errcode = '22023';
  end if;
  if reliability is null or quality is null or communication is null
     or reliability not between 1 and 5 or quality not between 1 and 5 or communication not between 1 and 5 then
    raise exception 'Rate each area from 1 to 5.' using errcode = '22023';
  end if;
  if char_length(note) > 1000 then
    raise exception 'Keep the comment to 1000 characters.' using errcode = '22023';
  end if;

  select * into before_row from public.daymark_checkins c
  where c.placement_id = placement and c.week_start = save_checkin.week_start;

  insert into public.daymark_checkins as c (placement_id, supervisor_id, week_start, reliability, quality, communication,
                                            comment, created_at, updated_at)
  values (placement, (select auth.uid()), week_start, reliability, quality, communication, note,
          private.clock_now(), private.clock_now())
  on conflict on constraint daymark_checkins_placement_id_week_start_key do update
  set supervisor_id = excluded.supervisor_id, reliability = excluded.reliability, quality = excluded.quality,
      communication = excluded.communication, comment = excluded.comment, updated_at = excluded.updated_at
  returning * into after_row;

  perform private.audit(case when before_row.id is null then 'checkin_saved' else 'checkin_updated' end,
    'daymark_checkins', after_row.id::text,
    case when before_row.id is null then null else to_jsonb(before_row) end, to_jsonb(after_row));
  perform private.notify(pl.intern_id, 'checkin',
    'Your supervisor checked in on week of ' || private.fmt_day(week_start),
    'Reliability ' || reliability || ', quality of work ' || quality || ', communication ' || communication || ' out of 5.',
    '/clock/progress');
  return after_row.id;
end;
$$;

-- A supervisor's live placements with no check-in for that week (default last week). Only
-- placements that had started by the end of that week.
create or replace function private.checkins_due_for(supervisor uuid, week date default null)
returns table (placement_id uuid, intern_id uuid, intern_name text, week_start date)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.intern_id, pr.display_name, w.ws
  from (select coalesce(week, private.monday(private.darwin_today()) - 7) as ws) w
  join public.daymark_placements p on p.supervisor_id = supervisor
  join public.daymark_profiles pr on pr.id = p.intern_id
  where p.status in ('active', 'extended', 'target_reached')
    and p.start_date <= w.ws + 6
    and not exists (select 1 from public.daymark_checkins c where c.placement_id = p.id and c.week_start = w.ws)
  order by pr.display_name, p.id;
$$;

create or replace function private.checkins_due()
returns table (placement_id uuid, intern_id uuid, intern_name text, week_start date)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.checkins_due_for((select auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- Monday summary: one row per live placement for one week (default last week)
-- ---------------------------------------------------------------------------

create or replace function private.monday_summary(week_start date default null)
returns table (
  placement_id uuid,
  intern_id uuid,
  intern_name text,
  week date,
  scheduled integer,
  counted integer,
  owed integer,
  no_shows integer,
  late_days integer,
  overtime_approved integer,
  overtime_pending integer,
  work_logs integer,
  days_worked integer,
  pending_requests integer,
  pace text,
  risk_reasons text[],
  checkin jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  ws date := coalesce(monday_summary.week_start, private.monday(private.darwin_today()) - 7);
  admin boolean := private.is_admin();
  ids uuid[];
begin
  if extract(isodow from ws) <> 1 then
    raise exception 'Pick the Monday that starts the week.' using errcode = '22023';
  end if;
  if not admin and not exists (select 1 from public.daymark_profiles x where x.id = me and x.is_supervisor and x.active) then
    raise exception 'Only supervisors see this.' using errcode = '42501';
  end if;
  select coalesce(array_agg(p.id), '{}') into ids from public.daymark_placements p
  where p.status in ('active', 'extended', 'target_reached') and (admin or p.supervisor_id = me)
    and p.start_date <= ws + 6;

  return query
  with t as (
    select private.darwin_today() as today,
           private.clock_now() >= private.darwin_at(private.darwin_today(), '19:00') as today_closed
  )
  select pr.placement_id, pr.intern_id, pr.intern_name, ws,
         coalesce(wh.scheduled, 0),
         coalesce(wh.counted, 0),
         -- R5.6.3 owed as it stood at the end of the week (or now, for the current week)
         (coalesce((select sum(d.planned_minutes) from public.daymark_scheduled_days d cross join t
                    where d.placement_id = pr.placement_id and d.status in ('scheduled', 'leave') and d.work_date <= ws + 6
                      and (d.work_date < t.today or (d.work_date = t.today and t.today_closed))), 0)
          - coalesce((select sum(r.counted) from public.daymark_day_results r cross join t
                      where r.placement_id = pr.placement_id and r.work_date <= ws + 6
                        and (r.work_date < t.today or (r.work_date = t.today and t.today_closed))), 0))::integer,
         coalesce(wh.no_shows, 0),
         coalesce(wh.late_days, 0),
         coalesce(wh.approved_ot, 0),
         coalesce((select sum(q.requested_minutes) from public.daymark_requests q
                   where q.placement_id = pr.placement_id and q.type = 'overtime'
                     and q.status in ('pending_supervisor', 'pending_admin')
                     and q.dates[1] between ws and ws + 6), 0)::integer,
         (select count(*) from public.daymark_day_results r
          where r.placement_id = pr.placement_id and r.work_date between ws and ws + 6 and r.raw > 0
            and exists (select 1 from public.daymark_work_logs w where w.placement_id = r.placement_id and w.work_date = r.work_date))::integer,
         (select count(*) from public.daymark_day_results r
          where r.placement_id = pr.placement_id and r.work_date between ws and ws + 6 and r.raw > 0)::integer,
         (select count(*) from public.daymark_requests q
          where q.placement_id = pr.placement_id and q.status in ('pending_supervisor', 'pending_admin'))::integer,
         pr.pace,
         pr.risk_reasons,
         (select jsonb_build_object('reliability', c.reliability, 'quality', c.quality, 'communication', c.communication,
                                    'comment', c.comment, 'average', round((c.reliability + c.quality + c.communication) / 3.0, 2),
                                    'updated_at', c.updated_at)
          from public.daymark_checkins c where c.placement_id = pr.placement_id and c.week_start = ws)
  from private.progress_rows(ids) pr
  left join public.daymark_v_week_hours wh on wh.placement_id = pr.placement_id and wh.week_start = ws
  order by pr.intern_name, pr.placement_id;
end;
$$;

-- §10 Monday 08:00 Darwin: each supervisor with live interns is told the summary is ready, and how
-- many check-ins are due. Once per week per supervisor (the week is in the link).
create or replace function private.job_monday_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws date := private.monday(private.darwin_today()) - 7;
  v_link text := '/supervisor/summary?week=' || (private.monday(private.darwin_today()) - 7);
  s record;
  n_summaries integer := 0;
  n_due integer := 0;
begin
  for s in
    select pr.id, (select count(*) from private.checkins_due_for(pr.id, ws))::integer as due
    from public.daymark_profiles pr
    where pr.is_supervisor and pr.active
      and exists (select 1 from public.daymark_placements p
                  where p.supervisor_id = pr.id and p.status in ('active', 'extended', 'target_reached'))
    order by pr.id
  loop
    if not exists (select 1 from public.daymark_notifications x
                   where x.person_id = s.id and x.kind = 'monday_summary' and x.link = v_link) then
      perform private.notify(s.id, 'monday_summary', 'Your Monday summary is ready',
        'How each of your interns went in the week of ' || private.fmt_day(ws) || '.', v_link);
      n_summaries := n_summaries + 1;
    end if;
    if s.due > 0 and not exists (select 1 from public.daymark_notifications x
                                 where x.person_id = s.id and x.kind = 'checkins_due' and x.link = v_link) then
      perform private.notify(s.id, 'checkins_due',
        s.due || case when s.due = 1 then ' check-in' else ' check-ins' end || ' due for last week',
        'Rate reliability, quality of work and communication for the week of ' || private.fmt_day(ws) || '.', v_link);
      n_due := n_due + 1;
    end if;
  end loop;
  return jsonb_build_object('summaries', n_summaries, 'checkins_due', n_due);
end;
$$;

-- ---------------------------------------------------------------------------
-- Late alert: the first clock-in of a scheduled day, past start + grace (R5.4.12)
-- ---------------------------------------------------------------------------

create or replace function private.on_punch_late_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d date := (new.occurred_at at time zone 'Australia/Darwin')::date;
  sd public.daymark_scheduled_days%rowtype;
  pl public.daymark_placements%rowtype;
begin
  select * into sd from public.daymark_scheduled_days x
  where x.placement_id = new.placement_id and x.work_date = d and x.status = 'scheduled';
  if sd.id is null
     or new.occurred_at <= private.darwin_at(d, sd.start_time)
          + make_interval(mins => (select g.grace_minutes from public.daymark_settings g where g.id = 1))
     or exists (select 1 from public.daymark_punches x
                where x.placement_id = new.placement_id and x.event_type = 'shift_in' and x.id <> new.id
                  and (x.occurred_at at time zone 'Australia/Darwin')::date = d and x.occurred_at <= new.occurred_at) then
    return null;
  end if;
  select * into pl from public.daymark_placements p where p.id = new.placement_id;
  if pl.supervisor_id is not null then
    perform private.notify(pl.supervisor_id, 'late',
      (select pr.display_name from public.daymark_profiles pr where pr.id = pl.intern_id) || ' clocked in late at '
        || lower(to_char(new.occurred_at at time zone 'Australia/Darwin', 'FMHH12:MI am')),
      'They were due at ' || lower(to_char(sd.start_time, 'FMHH12:MI am')) || ' on ' || private.fmt_day(d) || '.',
      '/supervisor/intern?id=' || pl.id);
  end if;
  return null;
end;
$$;

create trigger daymark_punches_late_alert
  after insert on public.daymark_punches
  for each row
  when (new.event_type = 'shift_in' and new.source in ('device', 'supervisor') and new.placement_id is not null)
  execute function private.on_punch_late_alert();

-- ---------------------------------------------------------------------------
-- §8.11 day close, as in 20260925020400_jobs.sql plus the left-early alert (R5.4.13)
-- ---------------------------------------------------------------------------

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
  n_left_early integer := 0;
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

  -- R5.4.13 left early today: tell the intern and the supervisor once for the day.
  for k in
    select p.id, p.intern_id, p.supervisor_id, pr.display_name as name, r.short
    from public.daymark_day_results r
    join public.daymark_placements p on p.id = r.placement_id
    join public.daymark_profiles pr on pr.id = p.intern_id
    where r.work_date = today and r.left_early
  loop
    alert_link := '/clock/progress?day=' || today;
    if not exists (select 1 from public.daymark_notifications x
                   where x.person_id = k.intern_id and x.kind = 'left_early' and x.link = alert_link) then
      perform private.notify(k.intern_id, 'left_early', 'You left early on ' || private.fmt_day(today),
        'You finished ' || private.fmt_minutes(k.short) || ' short of your scheduled day, so that time is owed.',
        alert_link);
      n_left_early := n_left_early + 1;
    end if;
    alert_link := '/supervisor/intern?id=' || k.id || '&day=' || today;
    if k.supervisor_id is not null and not exists (
         select 1 from public.daymark_notifications x
         where x.person_id = k.supervisor_id and x.kind = 'left_early' and x.link = alert_link) then
      perform private.notify(k.supervisor_id, 'left_early', k.name || ' left early on ' || private.fmt_day(today),
        'They finished ' || private.fmt_minutes(k.short) || ' short of their scheduled day.', alert_link);
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
                            'no_show_alerts', n_no_show_alerts, 'left_early_alerts', n_left_early,
                            'target_reached', n_target);
end;
$$;

-- §10 manual runs by the admin, audited (as in 20260925043000 plus monday_summary).
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
    when 'monday_summary' then private.job_monday_summary()
  end;
  if result is null then
    raise exception 'Pick a job: auto_close, day_close, reconcile, escalate, retention_reminders, clock_guard or monday_summary.'
      using errcode = '22023';
  end if;
  perform private.audit('run_job', 'cron.job', run_job.name, null, result);
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- §12 supervisor KPIs, as in 20260925050000_kpis.sql plus check-ins due and last check-in (8)
-- ---------------------------------------------------------------------------

create or replace function private.kpi_supervisor()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  ids uuid[];
  fs date := private.fortnight_start(private.darwin_today());
  fe date := private.fortnight_start(private.darwin_today()) + 13;
  a record;
begin
  if not exists (select 1 from public.daymark_profiles x where x.id = me and x.is_supervisor and x.active) then
    raise exception 'Only supervisors see this.' using errcode = '42501';
  end if;
  select coalesce(array_agg(p.id), '{}') into ids from public.daymark_placements p
  where p.supervisor_id = me and p.status in ('active', 'extended', 'target_reached');
  select * into a from private.attendance(ids, fs, fe);

  return jsonb_build_object(
    'approvals_waiting', (select count(*) from public.daymark_requests r
                          where r.placement_id = any (ids) and r.status = 'pending_supervisor'),
    'oldest_hours', (select floor(extract(epoch from private.clock_now() - min(r.created_at)) / 3600)::integer
                     from public.daymark_requests r where r.placement_id = any (ids) and r.status = 'pending_supervisor'),
    'at_risk', (select count(*) from private.progress_rows(ids) x where cardinality(x.risk_reasons) > 0),
    'attendance_pct', a.attendance_pct,
    'on_time_pct', a.on_time_pct,
    'overtime_approved_minutes', coalesce((select sum(r.approved_ot) from public.daymark_day_results r
                                           where r.placement_id = any (ids) and r.work_date between fs and fe), 0),
    'work_log_pct', (select private.pct(count(*) filter (where exists (
                              select 1 from public.daymark_work_logs w where w.placement_id = r.placement_id and w.work_date = r.work_date)),
                            count(*))
                     from public.daymark_day_results r
                     where r.placement_id = any (ids) and r.raw > 0 and r.work_date between fs and fe),
    'checkins_due', (select count(*) from private.checkins_due_for(me)),
    'last_checkin', jsonb_build_object(
      'week_start', (select max(c.week_start) from public.daymark_checkins c where c.placement_id = any (ids)),
      'average', (select round(avg(x.latest_checkin_average), 2) from private.progress_rows(ids) x))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers and grants
-- ---------------------------------------------------------------------------

create or replace function public.save_checkin(placement uuid, week_start date, reliability integer, quality integer,
                                               communication integer, comment text default null)
returns uuid language sql security invoker set search_path = ''
as $$ select private.save_checkin(placement, week_start, reliability, quality, communication, comment); $$;

create or replace function public.checkins_due()
returns table (placement_id uuid, intern_id uuid, intern_name text, week_start date)
language sql stable security invoker set search_path = ''
as $$ select * from private.checkins_due(); $$;

create or replace function public.monday_summary(week_start date default null)
returns table (placement_id uuid, intern_id uuid, intern_name text, week date, scheduled integer, counted integer,
               owed integer, no_shows integer, late_days integer, overtime_approved integer, overtime_pending integer,
               work_logs integer, days_worked integer, pending_requests integer, pace text, risk_reasons text[],
               checkin jsonb)
language sql stable security invoker set search_path = ''
as $$ select * from private.monday_summary(week_start); $$;

revoke all on function private.monday(date) from public, anon;
revoke all on function private.save_checkin(uuid, date, integer, integer, integer, text) from public, anon;
revoke all on function private.checkins_due_for(uuid, date) from public, anon, authenticated;
revoke all on function private.checkins_due() from public, anon;
revoke all on function private.monday_summary(date) from public, anon;
revoke all on function private.job_monday_summary() from public, anon, authenticated;
revoke all on function private.on_punch_late_alert() from public, anon, authenticated;
revoke all on function public.save_checkin(uuid, date, integer, integer, integer, text) from public, anon;
revoke all on function public.checkins_due() from public, anon;
revoke all on function public.monday_summary(date) from public, anon;
grant execute on function private.monday(date) to authenticated;
grant execute on function private.save_checkin(uuid, date, integer, integer, integer, text) to authenticated;
grant execute on function private.checkins_due() to authenticated;
grant execute on function private.monday_summary(date) to authenticated;
grant execute on function public.save_checkin(uuid, date, integer, integer, integer, text) to authenticated;
grant execute on function public.checkins_due() to authenticated;
grant execute on function public.monday_summary(date) to authenticated;

select cron.schedule('daymark-monday-summary', '30 22 * * 0', 'select private.job_monday_summary()');  -- Mon 08:00 Darwin

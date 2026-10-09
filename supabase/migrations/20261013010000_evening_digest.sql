-- Evening-before reminder and supervisor morning digest (Dilip, 9 Oct; D39).
-- 1. 8:00 pm the day before: "Your shift tomorrow starts at 9:00 am" for every intern rostered tomorrow
--    with a start before noon (kind reminder_tomorrow).
-- 2. 8:00 am: each supervisor (admin: everyone) gets who is late and what waits for them (kind digest).
-- Both are ticked in Settings -> Notifications like the other pushes.

create or replace function private.push_kind_options()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['reminder_shift', 'reminder_break', 'reminder_clock_out', 'reminder_tomorrow', 'digest', 'schedule', 'times',
               'request', 'attendance', 'work_based', 'escalated']::text[];
$$;

alter table public.daymark_settings
  alter column push_kinds set default array['reminder_shift', 'reminder_break', 'reminder_clock_out', 'reminder_tomorrow',
    'digest', 'schedule', 'times', 'request', 'attendance', 'work_based', 'escalated']::text[];
update public.daymark_settings set push_kinds = array(select distinct k from unnest(push_kinds || array['reminder_tomorrow', 'digest']) k order by 1)
where id = 1;

alter table public.daymark_reminders_sent drop constraint daymark_reminders_sent_kind_check;
alter table public.daymark_reminders_sent add constraint daymark_reminders_sent_kind_check
  check (kind in ('not_clocked_in', 'long_break', 'forgot_clock_out', 'shift_soon', 'clock_out', 'shift_tomorrow', 'digest'));

-- The day reminders keep their own function; job_reminders (the cron entry) runs all three.
alter function private.job_reminders() rename to job_day_reminders;

create or replace function private.job_evening_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_ts timestamptz := private.clock_now();
  today date := private.darwin_today();
  r record;
  sent integer := 0;
begin
  if not coalesce('reminder_tomorrow' = any (select unnest(s.push_kinds) from public.daymark_settings s where s.id = 1), false)
     or now_ts < private.darwin_at(today, time '20:00') then
    return 0;
  end if;
  for r in
    select pl.intern_id, sd.start_time
    from public.daymark_placements pl
    join public.daymark_profiles p on p.id = pl.intern_id and p.active and p.is_intern
    join public.daymark_scheduled_days sd on sd.placement_id = pl.id and sd.work_date = today + 1 and sd.status = 'scheduled'
    where pl.status in ('active', 'extended') and sd.start_time < time '12:00'
  loop
    insert into public.daymark_reminders_sent (person_id, kind, work_date) values (r.intern_id, 'shift_tomorrow', today + 1)
    on conflict do nothing;
    if found then
      perform private.notify(r.intern_id, 'reminder_tomorrow', 'Your shift is tomorrow morning',
        'Tomorrow you start at ' || private.fmt_clock(r.start_time) || '. See you then.', '/clock');
      sent := sent + 1;
    end if;
  end loop;
  return sent;
end;
$$;

-- Late = the rostered start has passed and nothing is clocked today. Waiting = requests at that person's stage.
create or replace function private.job_digest()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_ts timestamptz := private.clock_now();
  today date := private.darwin_today();
  r record;
  sent integer := 0;
  parts text[];
begin
  if not coalesce('digest' = any (select unnest(s.push_kinds) from public.daymark_settings s where s.id = 1), false)
     or now_ts < private.darwin_at(today, time '08:00') or now_ts >= private.darwin_at(today, time '12:00') then
    return 0;
  end if;
  for r in
    select p.id as person_id,
      (select count(*)::int
         from public.daymark_placements pl
         join public.daymark_scheduled_days sd on sd.placement_id = pl.id and sd.work_date = today and sd.status = 'scheduled'
         where pl.status in ('active', 'extended') and (p.is_admin or pl.supervisor_id = p.id)
           and private.darwin_at(today, sd.start_time) <= now_ts
           and not exists (select 1 from public.daymark_punches x where x.user_id = pl.intern_id
                           and x.event_type in ('shift_in', 'shift_out')
                           and (x.occurred_at at time zone 'Australia/Darwin')::date = today)) as late,
      (select count(*)::int
         from public.daymark_requests q
         join public.daymark_placements pl on pl.id = q.placement_id
         where (p.is_admin and q.status = 'pending_admin')
            or (pl.supervisor_id = p.id and q.status = 'pending_supervisor')) as waiting
    from public.daymark_profiles p
    where p.active and (p.is_admin or p.is_supervisor)
  loop
    parts := '{}';
    if r.late > 0 then parts := parts || (r.late || ' not clocked in yet'); end if;
    if r.waiting > 0 then parts := parts || (r.waiting || ' waiting for your approval'); end if;
    continue when cardinality(parts) = 0;
    insert into public.daymark_reminders_sent (person_id, kind, work_date) values (r.person_id, 'digest', today)
    on conflict do nothing;
    if found then
      perform private.notify(r.person_id, 'digest', 'Your morning summary', array_to_string(parts, ' · ') || '.',
        case when r.late > 0 then '/supervisor' else '/supervisor/approvals' end);
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
as $$ select private.job_day_reminders() + private.job_evening_reminders() + private.job_digest(); $$;

revoke all on function private.job_day_reminders() from public, anon, authenticated;
revoke all on function private.job_evening_reminders() from public, anon, authenticated;
revoke all on function private.job_digest() from public, anon, authenticated;
revoke all on function private.job_reminders() from public, anon, authenticated;

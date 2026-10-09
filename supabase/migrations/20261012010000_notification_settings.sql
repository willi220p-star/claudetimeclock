-- Notification settings (Dilip, 9 Oct; D37):
-- 1. Admin ticks which notifications go to phones (Settings → Notifications). An unticked reminder isn't
--    sent at all; any other unticked type still shows in the app's notification list, just not on phones.
-- 2. Reminders: shift starts in 30 minutes, break is up (at the intern's own break length), clock out at
--    the rostered finish. Each is its own notification kind so each can be ticked separately.
-- 3. Admin sets each intern's break length, or one length for every active intern.

-- ---------------------------------------------------------------------------
-- 1. What can be pushed, and what is
-- ---------------------------------------------------------------------------
create or replace function private.push_kind_options()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['reminder_shift', 'reminder_break', 'reminder_clock_out', 'schedule', 'times',
               'request', 'attendance', 'work_based', 'escalated']::text[];
$$;

alter table public.daymark_settings
  add column push_kinds text[] not null default array['reminder_shift', 'reminder_break', 'reminder_clock_out', 'schedule',
    'times', 'request', 'attendance', 'work_based', 'escalated']::text[];

-- Ticked types only (was a fixed list).
create or replace function private.push_worthy(kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select push_worthy.kind = any (s.push_kinds) from public.daymark_settings s where s.id = 1), false); $$;

create or replace function private.save_push_kinds(kinds text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  before text[];
  clean text[] := array(select distinct k from unnest(coalesce(kinds, '{}')) k order by 1);
begin
  perform private.require_admin();
  if exists (select 1 from unnest(clean) k where not (k = any (private.push_kind_options()))) then
    raise exception 'That isn''t a notification DGK Clock sends.' using errcode = '22023';
  end if;
  select s.push_kinds into before from public.daymark_settings s where s.id = 1;
  update public.daymark_settings s set push_kinds = clean, updated_at = private.clock_now() where s.id = 1;
  perform private.audit('save_push_kinds', 'daymark_settings', '1',
    jsonb_build_object('push_kinds', before), jsonb_build_object('push_kinds', clean));
  return clean;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Break length: one intern, or every active intern. The planned-minutes trigger re-plans today on.
-- ---------------------------------------------------------------------------
create or replace function private.set_break_minutes(placement uuid, minutes integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype;
begin
  perform private.require_admin();
  if minutes is null or minutes not between 0 and 120 then
    raise exception 'Set the break between 0 and 120 minutes.' using errcode = '22023';
  end if;
  select * into pl from public.daymark_placements p where p.id = set_break_minutes.placement;
  if not found then
    raise exception 'That placement doesn''t exist.' using errcode = 'P0002';
  end if;
  update public.daymark_placements p set break_minutes = minutes where p.id = pl.id;
  perform private.audit('set_break_minutes', 'daymark_placements', pl.id::text,
    jsonb_build_object('break_minutes', pl.break_minutes), jsonb_build_object('break_minutes', minutes));
end;
$$;

create or replace function private.set_break_for_all(minutes integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform private.require_admin();
  if minutes is null or minutes not between 0 and 120 then
    raise exception 'Set the break between 0 and 120 minutes.' using errcode = '22023';
  end if;
  update public.daymark_placements p set break_minutes = minutes
  where p.status in ('active', 'extended') and p.break_minutes is distinct from minutes;
  get diagnostics n = row_count;
  perform private.audit('set_break_for_all', 'daymark_placements', null, null,
    jsonb_build_object('break_minutes', minutes, 'placements', n));
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Reminders: 30 minutes before the shift, break at its length, clock out at the finish
-- ---------------------------------------------------------------------------
alter table public.daymark_reminders_sent drop constraint daymark_reminders_sent_kind_check;
alter table public.daymark_reminders_sent add constraint daymark_reminders_sent_kind_check
  check (kind in ('not_clocked_in', 'long_break', 'forgot_clock_out', 'shift_soon', 'clock_out'));

create or replace function private.job_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_ts timestamptz := private.clock_now();
  today date := private.darwin_today();
  on_kinds text[] := (select s.push_kinds from public.daymark_settings s where s.id = 1);
  r record;
  sent integer := 0;
begin
  for r in
    select pl.id as placement_id, pl.intern_id, coalesce(pl.break_minutes, st.break_minutes) as break_minutes,
           sd.start_time, sd.end_time,
           lp.event_type as last_event, lp.is_break as last_break, lp.occurred_at as last_at,
           exists (select 1 from public.daymark_punches x where x.user_id = pl.intern_id
                   and x.event_type in ('shift_in', 'shift_out')
                   and (x.occurred_at at time zone 'Australia/Darwin')::date = today) as clocked_today
    from public.daymark_placements pl
    join public.daymark_profiles p on p.id = pl.intern_id and p.active and p.is_intern
    cross join public.daymark_settings st
    left join public.daymark_scheduled_days sd
      on sd.placement_id = pl.id and sd.work_date = today and sd.status = 'scheduled'
    left join lateral (
      select x.event_type, x.is_break, x.occurred_at from public.daymark_punches x
      where x.user_id = pl.intern_id and x.event_type in ('shift_in', 'shift_out') and x.occurred_at <= now_ts
      order by x.occurred_at desc limit 1
    ) lp on true
    where st.id = 1 and pl.status in ('active', 'extended') and today between pl.start_date and pl.planned_end_date
  loop
    -- Rostered today, not clocked in yet, the shift starts within 30 minutes.
    if 'reminder_shift' = any (on_kinds) and r.start_time is not null and not r.clocked_today
       and now_ts >= private.darwin_at(today, r.start_time) - interval '30 minutes'
       and now_ts < private.darwin_at(today, r.start_time) then
      insert into public.daymark_reminders_sent (person_id, kind, work_date) values (r.intern_id, 'shift_soon', today)
      on conflict do nothing;
      if found then
        perform private.notify(r.intern_id, 'reminder_shift', 'Your shift starts soon',
          'Your shift starts at ' || private.fmt_clock(r.start_time) || '. Clock in when you arrive.', '/clock');
        sent := sent + 1;
      end if;
    end if;
    -- On a break for its full length (each intern's own break).
    if 'reminder_break' = any (on_kinds) and r.last_event = 'shift_out' and r.last_break and r.break_minutes > 0
       and now_ts >= r.last_at + make_interval(mins => r.break_minutes)
       and (r.last_at at time zone 'Australia/Darwin')::date = today then
      insert into public.daymark_reminders_sent (person_id, kind, work_date) values (r.intern_id, 'long_break', today)
      on conflict do nothing;
      if found then
        perform private.notify(r.intern_id, 'reminder_break', 'Your break is up',
          'Your ' || r.break_minutes || '-minute break is up. Tap End break when you''re back.', '/clock');
        sent := sent + 1;
      end if;
    end if;
    -- Still clocked in at the rostered finish.
    if 'reminder_clock_out' = any (on_kinds) and r.end_time is not null and r.last_event = 'shift_in'
       and now_ts >= private.darwin_at(today, r.end_time) then
      insert into public.daymark_reminders_sent (person_id, kind, work_date) values (r.intern_id, 'clock_out', today)
      on conflict do nothing;
      if found then
        perform private.notify(r.intern_id, 'reminder_clock_out', 'Time to clock out',
          'Your day finishes at ' || private.fmt_clock(r.end_time) || '. Write your work log and tap Finish.', '/clock');
        sent := sent + 1;
      end if;
    end if;
  end loop;
  return sent;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Wrappers and grants
-- ---------------------------------------------------------------------------
create or replace function public.save_push_kinds(kinds text[])
returns text[] language sql security invoker set search_path = ''
as $$ select private.save_push_kinds(kinds); $$;

create or replace function public.set_break_minutes(placement uuid, minutes integer)
returns void language sql security invoker set search_path = ''
as $$ select private.set_break_minutes(placement, minutes); $$;

create or replace function public.set_break_for_all(minutes integer)
returns integer language sql security invoker set search_path = ''
as $$ select private.set_break_for_all(minutes); $$;

revoke all on function private.push_kind_options() from public, anon;
revoke all on function private.save_push_kinds(text[]) from public, anon;
revoke all on function private.set_break_minutes(uuid, integer) from public, anon;
revoke all on function private.set_break_for_all(integer) from public, anon;
revoke all on function public.save_push_kinds(text[]) from public, anon;
revoke all on function public.set_break_minutes(uuid, integer) from public, anon;
revoke all on function public.set_break_for_all(integer) from public, anon;
grant execute on function private.push_kind_options() to authenticated;
grant execute on function private.save_push_kinds(text[]) to authenticated;
grant execute on function private.set_break_minutes(uuid, integer) to authenticated;
grant execute on function private.set_break_for_all(integer) to authenticated;
grant execute on function public.save_push_kinds(text[]) to authenticated;
grant execute on function public.set_break_minutes(uuid, integer) to authenticated;
grant execute on function public.set_break_for_all(integer) to authenticated;

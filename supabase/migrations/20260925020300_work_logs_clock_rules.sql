-- Phase 3: work logs (§10) and the clock rules that read them and the schedule:
-- R5.1.6 (log for the previous shift date before the next clock-in) and R5.1.8 (unscheduled
-- clock-in blocked when the site already has hard capacity scheduled).

create table public.daymark_work_logs (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.daymark_placements (id) on delete cascade,
  work_date date not null,
  summary text not null check (char_length(btrim(summary)) between 10 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daymark_work_logs_day_key unique (placement_id, work_date)
);

alter table public.daymark_work_logs enable row level security;
create policy "Work logs follow the placement" on public.daymark_work_logs
  for select to authenticated using ((select private.can_view_placement(placement_id)));
revoke all on table public.daymark_work_logs from public, anon, authenticated;
grant select on table public.daymark_work_logs to authenticated;
grant all on table public.daymark_work_logs to service_role;

-- The intern writes (or rewrites) the log for a day they have a shift on, on their live placement.
create or replace function private.save_work_log(work_date date, summary text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  pl public.daymark_placements%rowtype;
  clean text := btrim(summary);
  saved public.daymark_work_logs%rowtype;
begin
  if not exists (select 1 from public.daymark_profiles p where p.id = me and p.is_intern and p.active) then
    raise exception 'Only interns write work logs.' using errcode = '42501';
  end if;
  pl := private.live_placement(me);
  if pl.id is null then
    raise exception 'Your placement has ended. You can still view and download your records.' using errcode = 'P0001';  -- R5.11.5
  end if;
  if clean is null or char_length(clean) not between 10 and 500 then
    raise exception 'Write between 10 and 500 characters about what you did.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.daymark_shifts s where s.placement_id = pl.id and s.work_date = save_work_log.work_date) then
    raise exception 'You can only write a work log for a day you clocked in.' using errcode = 'P0001';
  end if;

  insert into public.daymark_work_logs (placement_id, work_date, summary, created_at, updated_at)
  values (pl.id, work_date, clean, private.clock_now(), private.clock_now())
  on conflict on constraint daymark_work_logs_day_key
  do update set summary = excluded.summary, updated_at = excluded.updated_at
  returning * into saved;
  return to_jsonb(saved);
end;
$$;

create or replace function public.save_work_log(work_date date, summary text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.save_work_log(work_date, summary); $$;

revoke all on function private.save_work_log(date, text) from public, anon;
revoke all on function public.save_work_log(date, text) from public, anon;
grant execute on function private.save_work_log(date, text) to authenticated;
grant execute on function public.save_work_log(date, text) to authenticated;

-- Latest body from 20260925010000_placements_schedule.sql, plus R5.1.6 and R5.1.8, and an
-- auto-close tie-break: its clock-out shares the clock-in's instant (D3) and is the later event.
create or replace function private.clock_block_reason(person uuid, event_type text, at timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.daymark_profiles%rowtype;
  pl public.daymark_placements%rowtype;
  site public.daymark_sites%rowtype;
  local_ts timestamp := at at time zone 'Australia/Darwin';
  closure text;
  last_event text;
  prev_date date;
begin
  select * into p from public.daymark_profiles where id = person;
  if not found or not p.is_intern then
    return 'Only interns clock in.';                                             -- R5.1.1
  end if;
  if not p.active then
    return 'Your login is paused. Ask the DGK admin to turn it back on.';        -- R5.1.1
  end if;

  pl := private.live_placement(person);
  if pl.id is null then
    if exists (select 1 from public.daymark_placements x where x.intern_id = person) then
      return 'Your placement has ended. You can still view and download your records.';  -- R5.11.5
    end if;
    return 'You don''t have a placement yet. Ask the DGK admin to set one up.';   -- R5.1.1
  end if;
  if pl.status = 'target_reached' and clock_block_reason.event_type = 'shift_in' then
    return 'You''ve reached your target hours. Your supervisor will confirm what happens next.';  -- R5.11.1, A5
  end if;

  select s.* into site from public.daymark_sites s where s.id = pl.site_id;
  if extract(isodow from local_ts) > 5 then
    return 'The office is closed on weekends.';                                  -- R5.1.2
  end if;
  select c.name into closure from public.daymark_closure_days c
  where c.day = local_ts::date and (c.site_id is null or c.site_id = site.id)
  limit 1;
  if closure is not null then
    return 'The office is closed today for ' || closure || '.';                  -- R5.1.2
  end if;
  if local_ts::time < site.window_start or local_ts::time > site.window_end then
    return 'Clocking is open ' || lower(to_char(site.window_start, 'FMHH12:MI am')) || ' to '
      || lower(to_char(site.window_end, 'FMHH12:MI am')) || ' on weekdays.';     -- R5.1.2
  end if;
  if clock_block_reason.event_type = 'shift_in' and local_ts::date < pl.start_date then
    return 'Your placement starts ' || private.fmt_day(pl.start_date) || '.';
  end if;
  if clock_block_reason.event_type = 'shift_in' and local_ts::date > pl.planned_end_date then
    return 'Your planned end date has passed. Ask your supervisor to extend your placement.';  -- review rule 4
  end if;

  select x.event_type into last_event from public.daymark_punches x
  where x.user_id = person and x.event_type in ('shift_in', 'shift_out')           -- R5.1.4 old breaks ignored
  order by x.occurred_at desc, x.source = 'auto_close' desc, x.created_at desc
  limit 1;
  if clock_block_reason.event_type = 'shift_in' and last_event = 'shift_in' then
    return 'You''re already clocked in. Clock out first.';                       -- R5.1.5
  end if;
  if clock_block_reason.event_type = 'shift_out' and last_event is distinct from 'shift_in' then
    return 'Clock in before you clock out.';                                     -- R5.1.5
  end if;

  if clock_block_reason.event_type = 'shift_in' then
    -- R5.1.6 the log for the previous shift date (before today) must exist. Clock-out is never blocked.
    select max(s.work_date) into prev_date from public.daymark_shifts s
    where s.placement_id = pl.id and s.work_date < local_ts::date;
    if prev_date is not null and not exists (
         select 1 from public.daymark_work_logs w where w.placement_id = pl.id and w.work_date = prev_date) then
      return 'Write your work log for ' || private.fmt_day(prev_date) || ' to clock in.';
    end if;

    -- R5.1.8 an unscheduled shift needs room under the site's hard capacity.
    if not exists (
         select 1 from public.daymark_scheduled_days d
         where d.placement_id = pl.id and d.work_date = local_ts::date and d.status = 'scheduled')
       and (select count(*) from public.daymark_scheduled_days d
            where d.site_id = pl.site_id and d.work_date = local_ts::date and d.status = 'scheduled') >= site.hard_capacity then
      return 'The office already has ' || site.hard_capacity || ' interns booked today, so there''s no room for an '
        || 'unscheduled shift. You can clock in on your scheduled days.';
    end if;
  end if;

  if exists (select 1 from public.daymark_punches x
             where x.user_id = person and x.source = 'device'
               and x.occurred_at > at - interval '60 seconds' and x.occurred_at <= at) then
    return 'You just clocked. Wait a minute and try again.';                     -- review rule 8
  end if;
  return null;
end;
$$;

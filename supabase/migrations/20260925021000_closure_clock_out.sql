-- Clock-out stays possible on a closure day added while the intern is already in (found in the
-- Phase 7 review). Same function as 20260925020300 with one condition relaxed.

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
  -- A closure added today must not trap someone already in: clocking out is still allowed.
  if closure is not null and not (clock_block_reason.event_type = 'shift_out') then
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

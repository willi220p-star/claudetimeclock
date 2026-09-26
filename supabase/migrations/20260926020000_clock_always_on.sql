-- 26 Sep requests (Dilip): clocking is always on — no weekday/weekend, office-hours or
-- closure-day block. GPS + selfie, the placement's own start/end dates, the office headcount cap
-- for unscheduled shifts (R5.1.8) and the previous day's work log (R5.1.6) are unchanged.
-- Days/times outside an intern's roster still count 0 hours until a supervisor or admin approves
-- them as extra time or overtime (private.compute_day, unchanged).
--
-- The audit log now keeps the actor's name at the time of the action, so it survives even if that
-- person is later deleted (private.delete_person keeps the audit log; only the profile goes).

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
  -- Always on (Dilip, 26 Sep): no weekend, office-hours or closure-day block.

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

-- ---------------------------------------------------------------------------
-- Audit log: keep the actor's name at the time of the action.
-- ---------------------------------------------------------------------------
alter table public.daymark_audit_log add column actor_name text;

-- Backfill what can still be resolved today; anything already unresolvable stays null (unchanged
-- from before this migration — we can't recover a name that was never stored).
update public.daymark_audit_log a
set actor_name = p.display_name
from public.daymark_profiles p
where p.id = a.actor_id and a.actor_name is null;

create or replace function private.audit(
  action text,
  table_name text,
  row_id text,
  before jsonb,
  after jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.daymark_audit_log (actor_id, actor_name, action, table_name, row_id, before, after, at)
  values (
    (select auth.uid()),
    (select p.display_name from public.daymark_profiles p where p.id = (select auth.uid())),
    action, table_name, row_id, before, after, private.clock_now()
  );
$$;

create or replace function private.audit_search(
  action text,
  table_name text,
  actor uuid,
  from_ts timestamptz,
  to_ts timestamptz,
  before_id bigint,
  page_size integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  entries jsonb;
begin
  perform private.require_admin();
  if audit_search.page_size is null or audit_search.page_size not between 1 and 200 then
    raise exception 'Show between 1 and 200 entries per page.' using errcode = '22023';
  end if;
  if audit_search.from_ts > audit_search.to_ts then
    raise exception 'The start of the range must be before its end.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc), '[]') into entries
  from (
    select a.id, a.at, a.actor_id, coalesce(a.actor_name, pr.display_name) as actor_name,
           a.action, a.table_name, a.row_id, a.before, a.after
    from public.daymark_audit_log a
    left join public.daymark_profiles pr on pr.id = a.actor_id
    where (audit_search.action is null or a.action = audit_search.action)
      and (audit_search.table_name is null or a.table_name = audit_search.table_name)
      and (audit_search.actor is null or a.actor_id = audit_search.actor)
      and (audit_search.from_ts is null or a.at >= audit_search.from_ts)
      and (audit_search.to_ts is null or a.at < audit_search.to_ts)
      and (audit_search.before_id is null or a.id < audit_search.before_id)
    order by a.id desc
    limit audit_search.page_size
  ) e;

  return jsonb_build_object('rows', entries, 'next_before_id',
    case when jsonb_array_length(entries) = audit_search.page_size then entries -> -1 -> 'id' end);
end;
$$;

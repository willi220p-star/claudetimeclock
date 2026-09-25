-- Phase 4: who's in today (§6, §11.3), per-day headcounts for the schedule (R5.3.3), the
-- ClockCard status, and Realtime for notifications and punches (§10).

-- The site a person looks at: an intern's placement site; for staff the given site, else the
-- site of their first intern, else the first active site.
create or replace function private.my_site(site uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case when private.is_admin() or exists (
      select 1 from public.daymark_profiles me where me.id = (select auth.uid()) and me.is_supervisor and me.active)
    then site end,
    (private.live_placement((select auth.uid()))).site_id,
    (select p.site_id from public.daymark_placements p where p.supervisor_id = (select auth.uid())
     order by (p.status in ('active', 'extended', 'target_reached')) desc, p.created_at desc limit 1),
    (select s.id from public.daymark_sites s where s.active order by s.created_at limit 1)
  );
$$;

create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin() or exists (
    select 1 from public.daymark_profiles me where me.id = (select auth.uid()) and me.is_supervisor and me.active);
$$;

-- R5.3.3 interns see x/3 and "Full", never a 4th; staff see the real count and the extra spot.
create or replace function private.capacity_label(n integer, std integer, staff boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when not staff and n >= std then 'Full'
    when not staff then n || '/' || std
    when n > std then n || '/' || std || ' (+' || (n - std) || ' extra spot)'
    else n || '/' || std
  end;
$$;

create or replace function private.today_board(site uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  staff boolean := private.is_staff();
  s public.daymark_sites%rowtype;
  today date := private.darwin_today();
  now_ts timestamptz := private.clock_now();
  grace interval := make_interval(mins => (select g.grace_minutes from public.daymark_settings g where g.id = 1));
  n integer;
  people jsonb;
begin
  select * into s from public.daymark_sites x where x.id = private.my_site(site);
  if s.id is null or (not staff and s.id is distinct from (private.live_placement(me)).site_id) then
    raise exception 'You don''t have access to this office''s board.' using errcode = '42501';
  end if;

  select count(*) into n from public.daymark_scheduled_days d
  where d.site_id = s.id and d.work_date = today and d.status = 'scheduled';

  with days as (
    select d.*, p.intern_id, p.supervisor_id,
           row_number() over (partition by d.status order by d.created_at, d.id) as seq
    from public.daymark_scheduled_days d
    join public.daymark_placements p on p.id = d.placement_id
    where d.site_id = s.id and d.work_date = today and d.status in ('scheduled', 'leave')
  ), punched as (
    select x.user_id, max(p.supervisor_id::text)::uuid as supervisor_id,
           min(x.occurred_at) filter (where x.event_type = 'shift_in') as first_in,
           (array_agg(x.event_type order by x.occurred_at desc, x.created_at desc))[1] as last_event
    from public.daymark_punches x
    join public.daymark_placements p on p.id = x.placement_id
    where p.site_id = s.id and x.event_type in ('shift_in', 'shift_out')
      and x.occurred_at >= private.darwin_at(today, '00:00') and x.occurred_at < private.darwin_at(today + 1, '00:00')
    group by x.user_id
  ), rows as (
    select coalesce(d.intern_id, pu.user_id) as person_id,
           coalesce(d.supervisor_id, pu.supervisor_id) as supervisor_id,
           d.status as day_status, d.start_time, d.end_time, d.seq, pu.first_in, pu.last_event
    from days d
    full join punched pu on pu.user_id = d.intern_id
  ), shaped as (
    select r.*, pr.display_name,
      case
        when r.day_status = 'leave' then 'leave'
        when r.last_event = 'shift_in' then 'in'
        when r.last_event = 'shift_out' then 'done'
        when now_ts >= private.darwin_at(today, r.end_time) then 'no_show'
        when now_ts > private.darwin_at(today, r.start_time) + grace then 'late'
        else 'not_in_yet'
      end as status,
      (r.start_time is not null and r.first_in > private.darwin_at(today, r.start_time) + grace) as late,
      (r.start_time is null) as unscheduled,
      (r.day_status = 'scheduled' and r.seq > s.standard_capacity) as extra,
      (private.is_admin() or r.supervisor_id = me) as mine
    from rows r
    join public.daymark_profiles pr on pr.id = r.person_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'display_name', x.display_name,
      'initials', upper(left(split_part(x.display_name, ' ', 1), 1) || left(split_part(x.display_name, ' ', 2), 1)),
      'status', x.status,
      'unscheduled', x.unscheduled,
      'me', x.person_id = me
    )
    || case when staff and x.mine then jsonb_build_object(
         'person_id', x.person_id, 'since', x.first_in, 'start', x.start_time, 'end', x.end_time,
         'late', x.late, 'extra', x.extra)
       else '{}'::jsonb end
    order by x.display_name), '[]')
  into people
  from shaped x;

  return jsonb_build_object(
    'date', today,
    'site', jsonb_build_object('id', s.id, 'name', s.name, 'standard_capacity', s.standard_capacity),
    'count', case when staff then n else least(n, s.standard_capacity) end,
    'label', private.capacity_label(n, s.standard_capacity, staff),
    'people', people
  );
end;
$$;

create or replace function private.site_headcounts(from_date date, to_date date, site uuid)
returns table (work_date date, headcount integer, label text, full boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  staff boolean := private.is_staff();
  s public.daymark_sites%rowtype;
begin
  select * into s from public.daymark_sites x where x.id = private.my_site(site);
  if s.id is null or (not staff and s.id is distinct from (private.live_placement((select auth.uid()))).site_id) then
    raise exception 'You don''t have access to this office''s schedule.' using errcode = '42501';
  end if;
  if to_date < from_date or to_date - from_date > 92 then
    raise exception 'Ask for up to three months at a time.' using errcode = '22023';
  end if;

  return query
  select g.d::date,
         case when staff then coalesce(c.n, 0) else least(coalesce(c.n, 0), s.standard_capacity) end::integer,
         private.capacity_label(coalesce(c.n, 0)::integer, s.standard_capacity, staff),
         coalesce(c.n, 0) >= s.standard_capacity
  from generate_series(from_date, to_date, interval '1 day') g(d)
  left join lateral (
    select count(*) as n from public.daymark_scheduled_days d
    where d.site_id = s.id and d.work_date = g.d::date and d.status = 'scheduled'
  ) c on true
  order by 1;
end;
$$;

-- Everything the ClockCard needs in one round trip. The block reason comes from the same
-- function the punch trigger uses, so the button and the database always agree.
create or replace function private.clock_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  now_ts timestamptz := private.clock_now();
  today date := private.darwin_today();
  pl public.daymark_placements%rowtype;
  last_event text;
  last_at timestamptz;
  next_event text;
  reason text;
  day public.daymark_scheduled_days%rowtype;
begin
  pl := private.live_placement(me);
  if pl.id is null then
    select * into pl from public.daymark_placements p where p.id = private.current_placement(me);
  end if;

  select x.event_type, x.occurred_at into last_event, last_at
  from public.daymark_punches x
  where x.user_id = me and x.event_type in ('shift_in', 'shift_out')
  order by x.occurred_at desc, x.created_at desc
  limit 1;
  next_event := case when last_event = 'shift_in' then 'shift_out' else 'shift_in' end;
  reason := private.clock_block_reason(me, next_event, now_ts);

  select * into day from public.daymark_scheduled_days d
  where d.placement_id = pl.id and d.work_date = today and d.status in ('scheduled', 'leave');

  return jsonb_build_object(
    'server_now', now_ts,
    'today', today,
    'next_event', next_event,
    'open_since', case when last_event = 'shift_in' then last_at end,
    'blocked', reason,
    'block_code', case
      when reason is null then null
      when reason like '%weekends%' then 'weekend'
      when reason like 'The office is closed today%' then 'closure'
      when reason like 'Clocking is open%' then 'window'
      when reason ilike '%work log%' then 'work_log'
      when reason like '%placement has ended%' then 'read_only'
      when reason ilike '%full%' then 'full'
      when reason like '%paused%' then 'paused'
      when reason like '%don''t have a placement%' then 'no_placement'
      when reason like '%target hours%' then 'target_reached'
      when reason like 'Your placement starts%' then 'not_started'
      when reason like '%end date has passed%' then 'past_end'
      when reason like '%Wait a minute%' then 'rate'
      else 'sequence'
    end,
    'consent', private.my_consent(),
    'needs_consent', not (private.has_consent(me, 'location') and private.has_consent(me, 'selfie')),
    'scheduled', case when day.id is null then null else jsonb_build_object(
      'start', day.start_time, 'end', day.end_time, 'planned_minutes', day.planned_minutes, 'status', day.status,
      'leave_kind', day.leave_kind) end,
    'placement', case when pl.id is null then null else jsonb_build_object(
      'id', pl.id, 'status', pl.status, 'start_date', pl.start_date, 'planned_end_date', pl.planned_end_date,
      'ended_on', pl.ended_on,
      'read_only', pl.status in ('completed', 'withdrawn'),
      'delete_on', case when pl.ended_on is not null then private.retention_date(pl.ended_on) end) end
  );
end;
$$;

create or replace function public.today_board(site uuid default null)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.today_board(site); $$;

create or replace function public.site_headcounts(from_date date, to_date date, site uuid default null)
returns table (work_date date, headcount integer, label text, full boolean)
language sql stable security invoker set search_path = ''
as $$ select * from private.site_headcounts(from_date, to_date, site); $$;

create or replace function public.clock_status()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.clock_status(); $$;

revoke all on function private.my_site(uuid) from public, anon;
revoke all on function private.is_staff() from public, anon;
revoke all on function private.capacity_label(integer, integer, boolean) from public, anon;
revoke all on function private.today_board(uuid) from public, anon;
revoke all on function private.site_headcounts(date, date, uuid) from public, anon;
revoke all on function private.clock_status() from public, anon;
revoke all on function public.today_board(uuid) from public, anon;
revoke all on function public.site_headcounts(date, date, uuid) from public, anon;
revoke all on function public.clock_status() from public, anon;
grant execute on function private.my_site(uuid) to authenticated;
grant execute on function private.is_staff() to authenticated;
grant execute on function private.capacity_label(integer, integer, boolean) to authenticated;
grant execute on function private.today_board(uuid) to authenticated;
grant execute on function private.site_headcounts(date, date, uuid) to authenticated;
grant execute on function private.clock_status() to authenticated;
grant execute on function public.today_board(uuid) to authenticated;
grant execute on function public.site_headcounts(date, date, uuid) to authenticated;
grant execute on function public.clock_status() to authenticated;

-- §10 Realtime: clients subscribe with RLS and fall back to 60-second polling.
alter publication supabase_realtime add table public.daymark_notifications, public.daymark_punches;

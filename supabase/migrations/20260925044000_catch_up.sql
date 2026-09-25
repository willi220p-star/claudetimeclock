-- Phase 5: catch-up planner (§8.7). Two options to pay down the owed balance, both obeying
-- C1–C7 and never proposing a 4th spot: A = longer upcoming days (shift_change requests),
-- B = extra days at the usual times (extra_day requests). submit_catch_up recomputes the chosen
-- option on the server and files every request in one transaction.

create or replace function private.planned_length(minutes integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select minutes - case when minutes > 300 then 30 else 0 end;   -- R5.2.4
$$;

create or replace function private.catch_up_plan(placement uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype;
  site public.daymark_sites%rowtype;
  owed integer;
  need integer;
  earliest timestamptz := private.clock_now()
    + make_interval(hours => (select s.notice_hours from public.daymark_settings s where s.id = 1));
  day record;
  len integer;
  best integer;
  best_start time;
  best_end time;
  try_len integer;
  gain integer;
  a jsonb := '[]';
  a_cover integer := 0;
  b jsonb := '[]';
  b_cover integer := 0;
  usual_start time;
  usual_end time;
  usual_planned integer;
  d date;
begin
  if not private.can_view_placement(placement) then
    raise exception 'You don''t have access to this placement.' using errcode = '42501';
  end if;
  select * into pl from public.daymark_placements where id = placement;
  select * into site from public.daymark_sites where id = pl.site_id;
  select r.owed into owed from private.progress_rows(array[placement]) r;
  owed := coalesce(owed, 0);

  if owed <= 0 or pl.status not in ('active', 'extended') then
    return jsonb_build_object('owed_minutes', owed,
      'a', jsonb_build_object('requests', '[]'::jsonb, 'covers_minutes', 0, 'fully_covers', owed <= 0),
      'b', jsonb_build_object('requests', '[]'::jsonb, 'covers_minutes', 0, 'fully_covers', owed <= 0));
  end if;

  -- Option A: lengthen upcoming scheduled days, end later first, then start earlier.
  need := owed;
  for day in
    select s.* from public.daymark_scheduled_days s
    where s.placement_id = placement and s.status = 'scheduled'
      and s.work_date <= pl.planned_end_date
      and private.darwin_at(s.work_date, s.start_time) >= earliest
      and not exists (select 1 from public.daymark_requests r
                      where r.intern_id = pl.intern_id and r.status in ('pending_supervisor', 'pending_admin')
                        and s.work_date = any (r.dates))
    order by s.work_date
  loop
    exit when need <= 0;
    len := (extract(epoch from day.end_time - day.start_time) / 60)::integer;
    best := null;
    try_len := len + 15;
    while try_len <= 600 loop
      if day.start_time + make_interval(mins => try_len) <= site.window_end then
        best_start := day.start_time;
        best_end := day.start_time + make_interval(mins => try_len);
      elsif day.end_time - make_interval(mins => try_len) >= site.window_start then
        best_start := day.end_time - make_interval(mins => try_len);
        best_end := day.end_time;
      else
        exit;
      end if;
      best := try_len;
      gain := private.planned_length(try_len) - private.planned_length(len);
      exit when gain >= need;
      try_len := try_len + 15;
    end loop;
    if best is not null then
      gain := private.planned_length(best) - private.planned_length(len);
      if gain > 0 then
        a := a || jsonb_build_object(
          'type', 'shift_change',
          'payload', jsonb_build_object('scheduled_day_id', day.id, 'start', to_char(best_start, 'HH24:MI'),
                                        'end', to_char(best_end, 'HH24:MI')),
          'gain_minutes', gain,
          'label', private.fmt_day(day.work_date) || ': ' || private.fmt_clock(best_start) || '–' || private.fmt_clock(best_end)
            || ' (+' || private.fmt_duration(gain) || ')');
        a_cover := a_cover + gain;
        need := need - gain;
      end if;
    end if;
  end loop;

  -- Option B: extra days at the usual (most common) times on days under standard capacity.
  select x.start_time, x.end_time into usual_start, usual_end
  from public.daymark_pattern_days x
  where x.pattern_version_id = (
    select v.id from public.daymark_pattern_versions v
    where v.placement_id = placement and v.effective_from <= private.darwin_today()
    order by v.effective_from desc limit 1)
  group by x.start_time, x.end_time
  order by count(*) desc, x.start_time
  limit 1;

  need := owed;
  if usual_start is not null then
    usual_planned := private.planned_length((extract(epoch from usual_end - usual_start) / 60)::integer);
    for d in
      select g.d::date
      from generate_series((earliest at time zone 'Australia/Darwin')::date, pl.planned_end_date, interval '1 day') g(d)
      where extract(isodow from g.d) <= 5
        and private.darwin_at(g.d::date, usual_start) >= earliest
        and not exists (select 1 from public.daymark_closure_days c
                        where c.day = g.d::date and (c.site_id is null or c.site_id = pl.site_id))
        and not exists (select 1 from public.daymark_scheduled_days s
                        where s.placement_id = placement and s.work_date = g.d::date and s.status in ('scheduled', 'leave'))
        and not exists (select 1 from public.daymark_requests r
                        where r.intern_id = pl.intern_id and r.status in ('pending_supervisor', 'pending_admin')
                          and g.d::date = any (r.dates))
        and (select count(*) from public.daymark_scheduled_days s
             where s.site_id = pl.site_id and s.work_date = g.d::date and s.status = 'scheduled') < site.standard_capacity
      order by 1
    loop
      exit when need <= 0;
      b := b || jsonb_build_object(
        'type', 'extra_day',
        'payload', jsonb_build_object('date', d, 'start', to_char(usual_start, 'HH24:MI'), 'end', to_char(usual_end, 'HH24:MI')),
        'gain_minutes', usual_planned,
        'label', private.fmt_day(d) || ': ' || private.fmt_clock(usual_start) || '–' || private.fmt_clock(usual_end)
          || ' (+' || private.fmt_duration(usual_planned) || ')');
      b_cover := b_cover + usual_planned;
      need := need - usual_planned;
    end loop;
  end if;

  return jsonb_build_object('owed_minutes', owed,
    'a', jsonb_build_object('requests', a, 'covers_minutes', a_cover, 'fully_covers', a_cover >= owed),
    'b', jsonb_build_object('requests', b, 'covers_minutes', b_cover, 'fully_covers', b_cover >= owed));
end;
$$;

create or replace function private.submit_catch_up(placement uuid, option text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan jsonb;
  item jsonb;
  created jsonb := '[]';
begin
  if not exists (select 1 from public.daymark_placements p where p.id = placement and p.intern_id = (select auth.uid())) then
    raise exception 'Only the intern sends their catch-up requests.' using errcode = '42501';
  end if;
  if option not in ('a', 'b') then
    raise exception 'Pick option A or B.' using errcode = '22023';
  end if;
  plan := private.catch_up_plan(placement) -> option;       -- recomputed here, never trusted from the client
  if jsonb_array_length(plan -> 'requests') = 0 then
    raise exception 'There''s nothing to catch up with this option right now.' using errcode = '22023';
  end if;
  for item in select * from jsonb_array_elements(plan -> 'requests') loop
    created := created || private.create_request(item ->> 'type', item -> 'payload', 'Catch-up plan');
  end loop;
  return jsonb_build_object('option', option, 'covers_minutes', plan -> 'covers_minutes', 'requests', created);
end;
$$;

create or replace function public.catch_up_options(placement uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.catch_up_plan(placement); $$;

create or replace function public.submit_catch_up(placement uuid, option text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.submit_catch_up(placement, option); $$;

revoke all on function private.planned_length(integer) from public, anon;
revoke all on function private.catch_up_plan(uuid) from public, anon;
revoke all on function private.submit_catch_up(uuid, text) from public, anon;
revoke all on function public.catch_up_options(uuid) from public, anon;
revoke all on function public.submit_catch_up(uuid, text) from public, anon;
grant execute on function private.planned_length(integer) to authenticated;
grant execute on function private.catch_up_plan(uuid) to authenticated;
grant execute on function private.submit_catch_up(uuid, text) to authenticated;
grant execute on function public.catch_up_options(uuid) to authenticated;
grant execute on function public.submit_catch_up(uuid, text) to authenticated;

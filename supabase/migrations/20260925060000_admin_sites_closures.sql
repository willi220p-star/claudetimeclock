-- Phase 7: admin configuration of sites and closure days (§6, §10, §11.3, R5.2.5, R5.3).
-- Admin only, validated here (the browser only displays and submits), audited with before/after.

-- ---------------------------------------------------------------------------
-- Sites
-- ---------------------------------------------------------------------------

-- Creates ({no id}) or updates ({id}) a site. Keys left out keep the current value, or the
-- default for a new site. `active` changes only through set_site_active.
create or replace function private.save_site(site jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid;
  old_row public.daymark_sites%rowtype;
  r public.daymark_sites%rowtype;
  base jsonb := '{"radius_m": 200, "standard_capacity": 3, "hard_capacity": 4,
                  "window_start": "07:00", "window_end": "19:00", "active": true}';
  busy record;
begin
  perform private.require_admin();
  if jsonb_typeof(site) is distinct from 'object' then
    raise exception 'Send the site details.' using errcode = '22023';
  end if;

  begin
    sid := nullif(site ->> 'id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'That site doesn''t exist.' using errcode = '22023';
  end;
  if sid is not null then
    select * into old_row from public.daymark_sites s where s.id = sid for update;
    if not found then
      raise exception 'That site doesn''t exist.' using errcode = '22023';
    end if;
    base := to_jsonb(old_row);
  end if;

  begin
    r := jsonb_populate_record(null::public.daymark_sites, base || (site - 'id' - 'active' - 'created_at'));
  exception when others then
    raise exception 'Check the site details: numbers for the location, radius and capacity, and times like 07:00.'
      using errcode = '22023';
  end;

  r.name := btrim(r.name);
  r.address := btrim(r.address);
  if coalesce(char_length(r.name), 0) not between 1 and 80 then
    raise exception 'Give the site a name up to 80 characters.' using errcode = '22023';
  end if;
  if coalesce(char_length(r.address), 0) not between 1 and 240 then
    raise exception 'Enter the site''s address, up to 240 characters.' using errcode = '22023';
  end if;
  -- NaN and Infinity fail these ranges too.
  if not (r.latitude between -90 and 90) or not (r.longitude between -180 and 180)
     or r.latitude is null or r.longitude is null then
    raise exception 'Enter a latitude from -90 to 90 and a longitude from -180 to 180.' using errcode = '22023';
  end if;
  if r.radius_m is null or r.radius_m not between 20 and 2000 then
    raise exception 'Set the geofence radius between 20 and 2,000 metres.' using errcode = '22023';
  end if;
  if r.standard_capacity is null or r.standard_capacity not between 1 and 50 then
    raise exception 'Set the standard capacity between 1 and 50.' using errcode = '22023';
  end if;
  if r.hard_capacity is null or r.hard_capacity not between r.standard_capacity and 50 then
    raise exception 'Set the hard limit between the standard capacity and 50.' using errcode = '22023';
  end if;
  if r.window_start is null or r.window_end is null or r.window_start >= r.window_end
     or r.window_end > '23:59' or extract(epoch from r.window_start) % 900 <> 0
     or extract(epoch from r.window_end) % 900 <> 0 then
    raise exception 'The clock-in window must start before it ends, between 00:00 and 23:59, in 15-minute steps.'
      using errcode = '22023';
  end if;

  if sid is null then
    insert into public.daymark_sites (name, address, latitude, longitude, radius_m, standard_capacity, hard_capacity,
                                      window_start, window_end)
    values (r.name, r.address, r.latitude, r.longitude, r.radius_m, r.standard_capacity, r.hard_capacity,
            r.window_start, r.window_end)
    returning * into r;
    perform private.audit('create_site', 'daymark_sites', r.id::text, null, to_jsonb(r));
    return to_jsonb(r);
  end if;

  -- R5.3.5 a booked day must never sit above the hard limit.
  select s.work_date, count(*)::integer as n into busy
  from public.daymark_scheduled_days s
  where s.site_id = sid and s.status = 'scheduled' and s.work_date >= private.darwin_today()
  group by s.work_date
  order by count(*) desc, s.work_date
  limit 1;
  if busy.n > r.hard_capacity then
    raise exception '% already has % interns booked. Set the hard limit to at least %, or move someone first.',
      private.fmt_day(busy.work_date), busy.n, busy.n using errcode = '22023';
  end if;

  update public.daymark_sites s
  set name = r.name, address = r.address, latitude = r.latitude, longitude = r.longitude, radius_m = r.radius_m,
      standard_capacity = r.standard_capacity, hard_capacity = r.hard_capacity,
      window_start = r.window_start, window_end = r.window_end
  where s.id = sid
  returning * into r;
  perform private.audit('update_site', 'daymark_sites', sid::text, to_jsonb(old_row), to_jsonb(r));
  return to_jsonb(r);
end;
$$;

create or replace function private.set_site_active(id uuid, active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row public.daymark_sites%rowtype;
  r public.daymark_sites%rowtype;
  n integer;
begin
  perform private.require_admin();
  select * into old_row from public.daymark_sites s where s.id = set_site_active.id for update;
  if not found then
    raise exception 'That site doesn''t exist.' using errcode = '22023';
  end if;
  if set_site_active.active is null then
    raise exception 'Choose whether the site is open.' using errcode = '22023';
  end if;

  if not set_site_active.active then
    select count(*) into n from public.daymark_placements p
    where p.site_id = old_row.id and p.status in ('active', 'extended', 'target_reached');
    if n > 0 then
      raise exception 'This site has % live placement%. Move or end them before you turn the site off.',
        n, case when n = 1 then '' else 's' end using errcode = '22023';
    end if;
    if not exists (select 1 from public.daymark_sites s where s.active and s.id <> old_row.id) then
      raise exception 'Keep at least one site open.' using errcode = '22023';
    end if;
  end if;

  update public.daymark_sites s set active = set_site_active.active where s.id = old_row.id returning * into r;
  perform private.audit('set_site_active', 'daymark_sites', r.id::text,
    jsonb_build_object('active', old_row.active), jsonb_build_object('active', r.active));
  return to_jsonb(r);
end;
$$;

create or replace function public.save_site(site jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.save_site(site); $$;

create or replace function public.set_site_active(id uuid, active boolean)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.set_site_active(id, active); $$;

revoke all on function private.save_site(jsonb) from public, anon;
revoke all on function private.set_site_active(uuid, boolean) from public, anon;
revoke all on function public.save_site(jsonb) from public, anon;
revoke all on function public.set_site_active(uuid, boolean) from public, anon;
grant execute on function private.save_site(jsonb) to authenticated;
grant execute on function private.set_site_active(uuid, boolean) to authenticated;
grant execute on function public.save_site(jsonb) to authenticated;
grant execute on function public.set_site_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Closure days
-- ---------------------------------------------------------------------------

-- Adds a closure day for one site (or every site when site_id is null), today or later. Saving
-- the same site and day again renames it. On insert the existing trigger
-- private.on_closure_day_added cancels the days, tells the interns and audits (R5.2.5).
create or replace function private.save_closure_day(site_id uuid, day date, name text, kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(save_closure_day.name, ''));
  old_row public.daymark_closure_days%rowtype;
  r public.daymark_closure_days%rowtype;
  n integer;
begin
  perform private.require_admin();
  if save_closure_day.day is null or save_closure_day.day < private.darwin_today() then
    raise exception 'Closure days can be added for today or later.' using errcode = '22023';
  end if;
  if extract(isodow from save_closure_day.day) > 5 then
    raise exception 'The office is always closed on weekends. Pick a weekday.' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'Give the closure day a name up to 80 characters.' using errcode = '22023';
  end if;
  if save_closure_day.kind is null or save_closure_day.kind not in ('public_holiday', 'office_closure') then
    raise exception 'Pick public holiday or office closure.' using errcode = '22023';
  end if;
  if save_closure_day.site_id is not null
     and not exists (select 1 from public.daymark_sites s where s.id = save_closure_day.site_id) then
    raise exception 'That site doesn''t exist.' using errcode = '22023';
  end if;

  select * into old_row from public.daymark_closure_days c
  where c.day = save_closure_day.day and c.site_id is not distinct from save_closure_day.site_id
  for update;
  if found then
    update public.daymark_closure_days c set name = v_name, kind = save_closure_day.kind
    where c.id = old_row.id returning * into r;
    perform private.audit('update_closure_day', 'daymark_closure_days', r.id::text, to_jsonb(old_row), to_jsonb(r));
    return to_jsonb(r) || '{"cancelled_days": 0}';
  end if;

  select count(*) into n from public.daymark_scheduled_days s
  where s.work_date = save_closure_day.day and s.status in ('scheduled', 'leave')
    and (save_closure_day.site_id is null or s.site_id = save_closure_day.site_id);
  begin
    insert into public.daymark_closure_days (site_id, day, name, kind)
    values (save_closure_day.site_id, save_closure_day.day, v_name, save_closure_day.kind)
    returning * into r;
  exception when unique_violation then
    raise exception 'There''s already a closure day on %. Refresh and try again.', private.fmt_day(save_closure_day.day)
      using errcode = '23505';
  end;
  return to_jsonb(r) || jsonb_build_object('cancelled_days', n);
end;
$$;

-- Removes a future closure day and puts the pattern days back for live placements at that
-- site on that date, in placement order. A day that would need an extra spot (above standard
-- capacity) is skipped and listed for the admin, who can add it deliberately. A day the intern
-- swapped away ('moved') stays away. Returns {id, day, restored: [...], skipped: [...]}.
create or replace function private.remove_closure_day(id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.daymark_closure_days%rowtype;
  pl record;
  extra date[];
  item jsonb;
  restored jsonb := '[]';
  skipped jsonb := '[]';
begin
  perform private.require_admin();
  select * into c from public.daymark_closure_days x where x.id = remove_closure_day.id for update;
  if not found then
    raise exception 'That closure day doesn''t exist.' using errcode = '22023';
  end if;
  if c.day <= private.darwin_today() then
    raise exception 'Only a future closure day can be removed.' using errcode = '22023';
  end if;

  delete from public.daymark_closure_days x where x.id = c.id;

  for pl in
    select p.id, p.intern_id, p.site_id, pr.display_name, cand.start_time, cand.end_time
    from public.daymark_placements p
    join public.daymark_profiles pr on pr.id = p.intern_id
    -- R5.2.2: pattern weekday, inside the placement, no other closure, no live day already
    cross join lateral private.pattern_candidates(p.id, c.day, c.day) cand
    where p.status in ('active', 'extended', 'target_reached')
      and (c.site_id is null or p.site_id = c.site_id)
      and not exists (select 1 from public.daymark_scheduled_days s
                      where s.placement_id = p.id and s.work_date = c.day and s.status = 'moved')
    order by p.created_at, p.id
  loop
    item := jsonb_build_object('placement_id', pl.id, 'intern_id', pl.intern_id,
                               'display_name', pl.display_name, 'work_date', c.day);
    begin
      extra := private.assert_capacity(pl.site_id, array[c.day], false);
    exception when sqlstate 'P0001' then
      extra := array[c.day];                                   -- already at the hard limit
    end;
    if cardinality(extra) > 0 then                             -- R5.3.4 never an unapproved extra spot
      skipped := skipped || (item || '{"reason": "extra_spot"}');
      continue;
    end if;

    perform private.generate_days(pl.id, c.day, c.day);
    perform private.notify(pl.intern_id, 'schedule', private.fmt_day(c.day) || ' is back on your schedule',
      'The office is open after all. You''re on from ' || lower(to_char(pl.start_time, 'FMHH12:MI am'))
        || ' to ' || lower(to_char(pl.end_time, 'FMHH12:MI am')) || '.',
      '/clock/schedule');
    restored := restored || (item || jsonb_build_object('start_time', pl.start_time, 'end_time', pl.end_time));
  end loop;

  perform private.audit('remove_closure_day', 'daymark_closure_days', c.id::text, to_jsonb(c),
    jsonb_build_object('restored', restored, 'skipped', skipped));
  return jsonb_build_object('id', c.id, 'day', c.day, 'restored', restored, 'skipped', skipped);
end;
$$;

create or replace function public.save_closure_day(site_id uuid, day date, name text, kind text default 'public_holiday')
returns jsonb language sql security invoker set search_path = ''
as $$ select private.save_closure_day(site_id, day, name, kind); $$;

create or replace function public.remove_closure_day(id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.remove_closure_day(id); $$;

revoke all on function private.save_closure_day(uuid, date, text, text) from public, anon;
revoke all on function private.remove_closure_day(uuid) from public, anon;
revoke all on function public.save_closure_day(uuid, date, text, text) from public, anon;
revoke all on function public.remove_closure_day(uuid) from public, anon;
grant execute on function private.save_closure_day(uuid, date, text, text) to authenticated;
grant execute on function private.remove_closure_day(uuid) to authenticated;
grant execute on function public.save_closure_day(uuid, date, text, text) to authenticated;
grant execute on function public.remove_closure_day(uuid) to authenticated;

-- 29 Sep requests (Dilip): self-service name change, announcement banners, a full account wipe
-- (and a collection notice that says so), staff roster edits by date range or single day, and
-- the parts of "always on" clocking that still assumed a 7 pm close.

-- ---------------------------------------------------------------------------
-- 0. Always-on clocking, finished.
-- ---------------------------------------------------------------------------

-- A shift that is still open 12 hours after its clock-in gets a system clock-out at its own
-- clock-in instant, so it counts 0 until a punch fix is approved (D3). Runs hourly.
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
      and x.clock_in_at + interval '12 hours' <= private.clock_now()
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

select cron.schedule('daymark-auto-close', '5 * * * *', 'select private.job_auto_close()');   -- hourly

-- A shift belongs to the Darwin day it started. An open clock-in pairs with the next clock-out
-- within 16 hours, even after midnight; the next day skips that clock-out and rebuilds the day
-- before, so the overnight shift is counted once, on its start day.
create or replace function private.rebuild_shifts(placement uuid, work_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  first_event text;
  first_at timestamptz;
  before_punch record;
  next_punch record;
  in_id uuid;
  in_at timestamptz;
  in_unverified boolean;
  unscheduled boolean;
  day_start timestamptz := private.darwin_at(rebuild_shifts.work_date, '00:00');
  day_end timestamptz := private.darwin_at(rebuild_shifts.work_date + 1, '00:00');
begin
  delete from public.daymark_shifts s where s.placement_id = placement and s.work_date = rebuild_shifts.work_date;
  unscheduled := not exists (
    select 1 from public.daymark_scheduled_days d
    where d.placement_id = placement and d.work_date = rebuild_shifts.work_date and d.status = 'scheduled');

  for p in
    select x.id, x.event_type, x.occurred_at, x.source,
           x.source = 'supervisor' and x.confirmed_at is null as unverified
    from public.daymark_punches x
    where x.placement_id = placement
      and x.occurred_at >= day_start and x.occurred_at < day_end
      and x.event_type in ('shift_in', 'shift_out')                                 -- R5.1.4 breaks ignored
      and not exists (select 1 from public.daymark_punches f where f.replaces_punch_id = x.id)  -- fixes supersede
    -- At the same instant an auto-close clock-out follows its clock-in (D3); otherwise out before in.
    order by x.occurred_at, x.source = 'auto_close', x.event_type desc, x.created_at, x.id
  loop
    if first_event is null then
      first_event := p.event_type;
      first_at := p.occurred_at;
    end if;
    if p.event_type = 'shift_in' then
      in_id := p.id;
      in_at := p.occurred_at;
      in_unverified := p.unverified;
    elsif in_id is not null then
      insert into public.daymark_shifts (placement_id, work_date, clock_in_at, clock_out_at, in_punch_id, out_punch_id,
                                         auto_closed, unscheduled, unverified)
      values (placement, work_date, in_at, p.occurred_at, in_id, p.id,
              p.source = 'auto_close', unscheduled, in_unverified or p.unverified);
      in_id := null;
    end if;
  end loop;

  -- Still open at midnight: the next clock-out within 16 hours closes it.
  if in_id is not null then
    select x.id, x.event_type, x.occurred_at, x.source,
           x.source = 'supervisor' and x.confirmed_at is null as unverified
    into next_punch
    from public.daymark_punches x
    where x.placement_id = placement and x.occurred_at >= day_end
      and x.event_type in ('shift_in', 'shift_out')
      and not exists (select 1 from public.daymark_punches f where f.replaces_punch_id = x.id)
    order by x.occurred_at, x.source = 'auto_close', x.event_type desc, x.created_at, x.id
    limit 1;
    if next_punch.event_type = 'shift_out' and next_punch.occurred_at <= in_at + interval '16 hours' then
      insert into public.daymark_shifts (placement_id, work_date, clock_in_at, clock_out_at, in_punch_id, out_punch_id,
                                         auto_closed, unscheduled, unverified)
      values (placement, work_date, in_at, next_punch.occurred_at, in_id, next_punch.id,
              next_punch.source = 'auto_close', unscheduled, in_unverified or next_punch.unverified);
    else
      insert into public.daymark_shifts (placement_id, work_date, clock_in_at, in_punch_id, unscheduled, unverified)
      values (placement, work_date, in_at, in_id, unscheduled, in_unverified);
    end if;
  end if;

  perform private.recompute_day(placement, work_date);

  -- This day opens with a clock-out: it closes yesterday's overnight shift, so rebuild yesterday.
  if first_event = 'shift_out' then
    select x.event_type, x.occurred_at into before_punch
    from public.daymark_punches x
    where x.placement_id = placement and x.occurred_at < day_start
      and x.event_type in ('shift_in', 'shift_out')
      and not exists (select 1 from public.daymark_punches f where f.replaces_punch_id = x.id)
    order by x.occurred_at desc, x.source = 'auto_close' desc, x.created_at desc
    limit 1;
    if before_punch.event_type = 'shift_in' and first_at <= before_punch.occurred_at + interval '16 hours' then
      perform private.rebuild_shifts(placement, (before_punch.occurred_at at time zone 'Australia/Darwin')::date);
    end if;
  end if;
end;
$$;

-- Punch fixes: any time of day now that clocking is always on. The clock-out still has to be
-- after the clock-in on the same date.
-- ponytail: a fix for an overnight shift (out after midnight) isn't supported; the supervisor
-- confirms those by hand. Upgrade: an out-date field on the punch-fix payload.
create or replace function private.punch_fix_error(req public.daymark_requests, site public.daymark_sites)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p jsonb := jsonb_strip_nulls(req.payload);
  d date := (p ->> 'date')::date;
  cin time := (p ->> 'clock_in')::time;
  cout time := (p ->> 'clock_out')::time;
  rin uuid := (p ->> 'replaces_in_punch_id')::uuid;
  rout uuid := (p ->> 'replaces_out_punch_id')::uuid;
  ts_in timestamptz := private.darwin_at(d, cin);
  ts_out timestamptz := private.darwin_at(d, cout);
  s record;
  s2 record;
  r_in timestamptz;
  r_out timestamptz;
begin
  if ts_in > private.clock_now() or ts_out > private.clock_now() then
    return 'Punch-fix times must be in the past.';
  end if;
  if cout <= cin then
    return 'The clock-out has to be after the clock-in.';
  end if;

  -- Which existing shift the fix changes, if any (none: a whole new shift).
  select null::uuid as in_id, null::timestamptz as in_at, null::uuid as out_id, null::timestamptz as out_at into s;
  if rin is not null then
    select * into s from private.punch_fix_shifts(req.intern_id, d) x where x.in_id = rin;
    if not found then
      return 'That clock-in isn''t one of your punches on ' || private.fmt_day(d) || '.';
    end if;
  end if;
  if rout is not null then
    select * into s2 from private.punch_fix_shifts(req.intern_id, d) x where x.out_id = rout;
    if not found then
      return 'That clock-out isn''t one of your punches on ' || private.fmt_day(d) || '.';
    end if;
    if rin is not null and s.in_id <> s2.in_id then
      return 'Those punches belong to different shifts. Fix one shift at a time.';
    end if;
    s := s2;
  end if;
  if rin is null and rout is null then
    if cout is null then
      return 'Add the clock-out time too, or pick the clock-in you''re correcting.';
    end if;
    if cin is null then                                                   -- closes an open shift
      select * into s from private.punch_fix_shifts(req.intern_id, d) x where x.out_id is null
      order by x.in_at desc limit 1;
      if not found then
        return 'There''s no open clock-in on ' || private.fmt_day(d) || ' to close. Add the clock-in time too.';
      end if;
    end if;
  end if;
  if s.in_id is not null and cin is not null and rin is null then
    return 'Also pick the clock-in you''re correcting.';
  end if;
  if s.out_id is not null and cout is not null and rout is null then
    return 'Also pick the clock-out you''re correcting.';
  end if;

  r_in := coalesce(ts_in, s.in_at);
  r_out := coalesce(ts_out, s.out_at);
  if r_out <= r_in then
    return 'The clock-out has to be after the clock-in.';
  end if;
  if exists (
    select 1 from private.punch_fix_shifts(req.intern_id, d) x
    where x.in_id is distinct from s.in_id
      and x.in_at <= coalesce(r_out, 'infinity') and r_in <= coalesce(x.out_at, 'infinity')
  ) then
    return 'Those times overlap another shift on ' || private.fmt_day(d)
      || '. Pick times that don''t clash with your other clock-ins and clock-outs.';
  end if;
  return null;
end;
$$;

-- The Home status reads the latest punch the same way the clock rules do: at the same instant an
-- auto-close clock-out comes after its clock-in, so an auto-closed shift never reads as "still in".
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
  order by x.occurred_at desc, x.source = 'auto_close' desc, x.created_at desc
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


-- ---------------------------------------------------------------------------
-- 2. Change your own name. Profiles stay closed to direct updates.
-- ---------------------------------------------------------------------------
create or replace function private.update_my_name(display_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  clean text := btrim(coalesce(update_my_name.display_name, ''));
  old_name text;
begin
  select p.display_name into old_name from public.daymark_profiles p where p.id = me and p.active;
  if not found then
    raise exception 'Sign in again to change your name.' using errcode = '42501';
  end if;
  if char_length(clean) not between 1 and 80 then
    raise exception 'Enter a name up to 80 characters.' using errcode = '22023';
  end if;
  update public.daymark_profiles p set display_name = clean where p.id = me;
  perform private.audit('update_my_name', 'daymark_profiles', me::text,
    jsonb_build_object('display_name', old_name), jsonb_build_object('display_name', clean));
  return clean;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Announcement banners. Admins post to everyone; a supervisor posts to their own interns.
-- Saving a new banner ends the author's previous one, so each author has at most one live.
-- ---------------------------------------------------------------------------
create table public.daymark_banners (
  id uuid primary key default gen_random_uuid(),
  message text not null check (char_length(btrim(message)) between 1 and 280),
  style text not null default 'sticky' check (style in ('sticky', 'scrolling')),
  audience text not null check (audience in ('everyone', 'supervisor_interns')),
  created_by uuid not null references public.daymark_profiles (id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daymark_banners_ends_after_start check (ends_at is null or ends_at > starts_at)
);

create index daymark_banners_live_idx on public.daymark_banners (created_by) where active;

alter table public.daymark_banners enable row level security;
create policy "Authors and admins read banners" on public.daymark_banners
  for select to authenticated
  using (created_by = (select auth.uid()) or (select private.is_admin()));
revoke all on table public.daymark_banners from public, anon, authenticated;
grant select on table public.daymark_banners to authenticated;
grant all on table public.daymark_banners to service_role;

-- The banners the signed-in person should see now.
create or replace function private.current_banners()
returns setof public.daymark_banners
language sql
stable
security definer
set search_path = ''
as $$
  select b.* from public.daymark_banners b
  where (select auth.uid()) is not null
    and b.active and b.starts_at <= private.clock_now()
    and (b.ends_at is null or b.ends_at > private.clock_now())
    and (b.audience = 'everyone'
         or b.created_by = (select auth.uid())
         or (b.audience = 'supervisor_interns' and private.is_my_supervisor(b.created_by)))
  order by b.created_at desc;
$$;

create or replace function private.save_banner(
  id uuid,
  message text,
  style text,
  starts_at timestamptz,
  ends_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  admin boolean := private.is_admin();
  clean text := btrim(coalesce(save_banner.message, ''));
  v_start timestamptz := coalesce(save_banner.starts_at, private.clock_now());
  b public.daymark_banners%rowtype;
  new_id uuid;
begin
  if not (admin or exists (select 1 from public.daymark_profiles p where p.id = me and p.is_supervisor and p.active)) then
    raise exception 'Only a supervisor or an admin can post a banner.' using errcode = '42501';
  end if;
  if char_length(clean) not between 1 and 280 then
    raise exception 'Write a message up to 280 characters.' using errcode = '22023';
  end if;
  if save_banner.style not in ('sticky', 'scrolling') then
    raise exception 'Pick sticky or scrolling.' using errcode = '22023';
  end if;
  if save_banner.ends_at is not null and save_banner.ends_at <= v_start then
    raise exception 'The end has to be after the start.' using errcode = '22023';
  end if;

  if save_banner.id is null then
    update public.daymark_banners x set active = false, updated_at = private.clock_now()
    where x.created_by = me and x.active;
    insert into public.daymark_banners (message, style, audience, created_by, starts_at, ends_at, created_at, updated_at)
    values (clean, save_banner.style, case when admin then 'everyone' else 'supervisor_interns' end, me,
            v_start, save_banner.ends_at, private.clock_now(), private.clock_now())
    returning daymark_banners.id into new_id;
    perform private.audit('save_banner', 'daymark_banners', new_id::text, null,
      jsonb_build_object('message', clean, 'style', save_banner.style, 'ends_at', save_banner.ends_at));
    return new_id;
  end if;

  select * into b from public.daymark_banners x where x.id = save_banner.id for update;
  if not found then
    raise exception 'That banner is gone.' using errcode = 'P0002';
  end if;
  if b.created_by <> me and not admin then
    raise exception 'Only its author or an admin can change that banner.' using errcode = '42501';
  end if;
  update public.daymark_banners x
  set message = clean, style = save_banner.style, starts_at = v_start, ends_at = save_banner.ends_at,
      active = true, updated_at = private.clock_now()
  where x.id = b.id;
  perform private.audit('save_banner', 'daymark_banners', b.id::text,
    jsonb_build_object('message', b.message, 'style', b.style, 'ends_at', b.ends_at),
    jsonb_build_object('message', clean, 'style', save_banner.style, 'ends_at', save_banner.ends_at));
  return b.id;
end;
$$;

create or replace function private.end_banner(id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.daymark_banners%rowtype;
begin
  select * into b from public.daymark_banners x where x.id = end_banner.id for update;
  if not found then
    raise exception 'That banner is gone.' using errcode = 'P0002';
  end if;
  if b.created_by <> (select auth.uid()) and not private.is_admin() then
    raise exception 'Only its author or an admin can end that banner.' using errcode = '42501';
  end if;
  update public.daymark_banners x set active = false, updated_at = private.clock_now() where x.id = b.id;
  perform private.audit('end_banner', 'daymark_banners', b.id::text, null, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Deleting a person erases everything about them (Dilip, 29 Sep): their login, profile and
-- every row that hangs off it, their consent records, and the audit rows about them. Audit rows
-- where they acted on other people's records stay, with the actor shown as "Deleted user".
-- One nameless entry records that a deletion happened: no id, no hash, counts only.
-- Used by the admin's delete and by the 30-day retention purge.
-- ---------------------------------------------------------------------------

-- The audit log stays append-only, except that an erase may delete rows or clear the actor.
create or replace function private.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('daymark.purging', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    if (to_jsonb(new) - 'actor_id' - 'actor_name') = (to_jsonb(old) - 'actor_id' - 'actor_name') then
      return new;
    end if;
  end if;
  raise exception 'The audit log cannot be changed.' using errcode = 'P0001';
end;
$$;

create or replace function private.erase_person(person uuid, reason text, extra jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ids text[];
  files jsonb := private.person_files(person);
  counts jsonb := '{}';
  n integer;
begin
  if not exists (select 1 from public.daymark_profiles x where x.id = person) then
    raise exception 'That person is already gone.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.daymark_placements x where x.supervisor_id = person) then
    raise exception 'This person supervises a placement. Give it another supervisor first.' using errcode = '22023';
  end if;

  -- Every id that audit rows about this person can point at.
  select array_agg(distinct i) into ids from (
    select person::text as i
    union all select p.id::text from public.daymark_placements p where p.intern_id = person
    union all select r.id::text from public.daymark_requests r where r.intern_id = person
    union all select x.id::text from public.daymark_punches x where x.user_id = person
    union all select d.id::text from public.daymark_scheduled_days d
              join public.daymark_placements p on p.id = d.placement_id where p.intern_id = person
    union all select w.id::text from public.daymark_work_logs w
              join public.daymark_placements p on p.id = w.placement_id where p.intern_id = person
    union all select c.id::text from public.daymark_checkins c
              join public.daymark_placements p on p.id = c.placement_id where p.intern_id = person
    union all select f.id::text from public.daymark_exit_feedback f
              join public.daymark_placements p on p.id = f.placement_id where p.intern_id = person
    union all select nt.id::text from public.daymark_notifications nt where nt.person_id = person
    union all select b.id::text from public.daymark_banners b where b.created_by = person
  ) all_ids;

  counts := jsonb_build_object(
    'placements', (select count(*) from public.daymark_placements p where p.intern_id = person),
    'punches', (select count(*) from public.daymark_punches x where x.user_id = person),
    'requests', (select count(*) from public.daymark_requests r where r.intern_id = person),
    'files', jsonb_array_length(files));

  perform set_config('daymark.purging', 'on', true);
  delete from public.daymark_consent_records c where c.person_id = person;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('consent_records', n);
  delete from public.daymark_audit_log a where a.row_id = any (ids);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('audit_rows_deleted', n);
  update public.daymark_audit_log a set actor_id = null, actor_name = 'Deleted user' where a.actor_id = person;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('audit_rows_anonymised', n);
  delete from auth.users u where u.id = person;                  -- cascades to the profile and its rows
  delete from public.daymark_profiles x where x.id = person;     -- a profile with no login
  perform set_config('daymark.purging', 'off', true);

  -- The nameless note: whoever deleted (null for the nightly purge), never the person themselves.
  insert into public.daymark_audit_log (actor_id, actor_name, action, table_name, row_id, before, after, at)
  select a.id, a.display_name, reason, 'daymark_profiles', null, null,
         counts || coalesce(extra, '{}') || jsonb_build_object('on', private.darwin_today()), private.clock_now()
  from (select null::uuid as id, null::text as display_name) blank
  left join public.daymark_profiles a on a.id = nullif((select auth.uid()), person);
  return jsonb_build_object('files', files, 'counts', counts);
end;
$$;

create or replace function private.delete_person(person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if person = (select auth.uid()) then
    raise exception 'You can''t delete yourself. Ask another admin.' using errcode = '22023';
  end if;
  return private.erase_person(person, 'delete_person', '{}');
end;
$$;

create or replace function private.purge_intern(intern uuid, objects_deleted integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from private.due_for_deletion() d where d.intern_id = intern) then
    raise exception 'This intern is not due for deletion.' using errcode = '22023';
  end if;
  return (private.erase_person(intern, 'retention_purge',
    jsonb_build_object('storage_objects', coalesce(objects_deleted, 0)))) -> 'counts';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6b. Collection notice v1.1: always-on clocking, the profile photo, and the full delete.
-- Publishing makes it current, so every intern acknowledges it before their next clock-in.
-- ---------------------------------------------------------------------------
do $$
declare
  current_version text := (select s.notice_version from public.daymark_settings s where s.id = 1);
  n public.daymark_notices%rowtype;
  body text;
  new_version text := '1.1';
begin
  select * into n from public.daymark_notices x where x.version = current_version;
  body := n.body;
  body := replace(body,
    'We never track you in the background, outside the office, or outside Mon–Fri 7:00 am–7:00 pm.',
    'We never track you in the background or between clock-ins. You can clock in and out at any time, on any day.');
  body := replace(body,
    'We do not use facial recognition or any automated face matching.',
    'We do not use facial recognition or any automated face matching. Your most recent clock-in photo is also your profile picture in the app, seen only by you, your supervisor and the DGK admin.');
  body := replace(body,
    'refuses a clock-in that is outside the office area or outside hours.',
    'refuses a clock-in that is outside the office area.');
  body := replace(body,
    'How long we keep it' || chr(10) || chr(10),
    'How long we keep it' || chr(10) || chr(10)
      || 'If the DGK admin deletes your account, everything about you (your details, hours, photos, certificates, consent records and the audit history about you) is permanently deleted straight away. Nothing that identifies you is kept.'
      || chr(10) || chr(10));
  if body not like '%If the DGK admin deletes your account%' then
    raise exception 'The collection notice wording changed; add the account-deletion paragraph by hand.';
  end if;

  if exists (select 1 from public.daymark_notices x where x.version = new_version) then
    new_version := '1.1-' || to_char(private.darwin_today(), 'YYYYMMDD');
  end if;
  insert into public.daymark_notices (version, title, body, published_at)
  values (new_version, n.title, body, private.clock_now());
  update public.daymark_settings s set notice_version = new_version, updated_at = private.clock_now() where s.id = 1;
  perform private.notify(p.id, 'notice', 'We''ve updated how DGK Clock handles your information',
    'Please read it before your next clock-in.', '/clock')
  from public.daymark_profiles p
  where p.is_intern and p.active;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Roster changes by admin or the intern's supervisor: a pattern for a date range (the
-- usual days come back after it), and single days (add, move, re-time, remove).
-- ---------------------------------------------------------------------------
create or replace function private.set_pattern(placement uuid, effective_from date, days jsonb, allow_extra boolean)
returns date[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype := private.require_placement_manager(placement);
  ver uuid;
  extra date[];
begin
  if effective_from < private.darwin_today() or effective_from < pl.start_date or effective_from > pl.planned_end_date then
    raise exception 'A new pattern starts today or later, inside the placement.' using errcode = '22023';
  end if;

  delete from public.daymark_pattern_versions v where v.placement_id = placement and v.effective_from = set_pattern.effective_from;
  insert into public.daymark_pattern_versions (placement_id, effective_from, created_by)
  values (placement, set_pattern.effective_from, (select auth.uid())) returning id into ver;
  insert into public.daymark_pattern_days (pattern_version_id, weekday, start_time, end_time)
  select ver, x.weekday, x.start_time, x.end_time from private.parse_pattern(days) x;

  extra := private.regenerate(placement, set_pattern.effective_from, allow_extra);
  perform private.audit('set_pattern', 'daymark_placements', placement::text, null,
    jsonb_build_object('effective_from', effective_from, 'pattern', days));
  perform private.notify(pl.intern_id, 'schedule', 'Your usual days changed',
    'Your schedule from ' || private.fmt_day(effective_from) || ' has been updated.', '/clock/schedule');
  return extra;
end;
$$;

-- The pattern in force on a date, in the shape parse_pattern reads. Null when there is none.
create or replace function private.pattern_on(placement uuid, on_date date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_agg(jsonb_build_object('weekday', d.weekday, 'start', to_char(d.start_time, 'HH24:MI'),
                                      'end', to_char(d.end_time, 'HH24:MI')) order by d.weekday)
  from public.daymark_pattern_days d
  where d.pattern_version_id = (
    select v.id from public.daymark_pattern_versions v
    where v.placement_id = placement and v.effective_from <= on_date
    order by v.effective_from desc limit 1);
$$;

create or replace function private.set_pattern_range(
  placement uuid,
  from_date date,
  to_date date,
  days jsonb,
  allow_extra boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype := private.require_placement_manager(placement);
  range_end date := case when set_pattern_range.to_date >= pl.planned_end_date then null else set_pattern_range.to_date end;
  after_range jsonb;
  extra date[] := '{}';
begin
  if range_end is not null and range_end < from_date then
    raise exception 'The end date has to be on or after the start date.' using errcode = '22023';
  end if;
  if range_end is not null then
    after_range := private.pattern_on(placement, range_end + 1);
  end if;

  delete from public.daymark_pattern_versions v
  where v.placement_id = placement and v.effective_from > from_date
    and (range_end is null or v.effective_from <= range_end);
  extra := extra || private.set_pattern(placement, from_date, days, allow_extra);
  if after_range is not null then
    extra := extra || private.set_pattern(placement, range_end + 1, after_range, allow_extra);
  end if;
  return jsonb_build_object('from', from_date, 'until', range_end, 'extra_spots', to_jsonb(extra));
end;
$$;

-- A day the admin or supervisor can change: scheduled, today or later, in their placement.
create or replace function private.managed_day(day uuid)
returns public.daymark_scheduled_days
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.daymark_scheduled_days%rowtype;
begin
  select * into d from public.daymark_scheduled_days x where x.id = day for update;
  if not found then
    raise exception 'That roster day is gone.' using errcode = 'P0002';
  end if;
  perform private.require_placement_manager(d.placement_id);
  if d.status <> 'scheduled' then
    raise exception 'Only a scheduled day can be changed.' using errcode = '22023';
  end if;
  if d.work_date < private.darwin_today() then
    raise exception 'Past days can''t be changed. Use a punch fix for hours.' using errcode = '22023';
  end if;
  return d;
end;
$$;

-- Checks a new date and times for a placement; raises the reason when they don't fit.
create or replace function private.check_staff_day(pl public.daymark_placements, work_date date, start_time time, end_time time)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if work_date < private.darwin_today() then
    raise exception 'Pick today or a later date.' using errcode = '22023';
  end if;
  if work_date < pl.start_date or work_date > pl.planned_end_date then
    raise exception 'Pick a date inside the placement (% to %).', private.fmt_day(pl.start_date),
      private.fmt_day(pl.planned_end_date) using errcode = '22023';
  end if;
  if not private.valid_day_times(start_time, end_time) then
    raise exception 'Days are between 7:00 am and 7:00 pm, in 15-minute steps and at most 10 hours.' using errcode = '22023';
  end if;
  if exists (select 1 from public.daymark_scheduled_days x
             where x.placement_id = pl.id and x.work_date = check_staff_day.work_date and x.status in ('scheduled', 'leave')) then
    raise exception 'They''re already rostered on %.', private.fmt_day(work_date) using errcode = '22023';
  end if;
end;
$$;

create or replace function private.staff_add_day(placement uuid, work_date date, start_time time, end_time time, allow_extra boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype := private.require_placement_manager(placement);
  new_id uuid;
begin
  perform private.check_staff_day(pl, work_date, start_time, end_time);
  new_id := private.add_scheduled_day(placement, work_date, start_time, end_time, 'admin', null, allow_extra);
  insert into public.daymark_schedule_history (scheduled_day_id, before, after, changed_by, changed_at)
  values (new_id, null, jsonb_build_object('status', 'scheduled', 'start_time', start_time, 'end_time', end_time, 'source', 'admin'),
          (select auth.uid()), private.clock_now());
  perform private.audit('staff_add_day', 'daymark_scheduled_days', new_id::text, null,
    jsonb_build_object('work_date', work_date, 'start_time', start_time, 'end_time', end_time));
  perform private.notify(pl.intern_id, 'schedule', 'A day was added to your roster',
    private.fmt_day(work_date) || ', ' || private.fmt_clock(start_time) || '–' || private.fmt_clock(end_time) || '.',
    '/clock/schedule');
  return new_id;
end;
$$;

create or replace function private.staff_move_day(day uuid, new_date date, start_time time, end_time time, allow_extra boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.daymark_scheduled_days%rowtype := private.managed_day(day);
  pl public.daymark_placements%rowtype;
  new_id uuid;
begin
  select * into pl from public.daymark_placements p where p.id = d.placement_id;
  if new_date = d.work_date then
    if not private.valid_day_times(start_time, end_time) then
      raise exception 'Days are between 7:00 am and 7:00 pm, in 15-minute steps and at most 10 hours.' using errcode = '22023';
    end if;
    update public.daymark_scheduled_days x
    set start_time = staff_move_day.start_time, end_time = staff_move_day.end_time, source = 'admin',
        updated_at = private.clock_now()
    where x.id = d.id;
    insert into public.daymark_schedule_history (scheduled_day_id, before, after, changed_by, changed_at)
    values (d.id, jsonb_build_object('start_time', d.start_time, 'end_time', d.end_time, 'source', d.source),
            jsonb_build_object('start_time', start_time, 'end_time', end_time, 'source', 'admin'),
            (select auth.uid()), private.clock_now());
    new_id := d.id;
  else
    perform private.check_staff_day(pl, new_date, start_time, end_time);
    update public.daymark_scheduled_days x set status = 'moved', updated_at = private.clock_now() where x.id = d.id;
    new_id := private.add_scheduled_day(d.placement_id, new_date, start_time, end_time, 'admin', null, allow_extra);
    insert into public.daymark_schedule_history (scheduled_day_id, before, after, changed_by, changed_at)
    values (d.id, jsonb_build_object('status', d.status),
            jsonb_build_object('status', 'moved', 'moved_to', new_date, 'new_day_id', new_id), (select auth.uid()), private.clock_now());
  end if;
  perform private.audit('staff_move_day', 'daymark_scheduled_days', d.id::text,
    jsonb_build_object('work_date', d.work_date, 'start_time', d.start_time, 'end_time', d.end_time),
    jsonb_build_object('work_date', new_date, 'start_time', start_time, 'end_time', end_time));
  perform private.notify(pl.intern_id, 'schedule', 'Your roster changed',
    private.fmt_day(d.work_date) || ' is now ' || private.fmt_day(new_date) || ', '
      || private.fmt_clock(start_time) || '–' || private.fmt_clock(end_time) || '.',
    '/clock/schedule');
  return new_id;
end;
$$;

create or replace function private.staff_cancel_day(day uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.daymark_scheduled_days%rowtype := private.managed_day(day);
  intern uuid := (select p.intern_id from public.daymark_placements p where p.id = d.placement_id);
begin
  update public.daymark_scheduled_days x set status = 'cancelled', updated_at = private.clock_now() where x.id = d.id;
  insert into public.daymark_schedule_history (scheduled_day_id, before, after, changed_by, changed_at)
  values (d.id, jsonb_build_object('status', d.status), jsonb_build_object('status', 'cancelled'),
          (select auth.uid()), private.clock_now());
  perform private.audit('staff_cancel_day', 'daymark_scheduled_days', d.id::text,
    jsonb_build_object('work_date', d.work_date, 'start_time', d.start_time, 'end_time', d.end_time), null);
  perform private.notify(intern, 'schedule', 'A day was removed from your roster',
    private.fmt_day(d.work_date) || ' is no longer on your roster.', '/clock/schedule');
end;
$$;

-- ---------------------------------------------------------------------------
-- Thin public wrappers and grants.
-- ---------------------------------------------------------------------------
create or replace function public.update_my_name(display_name text)
returns text language sql security invoker set search_path = ''
as $$ select private.update_my_name(display_name); $$;

create or replace function public.current_banners()
returns setof public.daymark_banners language sql stable security invoker set search_path = ''
as $$ select * from private.current_banners(); $$;

create or replace function public.save_banner(
  id uuid, message text, style text default 'sticky', starts_at timestamptz default null, ends_at timestamptz default null)
returns uuid language sql security invoker set search_path = ''
as $$ select private.save_banner(id, message, style, starts_at, ends_at); $$;

create or replace function public.end_banner(id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.end_banner(id); $$;

create or replace function public.set_pattern_range(
  placement uuid, from_date date, to_date date, days jsonb, allow_extra boolean default false)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.set_pattern_range(placement, from_date, to_date, days, allow_extra); $$;

create or replace function public.staff_add_day(
  placement uuid, work_date date, start_time time, end_time time, allow_extra boolean default false)
returns uuid language sql security invoker set search_path = ''
as $$ select private.staff_add_day(placement, work_date, start_time, end_time, allow_extra); $$;

create or replace function public.staff_move_day(
  day uuid, new_date date, start_time time, end_time time, allow_extra boolean default false)
returns uuid language sql security invoker set search_path = ''
as $$ select private.staff_move_day(day, new_date, start_time, end_time, allow_extra); $$;

create or replace function public.staff_cancel_day(day uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.staff_cancel_day(day); $$;

revoke all on function private.update_my_name(text) from public, anon;
revoke all on function private.current_banners() from public, anon;
revoke all on function private.save_banner(uuid, text, text, timestamptz, timestamptz) from public, anon;
revoke all on function private.end_banner(uuid) from public, anon;
revoke all on function private.erase_person(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.pattern_on(uuid, date) from public, anon, authenticated;
revoke all on function private.set_pattern_range(uuid, date, date, jsonb, boolean) from public, anon;
revoke all on function private.managed_day(uuid) from public, anon, authenticated;
revoke all on function private.check_staff_day(public.daymark_placements, date, time, time) from public, anon, authenticated;
revoke all on function private.staff_add_day(uuid, date, time, time, boolean) from public, anon;
revoke all on function private.staff_move_day(uuid, date, time, time, boolean) from public, anon;
revoke all on function private.staff_cancel_day(uuid) from public, anon;
revoke all on function public.update_my_name(text) from public, anon;
revoke all on function public.current_banners() from public, anon;
revoke all on function public.save_banner(uuid, text, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.end_banner(uuid) from public, anon;
revoke all on function public.set_pattern_range(uuid, date, date, jsonb, boolean) from public, anon;
revoke all on function public.staff_add_day(uuid, date, time, time, boolean) from public, anon;
revoke all on function public.staff_move_day(uuid, date, time, time, boolean) from public, anon;
revoke all on function public.staff_cancel_day(uuid) from public, anon;

grant execute on function private.update_my_name(text) to authenticated;
grant execute on function private.current_banners() to authenticated;
grant execute on function private.save_banner(uuid, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function private.end_banner(uuid) to authenticated;
grant execute on function private.set_pattern_range(uuid, date, date, jsonb, boolean) to authenticated;
grant execute on function private.staff_add_day(uuid, date, time, time, boolean) to authenticated;
grant execute on function private.staff_move_day(uuid, date, time, time, boolean) to authenticated;
grant execute on function private.staff_cancel_day(uuid) to authenticated;
grant execute on function public.update_my_name(text) to authenticated;
grant execute on function public.current_banners() to authenticated;
grant execute on function public.save_banner(uuid, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.end_banner(uuid) to authenticated;
grant execute on function public.set_pattern_range(uuid, date, date, jsonb, boolean) to authenticated;
grant execute on function public.staff_add_day(uuid, date, time, time, boolean) to authenticated;
grant execute on function public.staff_move_day(uuid, date, time, time, boolean) to authenticated;
grant execute on function public.staff_cancel_day(uuid) to authenticated;
grant execute on function private.purge_intern(uuid, integer) to service_role;

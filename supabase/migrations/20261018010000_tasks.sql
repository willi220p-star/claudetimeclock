-- Built-in tasks (Dilip, 12 Oct; D44). Contract: docs/superpowers/specs/2026-10-12-tasks-contract.md.
-- A task is a definition; each assignee gets their own copy (an item) and ticks it themselves.
-- Supervisors assign to their own interns, admins to any active intern, and an intern adds tasks for
-- themselves, tagging teammates as "working with". Nothing here deletes a row: a removed task is
-- archived, a removed assignee or teammate is marked removed (their open copies drop out of the lists,
-- their done ones stay), and the rows go with the intern's other data by cascade.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.daymark_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 140),
  description text check (char_length(description) <= 2000),
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  due_date date,
  due_time time,
  link text check (link ~ '^https://' and char_length(link) <= 500),
  repeat_days int[] check (cardinality(repeat_days) > 0 and repeat_days <@ array[1, 2, 3, 4, 5, 6, 7]),
  repeat_until date,
  created_by uuid references public.daymark_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint daymark_tasks_repeat_check check (repeat_days is null or repeat_until is not null)
);
create index daymark_tasks_created_by_idx on public.daymark_tasks (created_by);

-- removed_at: a removed assignee or teammate (null while current). Rows are never deleted.
create table public.daymark_task_assignees (
  task_id uuid not null references public.daymark_tasks (id) on delete cascade,
  person_id uuid not null references public.daymark_profiles (id) on delete cascade,
  removed_at timestamptz,
  primary key (task_id, person_id)
);
create index daymark_task_assignees_person_idx on public.daymark_task_assignees (person_id);

create table public.daymark_task_collaborators (
  task_id uuid not null references public.daymark_tasks (id) on delete cascade,
  person_id uuid not null references public.daymark_profiles (id) on delete cascade,
  removed_at timestamptz,
  primary key (task_id, person_id)
);
create index daymark_task_collaborators_person_idx on public.daymark_task_collaborators (person_id);

create table public.daymark_task_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.daymark_tasks (id) on delete cascade,
  person_id uuid not null references public.daymark_profiles (id) on delete cascade,
  due_date date,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  done_at timestamptz,
  done_note text check (char_length(done_note) <= 500),
  created_at timestamptz not null default now()
);
create unique index daymark_task_items_copy_idx
  on public.daymark_task_items (task_id, person_id, coalesce(due_date, '1900-01-01'::date));
create index daymark_task_items_person_idx on public.daymark_task_items (person_id, due_date);

alter table public.daymark_tasks enable row level security;
alter table public.daymark_task_assignees enable row level security;
alter table public.daymark_task_collaborators enable row level security;
alter table public.daymark_task_items enable row level security;
revoke all on table public.daymark_tasks from public, anon, authenticated;
revoke all on table public.daymark_task_assignees from public, anon, authenticated;
revoke all on table public.daymark_task_collaborators from public, anon, authenticated;
revoke all on table public.daymark_task_items from public, anon, authenticated;
grant all on table public.daymark_tasks to service_role;
grant all on table public.daymark_task_assignees to service_role;
grant all on table public.daymark_task_collaborators to service_role;
grant all on table public.daymark_task_items to service_role;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- The caller may manage this person's tasks: an admin, or the active supervisor of their live placement.
create or replace function private.manages_tasks_of(person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin() or exists (
    select 1 from public.daymark_placements pl
    join public.daymark_profiles s on s.id = pl.supervisor_id and s.is_supervisor and s.active
    where pl.intern_id = person and pl.supervisor_id = (select auth.uid())
      and pl.status in ('active', 'extended', 'target_reached'));
$$;

-- A copy counts while it is done (history) or its person is still a current assignee.
create or replace function private.task_item_live(i public.daymark_task_items)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select i.status = 'done' or exists (select 1 from public.daymark_task_assignees a
                                      where a.task_id = i.task_id and a.person_id = i.person_id and a.removed_at is null);
$$;

-- Creates missing copies: one per assignee for a one-off task, today's for a repeating one.
create or replace function private.task_copies(only_task uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  with ins as (
    insert into public.daymark_task_items (task_id, person_id, due_date, created_at)
    select t.id, a.person_id, case when t.repeat_days is null then t.due_date else private.darwin_today() end,
           private.clock_now()
    from public.daymark_tasks t
    join public.daymark_task_assignees a on a.task_id = t.id and a.removed_at is null
    join public.daymark_profiles p on p.id = a.person_id and p.active
    where t.archived_at is null and (only_task is null or t.id = only_task)
      and ((t.repeat_days is null
            and not exists (select 1 from public.daymark_task_items i where i.task_id = t.id and i.person_id = a.person_id))
        or (extract(isodow from private.darwin_today())::int = any (t.repeat_days)
            and private.darwin_today() <= t.repeat_until))
    on conflict do nothing
    returning 1
  )
  select count(*)::int from ins;
$$;

-- Creator, admin, or a supervisor of every current assignee.
create or replace function private.require_task_manager(id uuid)
returns public.daymark_tasks
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.daymark_tasks%rowtype;
begin
  select * into t from public.daymark_tasks x where x.id = require_task_manager.id and x.archived_at is null;
  if not found then
    raise exception 'That task is gone.' using errcode = 'P0002';
  end if;
  if not (coalesce(t.created_by = (select auth.uid()), false) or private.is_admin()
          or (exists (select 1 from public.daymark_task_assignees a where a.task_id = t.id and a.removed_at is null)
              and not exists (select 1 from public.daymark_task_assignees a
                              where a.task_id = t.id and a.removed_at is null
                                and not private.manages_tasks_of(a.person_id)))) then
    raise exception 'Only the task''s creator, an admin or the interns'' supervisor can change it.' using errcode = '42501';
  end if;
  return t;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Writes
-- ---------------------------------------------------------------------------
create or replace function private.save_task(id uuid, title text, description text, priority text, due_date date,
  due_time time, link text, assignees uuid[], repeat_days int[], repeat_until date, collaborators uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  admin boolean := private.is_admin();
  staff boolean;
  intern boolean;
  old public.daymark_tasks%rowtype;
  t public.daymark_tasks%rowtype;
  people uuid[] := array(select distinct x from unnest(coalesce(save_task.assignees, '{}')) x where x is not null);
  mates uuid[] := array(select distinct x from unnest(coalesce(save_task.collaborators, '{}')) x
                        where x is not null and x <> me);
  days int[] := array(select distinct d from unnest(save_task.repeat_days) d order by 1);
  fresh uuid[];
  who uuid;
begin
  select admin or (p.is_supervisor and p.active), p.is_intern and p.active into staff, intern
  from public.daymark_profiles p where p.id = me;

  -- Fields.
  if char_length(btrim(coalesce(save_task.title, ''))) not between 1 and 140 then
    raise exception 'Write a task name up to 140 characters.' using errcode = '22023';
  end if;
  if char_length(save_task.description) > 2000 then
    raise exception 'Keep the description to 2,000 characters.' using errcode = '22023';
  end if;
  if coalesce(save_task.priority, 'medium') not in ('high', 'medium', 'low') then
    raise exception 'Pick a priority: high, medium or low.' using errcode = '22023';
  end if;
  if nullif(btrim(save_task.link), '') is not null
     and (btrim(save_task.link) !~ '^https://.+' or char_length(btrim(save_task.link)) > 500) then
    raise exception 'The link must start with https:// (up to 500 characters).' using errcode = '22023';
  end if;
  if save_task.repeat_days is not null then
    if cardinality(days) = 0 or exists (select 1 from unnest(days) d where d is null or d not between 1 and 7) then
      raise exception 'Pick the weekdays it repeats on.' using errcode = '22023';
    end if;
    if save_task.repeat_until is null or save_task.repeat_until < private.darwin_today() then
      raise exception 'Pick an end date for the repeat, today or later.' using errcode = '22023';
    end if;
  end if;

  -- Who may assign to whom.
  if staff then
    if cardinality(people) = 0 then
      raise exception 'Pick at least one intern.' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(people) x
               where not exists (select 1 from public.daymark_profiles p where p.id = x and p.is_intern and p.active)
                  or not (admin or private.manages_tasks_of(x))) then
      raise exception 'You can only assign tasks to your own active interns.' using errcode = '42501';
    end if;
  elsif intern then
    if cardinality(people) = 0 then  -- no assignees from an intern means themselves
      people := array[me];
    end if;
    if people is distinct from array[me] then
      raise exception 'You can only add tasks for yourself.' using errcode = '42501';
    end if;
    if exists (select 1 from unnest(mates) x
               where not exists (select 1 from public.daymark_profiles p where p.id = x and p.is_intern and p.active)) then
      raise exception 'Pick teammates from the list of active interns.' using errcode = '22023';
    end if;
  else
    raise exception 'Only an intern, a supervisor or an admin can add tasks.' using errcode = '42501';
  end if;

  if save_task.id is null then
    insert into public.daymark_tasks (title, description, priority, due_date, due_time, link, repeat_days, repeat_until,
                                      created_by, created_at)
    values (btrim(save_task.title), nullif(btrim(save_task.description), ''), coalesce(save_task.priority, 'medium'),
            case when save_task.repeat_days is null then save_task.due_date end, save_task.due_time,
            nullif(btrim(save_task.link), ''), case when save_task.repeat_days is not null then days end,
            case when save_task.repeat_days is not null then save_task.repeat_until end, me, private.clock_now())
    returning * into t;
  else
    old := private.require_task_manager(save_task.id);
    -- ponytail: switching a task between one-off and repeating would leave copies with mixed dates;
    -- refused for now, archive and recreate instead. Upgrade: reconcile the open copies on switch.
    if (old.repeat_days is null) <> (save_task.repeat_days is null) then
      raise exception 'A task can''t switch between one-off and repeating. Archive it and add a new one.'
        using errcode = '22023';
    end if;
    update public.daymark_tasks x
    set title = btrim(save_task.title), description = nullif(btrim(save_task.description), ''),
        priority = coalesce(save_task.priority, 'medium'),
        due_date = case when save_task.repeat_days is null then save_task.due_date end,
        due_time = save_task.due_time, link = nullif(btrim(save_task.link), ''),
        repeat_days = case when save_task.repeat_days is not null then days end,
        repeat_until = case when save_task.repeat_days is not null then save_task.repeat_until end
    where x.id = old.id
    returning * into t;
    if t.repeat_days is null then
      update public.daymark_task_items i set due_date = t.due_date
      where i.task_id = t.id and i.status <> 'done' and i.due_date is distinct from t.due_date;
    end if;
  end if;

  -- Assignees: new ones (or ones coming back) get a copy and a notification; removed ones are marked.
  fresh := array(select x from unnest(people) x
                 where not exists (select 1 from public.daymark_task_assignees a
                                   where a.task_id = t.id and a.person_id = x and a.removed_at is null));
  update public.daymark_task_assignees a set removed_at = private.clock_now()
  where a.task_id = t.id and a.removed_at is null and not (a.person_id = any (people));
  insert into public.daymark_task_assignees (task_id, person_id)
  select t.id, x from unnest(fresh) x
  on conflict (task_id, person_id) do update set removed_at = null;

  -- Teammates: an intern's own task only; staff leave them as they are.
  if not staff then
    update public.daymark_task_collaborators c set removed_at = private.clock_now()
    where c.task_id = t.id and c.removed_at is null and not (c.person_id = any (mates));
    insert into public.daymark_task_collaborators (task_id, person_id)
    select t.id, x from unnest(mates) x
    on conflict (task_id, person_id) do update set removed_at = null;
  end if;

  perform private.task_copies(t.id);
  foreach who in array fresh loop
    continue when who = me;
    perform private.notify(who, 'task', 'New task',
      t.title || coalesce(' · due ' || private.fmt_day(t.due_date), ''), '/clock');
  end loop;

  perform private.audit('save_task', 'daymark_tasks', t.id::text,
    case when old.id is not null then to_jsonb(old) end,
    to_jsonb(t) || jsonb_build_object('assignees', to_jsonb(people), 'collaborators', to_jsonb(mates)));
  return t.id;
end;
$$;

create or replace function private.set_task_status(item uuid, status text, note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.daymark_task_items%rowtype;
begin
  select x.* into i from public.daymark_task_items x
  join public.daymark_tasks t on t.id = x.task_id and t.archived_at is null
  where x.id = set_task_status.item;
  if not found then
    raise exception 'That task is gone.' using errcode = 'P0002';
  end if;
  if i.person_id is distinct from (select auth.uid()) and not private.manages_tasks_of(i.person_id) then
    raise exception 'Only the person it''s for can tick this task.' using errcode = '42501';
  end if;
  if set_task_status.status is null or set_task_status.status not in ('todo', 'in_progress', 'done') then
    raise exception 'Pick a status: to do, in progress or done.' using errcode = '22023';
  end if;
  if char_length(set_task_status.note) > 500 then
    raise exception 'Keep the note to 500 characters.' using errcode = '22023';
  end if;
  update public.daymark_task_items x
  set status = set_task_status.status,
      done_at = case when set_task_status.status = 'done' then private.clock_now() end,
      done_note = case when set_task_status.status = 'done' then nullif(btrim(set_task_status.note), '') else x.done_note end
  where x.id = i.id;
end;
$$;

create or replace function private.archive_task(id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.daymark_tasks%rowtype := private.require_task_manager(archive_task.id);
begin
  update public.daymark_tasks x set archived_at = private.clock_now() where x.id = t.id;
  perform private.audit('archive_task', 'daymark_tasks', t.id::text, null, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Reads: archived tasks, done copies older than 30 days and removed assignees' open copies are left out.
-- ---------------------------------------------------------------------------
create or replace function private.my_tasks()
returns table (item_id uuid, task_id uuid, title text, description text, priority text, due_date date, due_time time,
               link text, status text, done_at timestamptz, done_note text, created_by_name text, own boolean,
               working_with text[], repeat_days int[])
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, t.id, t.title, t.description, t.priority, i.due_date, t.due_time, t.link, i.status, i.done_at, i.done_note,
         coalesce(c.display_name, 'Someone'), i.person_id = (select auth.uid()),
         -- Own copy: the teammates. A teammate's view: the owner and the other teammates.
         array(select p.display_name from public.daymark_profiles p
               where p.id <> (select auth.uid())
                 and (p.id = i.person_id
                      or exists (select 1 from public.daymark_task_collaborators k
                                 where k.task_id = t.id and k.person_id = p.id and k.removed_at is null))
               order by p.display_name),
         t.repeat_days
  from public.daymark_task_items i
  join public.daymark_tasks t on t.id = i.task_id and t.archived_at is null
  left join public.daymark_profiles c on c.id = t.created_by
  where (i.person_id = (select auth.uid())
         or exists (select 1 from public.daymark_task_collaborators k
                    where k.task_id = t.id and k.person_id = (select auth.uid()) and k.removed_at is null))
    and not (i.status = 'done' and i.done_at <= private.clock_now() - interval '30 days')
    and private.task_item_live(i)
  order by i.status = 'done',
           case when i.status <> 'done' then i.due_date end nulls last,
           case when i.status <> 'done' then case t.priority when 'high' then 0 when 'medium' then 1 else 2 end end,
           i.done_at desc nulls last, t.title;
$$;

create or replace function private.staff_tasks(intern uuid default null)
returns table (item_id uuid, task_id uuid, person_id uuid, person_name text, title text, description text, priority text,
               due_date date, due_time time, link text, status text, done_at timestamptz, done_note text,
               created_by_name text, repeat_days int[], repeat_until date)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, t.id, i.person_id, p.display_name, t.title, t.description, t.priority, i.due_date, t.due_time, t.link,
         i.status, i.done_at, i.done_note, coalesce(c.display_name, 'Someone'), t.repeat_days, t.repeat_until
  from public.daymark_task_items i
  join public.daymark_tasks t on t.id = i.task_id and t.archived_at is null
  join public.daymark_profiles p on p.id = i.person_id
  left join public.daymark_profiles c on c.id = t.created_by
  where (staff_tasks.intern is null or i.person_id = staff_tasks.intern)
    and private.manages_tasks_of(i.person_id)
    and not (i.status = 'done' and i.done_at <= private.clock_now() - interval '30 days')
    and private.task_item_live(i)
  order by i.due_date nulls last, t.created_at, t.id, p.display_name;
$$;

create or replace function private.task_people()
returns table (person_id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name
  from public.daymark_profiles p
  join public.daymark_profiles me on me.id = (select auth.uid()) and me.active
  where p.is_intern and p.active and p.id <> me.id
    and (private.is_admin()
         or (me.is_supervisor and private.manages_tasks_of(p.id))
         or (not me.is_supervisor and me.is_intern))
  order by p.display_name;
$$;

-- ---------------------------------------------------------------------------
-- 5. Jobs: repeat copies and the due-day reminder, every 5 minutes with the other reminders
-- ---------------------------------------------------------------------------
alter table public.daymark_reminders_sent drop constraint daymark_reminders_sent_kind_check;
alter table public.daymark_reminders_sent add constraint daymark_reminders_sent_kind_check
  check (kind in ('not_clocked_in', 'long_break', 'forgot_clock_out', 'shift_soon', 'clock_out', 'shift_tomorrow', 'digest',
                  'signoff', 'task_due'));

create or replace function private.push_kind_options()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['reminder_shift', 'reminder_break', 'reminder_clock_out', 'reminder_tomorrow', 'digest', 'announcement',
               'signoff', 'task', 'schedule', 'times', 'request', 'attendance', 'work_based', 'escalated']::text[];
$$;
alter table public.daymark_settings
  alter column push_kinds set default array['reminder_shift', 'reminder_break', 'reminder_clock_out', 'reminder_tomorrow',
    'digest', 'announcement', 'signoff', 'task', 'schedule', 'times', 'request', 'attendance', 'work_based',
    'escalated']::text[];
update public.daymark_settings set push_kinds = array(select distinct k from unnest(push_kinds || array['task']) k order by 1)
where id = 1;

create or replace function private.job_tasks()
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
  perform private.task_copies(null);
  if not coalesce('task' = any (select unnest(s.push_kinds) from public.daymark_settings s where s.id = 1), false) then
    return 0;
  end if;
  for r in
    select i.person_id, count(*)::int as n, min(t.due_time) as first_time,
           (array_agg(t.title order by t.due_time nulls last,
                      case t.priority when 'high' then 0 when 'medium' then 1 else 2 end, t.title))[1] as first_title
    from public.daymark_task_items i
    join public.daymark_tasks t on t.id = i.task_id and t.archived_at is null
    join public.daymark_profiles p on p.id = i.person_id and p.active
    where i.due_date = today and i.status <> 'done' and private.task_item_live(i)
    group by i.person_id
  loop
    continue when now_ts < least(private.darwin_at(today, time '08:00'),
                                 coalesce(private.darwin_at(today, r.first_time) - interval '1 hour', 'infinity'));
    insert into public.daymark_reminders_sent (person_id, kind, work_date) values (r.person_id, 'task_due', today)
    on conflict do nothing;
    if found then
      perform private.notify(r.person_id, 'task', 'Tasks due today',
        r.n || case when r.n = 1 then ' task' else ' tasks' end || ' due today: ' || r.first_title
          || case when r.n > 1 then ', …' else '' end,
        '/clock');
      sent := sent + 1;
    end if;
  end loop;
  return sent;
end;
$$;

-- The 8 am summary, as in 20261013010000_evening_digest.sql, plus overdue open tasks.
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
    select p.id as person_id, p.is_admin,
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
            or (pl.supervisor_id = p.id and q.status = 'pending_supervisor')) as waiting,
      (select count(*)::int
         from public.daymark_task_items i
         join public.daymark_tasks t on t.id = i.task_id and t.archived_at is null
         where i.status <> 'done' and i.due_date < today and private.task_item_live(i)
           and (p.is_admin or exists (select 1 from public.daymark_placements pl
                                      where pl.intern_id = i.person_id and pl.supervisor_id = p.id
                                        and pl.status in ('active', 'extended', 'target_reached')))) as overdue
    from public.daymark_profiles p
    where p.active and (p.is_admin or p.is_supervisor)
  loop
    parts := '{}';
    if r.late > 0 then parts := parts || (r.late || ' not clocked in yet'); end if;
    if r.waiting > 0 then parts := parts || (r.waiting || ' waiting for your approval'); end if;
    if r.overdue > 0 then
      parts := parts || (r.overdue || case when r.overdue = 1 then ' task overdue' else ' tasks overdue' end);
    end if;
    continue when cardinality(parts) = 0;
    insert into public.daymark_reminders_sent (person_id, kind, work_date) values (r.person_id, 'digest', today)
    on conflict do nothing;
    if found then
      perform private.notify(r.person_id, 'digest', 'Your morning summary', array_to_string(parts, ' · ') || '.',
        case when r.late > 0 then '/supervisor'
             when r.waiting > 0 then '/supervisor/approvals'
             when r.is_admin then '/admin/tasks'
             else '/supervisor/tasks' end);
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
as $$
  select private.job_day_reminders() + private.job_evening_reminders() + private.job_digest()
         + private.job_signoff_reminders() + private.job_tasks();
$$;

-- ---------------------------------------------------------------------------
-- 6. Wrappers and grants
-- ---------------------------------------------------------------------------
create or replace function public.save_task(id uuid, title text, description text, priority text, due_date date,
  due_time time, link text, assignees uuid[], repeat_days int[], repeat_until date, collaborators uuid[])
returns uuid language sql security invoker set search_path = ''
as $$ select private.save_task(id, title, description, priority, due_date, due_time, link, assignees, repeat_days,
                               repeat_until, collaborators); $$;
create or replace function public.set_task_status(item uuid, status text, note text default null)
returns void language sql security invoker set search_path = ''
as $$ select private.set_task_status(item, status, note); $$;
create or replace function public.archive_task(id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.archive_task(id); $$;
create or replace function public.my_tasks()
returns table (item_id uuid, task_id uuid, title text, description text, priority text, due_date date, due_time time,
               link text, status text, done_at timestamptz, done_note text, created_by_name text, own boolean,
               working_with text[], repeat_days int[])
language sql stable security invoker set search_path = ''
as $$ select * from private.my_tasks(); $$;
create or replace function public.staff_tasks(intern uuid default null)
returns table (item_id uuid, task_id uuid, person_id uuid, person_name text, title text, description text, priority text,
               due_date date, due_time time, link text, status text, done_at timestamptz, done_note text,
               created_by_name text, repeat_days int[], repeat_until date)
language sql stable security invoker set search_path = ''
as $$ select * from private.staff_tasks(intern); $$;
create or replace function public.task_people()
returns table (person_id uuid, display_name text)
language sql stable security invoker set search_path = ''
as $$ select * from private.task_people(); $$;

revoke all on function private.manages_tasks_of(uuid) from public, anon;
revoke all on function private.task_item_live(public.daymark_task_items) from public, anon;
revoke all on function private.task_copies(uuid) from public, anon, authenticated;
revoke all on function private.require_task_manager(uuid) from public, anon;
revoke all on function private.save_task(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[]) from public, anon;
revoke all on function private.set_task_status(uuid, text, text) from public, anon;
revoke all on function private.archive_task(uuid) from public, anon;
revoke all on function private.my_tasks() from public, anon;
revoke all on function private.staff_tasks(uuid) from public, anon;
revoke all on function private.task_people() from public, anon;
revoke all on function private.job_tasks() from public, anon, authenticated;
revoke all on function private.job_digest() from public, anon, authenticated;
revoke all on function private.job_reminders() from public, anon, authenticated;
revoke all on function public.save_task(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[]) from public, anon;
revoke all on function public.set_task_status(uuid, text, text) from public, anon;
revoke all on function public.archive_task(uuid) from public, anon;
revoke all on function public.my_tasks() from public, anon;
revoke all on function public.staff_tasks(uuid) from public, anon;
revoke all on function public.task_people() from public, anon;
grant execute on function private.manages_tasks_of(uuid) to authenticated;
grant execute on function private.task_item_live(public.daymark_task_items) to authenticated;
grant execute on function private.require_task_manager(uuid) to authenticated;
grant execute on function private.save_task(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[]) to authenticated;
grant execute on function private.set_task_status(uuid, text, text) to authenticated;
grant execute on function private.archive_task(uuid) to authenticated;
grant execute on function private.my_tasks() to authenticated;
grant execute on function private.staff_tasks(uuid) to authenticated;
grant execute on function private.task_people() to authenticated;
grant execute on function public.save_task(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[]) to authenticated;
grant execute on function public.set_task_status(uuid, text, text) to authenticated;
grant execute on function public.archive_task(uuid) to authenticated;
grant execute on function public.my_tasks() to authenticated;
grant execute on function public.staff_tasks(uuid) to authenticated;
grant execute on function public.task_people() to authenticated;

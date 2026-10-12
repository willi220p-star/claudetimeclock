-- Tasks v2 (Dilip, 13 Oct; D48). Contract: docs/superpowers/specs/2026-10-13-tasks-v2-contract.md, on top of D44.
-- Adds an optional reviewer (only their Approve makes a copy done), subtasks per copy (copied from the task's
-- starting checklist), an estimate and time spent, a Blocked flag with a reason, and a comments thread.
-- Nothing here deletes a row: a removed subtask is archived, and subtasks and comments go with their copy by cascade.

-- ---------------------------------------------------------------------------
-- 1. Columns and tables
-- ---------------------------------------------------------------------------
alter table public.daymark_tasks
  add column reviewer_id uuid references public.daymark_profiles (id) on delete set null,
  add column estimate_minutes int check (estimate_minutes between 1 and 6000),
  -- Each title (1-140 characters) is checked by save_task; a check constraint can't look inside the array.
  add column subtask_titles text[] check (cardinality(subtask_titles) between 1 and 30);
create index daymark_tasks_reviewer_idx on public.daymark_tasks (reviewer_id);

alter table public.daymark_task_items drop constraint daymark_task_items_status_check;
alter table public.daymark_task_items
  add constraint daymark_task_items_status_check check (status in ('todo', 'in_progress', 'in_review', 'done')),
  add column spent_minutes int not null default 0 check (spent_minutes between 0 and 60000),
  add column blocked_reason text check (char_length(blocked_reason) between 1 and 300),
  add column blocked_at timestamptz,
  add column review_requested_at timestamptz,
  add column reviewed_by uuid references public.daymark_profiles (id) on delete set null,
  add column reviewed_at timestamptz;

-- removed_at: removing a subtask archives it.
create table public.daymark_task_subtasks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.daymark_task_items (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 140),
  position int not null,
  done_at timestamptz,
  done_by uuid references public.daymark_profiles (id) on delete set null,
  created_by uuid references public.daymark_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create index daymark_task_subtasks_item_idx on public.daymark_task_subtasks (item_id, position);

-- author_name is frozen at writing, as the audit log does.
create table public.daymark_task_comments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.daymark_task_items (id) on delete cascade,
  subtask_id uuid references public.daymark_task_subtasks (id) on delete set null,
  author_id uuid references public.daymark_profiles (id) on delete set null,
  author_name text not null,
  body text not null check (char_length(body) between 1 and 1000),
  kind text not null default 'comment' check (kind in ('comment', 'changes', 'approved')),
  created_at timestamptz not null default now()
);
create index daymark_task_comments_item_idx on public.daymark_task_comments (item_id, created_at);
create index daymark_task_comments_subtask_idx on public.daymark_task_comments (subtask_id);

alter table public.daymark_task_subtasks enable row level security;
alter table public.daymark_task_comments enable row level security;
revoke all on table public.daymark_task_subtasks from public, anon, authenticated;
revoke all on table public.daymark_task_comments from public, anon, authenticated;
grant all on table public.daymark_task_subtasks to service_role;
grant all on table public.daymark_task_comments to service_role;

-- Every new copy (one-off, repeat or a new assignee) starts with the task's checklist as it is now.
create or replace function private.task_item_subtasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.daymark_task_subtasks (item_id, title, position, created_by, created_at)
  select new.id, x.title, x.n::int, t.created_by, new.created_at
  from public.daymark_tasks t, unnest(t.subtask_titles) with ordinality x (title, n)
  where t.id = new.task_id;
  return null;
end;
$$;
create trigger daymark_task_items_subtasks after insert on public.daymark_task_items
  for each row execute function private.task_item_subtasks();

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- The copy's person, the task's creator or reviewer, a current teammate, or staff who manage the person.
create or replace function private.task_participant(item uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.daymark_task_items i
    join public.daymark_tasks t on t.id = i.task_id
    where i.id = task_participant.item
      and ((select auth.uid()) in (i.person_id, t.created_by, t.reviewer_id)
           or exists (select 1 from public.daymark_task_collaborators k
                      where k.task_id = t.id and k.person_id = (select auth.uid()) and k.removed_at is null)
           or private.manages_tasks_of(i.person_id)));
$$;

-- A copy of a live (unarchived) task, or "That task is gone."
create or replace function private.task_item(item uuid)
returns public.daymark_task_items
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i public.daymark_task_items%rowtype;
begin
  select x.* into i from public.daymark_task_items x
  join public.daymark_tasks t on t.id = x.task_id and t.archived_at is null
  where x.id = task_item.item;
  if not found then
    raise exception 'That task is gone.' using errcode = 'P0002';
  end if;
  return i;
end;
$$;

-- Subtasks are changed by the copy's person, the task's creator or its reviewer, and not once the copy is done.
create or replace function private.require_subtask_editor(item uuid)
returns public.daymark_task_items
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i public.daymark_task_items%rowtype := private.task_item(require_subtask_editor.item);
begin
  if not exists (select 1 from public.daymark_tasks t
                 where t.id = i.task_id and (select auth.uid()) in (i.person_id, t.created_by, t.reviewer_id)) then
    raise exception 'Only the person it''s for, the task''s creator or its reviewer can change subtasks.'
      using errcode = '42501';
  end if;
  if i.status = 'done' then
    raise exception 'This task is done.' using errcode = '22023';
  end if;
  return i;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. save_task: three new arguments at the end (reviewer, estimate, starting checklist)
-- ---------------------------------------------------------------------------
drop function public.save_task(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[]);
drop function private.save_task(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[]);

create function private.save_task(id uuid, title text, description text, priority text, due_date date,
  due_time time, link text, assignees uuid[], repeat_days int[], repeat_until date, collaborators uuid[],
  reviewer uuid default null, estimate_minutes int default null, subtasks text[] default null)
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
  checklist text[] := array(select btrim(s) from unnest(save_task.subtasks) s);
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
  if save_task.estimate_minutes not between 1 and 6000 then
    raise exception 'Keep the estimate between 1 minute and 100 hours.' using errcode = '22023';
  end if;
  if cardinality(checklist) > 30
     or exists (select 1 from unnest(checklist) s where coalesce(char_length(s), 0) not between 1 and 140) then
    raise exception 'Add up to 30 subtasks, each up to 140 characters.' using errcode = '22023';
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

  -- Reviewer: an active admin, an active supervisor of every assignee, or an active intern who isn't an assignee.
  if save_task.reviewer is not null and not exists (
       select 1 from public.daymark_profiles r
       where r.id = save_task.reviewer and r.active
         and (r.is_admin
              or (r.is_supervisor
                  and not exists (select 1 from unnest(people) x
                                  where not exists (select 1 from public.daymark_placements pl
                                                    where pl.intern_id = x and pl.supervisor_id = r.id
                                                      and pl.status in ('active', 'extended', 'target_reached'))))
              or (r.is_intern and not r.id = any (people)))) then
    raise exception 'That reviewer can''t review this task.' using errcode = '42501';
  end if;

  if save_task.id is null then
    insert into public.daymark_tasks (title, description, priority, due_date, due_time, link, repeat_days, repeat_until,
                                      created_by, created_at, reviewer_id, estimate_minutes, subtask_titles)
    values (btrim(save_task.title), nullif(btrim(save_task.description), ''), coalesce(save_task.priority, 'medium'),
            case when save_task.repeat_days is null then save_task.due_date end, save_task.due_time,
            nullif(btrim(save_task.link), ''), case when save_task.repeat_days is not null then days end,
            case when save_task.repeat_days is not null then save_task.repeat_until end, me, private.clock_now(),
            save_task.reviewer, save_task.estimate_minutes, nullif(checklist, '{}'))
    returning * into t;
  else
    old := private.require_task_manager(save_task.id);
    -- ponytail: switching a task between one-off and repeating would leave copies with mixed dates;
    -- refused for now, archive and recreate instead. Upgrade: reconcile the open copies on switch.
    if (old.repeat_days is null) <> (save_task.repeat_days is null) then
      raise exception 'A task can''t switch between one-off and repeating. Archive it and add a new one.'
        using errcode = '22023';
    end if;
    -- A new checklist applies to copies made from now on; existing copies keep their own subtasks.
    update public.daymark_tasks x
    set title = btrim(save_task.title), description = nullif(btrim(save_task.description), ''),
        priority = coalesce(save_task.priority, 'medium'),
        due_date = case when save_task.repeat_days is null then save_task.due_date end,
        due_time = save_task.due_time, link = nullif(btrim(save_task.link), ''),
        repeat_days = case when save_task.repeat_days is not null then days end,
        repeat_until = case when save_task.repeat_days is not null then save_task.repeat_until end,
        reviewer_id = save_task.reviewer, estimate_minutes = save_task.estimate_minutes,
        -- null on edit keeps the starting checklist (the edit form doesn't load it); [] clears it
        subtask_titles = case when save_task.subtasks is null then x.subtask_titles else nullif(checklist, '{}') end
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

-- ---------------------------------------------------------------------------
-- 4. Status and review
-- ---------------------------------------------------------------------------
create or replace function private.set_task_status(item uuid, status text, note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  i public.daymark_task_items%rowtype := private.task_item(set_task_status.item);
  t public.daymark_tasks%rowtype;
  unticked boolean;
begin
  select * into t from public.daymark_tasks x where x.id = i.task_id;
  if i.person_id is distinct from me and not private.manages_tasks_of(i.person_id) then
    raise exception 'Only the person it''s for can tick this task.' using errcode = '42501';
  end if;
  if set_task_status.status is null or set_task_status.status not in ('todo', 'in_progress', 'in_review', 'done') then
    raise exception 'Pick a status: to do, in progress, in review or done.' using errcode = '22023';
  end if;
  if char_length(set_task_status.note) > 500 then
    raise exception 'Keep the note to 500 characters.' using errcode = '22023';
  end if;
  unticked := exists (select 1 from public.daymark_task_subtasks s
                      where s.item_id = i.id and s.removed_at is null and s.done_at is null);
  if set_task_status.status = 'in_review' then
    if t.reviewer_id is null then
      raise exception 'This task has no reviewer. Mark it done instead.' using errcode = '22023';
    end if;
    if i.person_id is distinct from me then
      raise exception 'Only the person it''s for can send it for review.' using errcode = '42501';
    end if;
    if unticked then
      raise exception 'Tick all subtasks first.' using errcode = '22023';
    end if;
  elsif set_task_status.status = 'done' then
    if t.reviewer_id is not null then
      raise exception 'Send it for review. Your reviewer marks it done.' using errcode = '42501';
    end if;
    if unticked then
      raise exception 'Tick all subtasks first.' using errcode = '22023';
    end if;
  end if;

  update public.daymark_task_items x
  set status = set_task_status.status,
      done_at = case when set_task_status.status = 'done' then private.clock_now() end,
      done_note = case when set_task_status.status = 'done' then nullif(btrim(set_task_status.note), '') else x.done_note end,
      review_requested_at = case when set_task_status.status = 'in_review' then private.clock_now()
                                 else x.review_requested_at end
  where x.id = i.id;

  if set_task_status.status = 'in_review' and i.status <> 'in_review' then
    perform private.notify(t.reviewer_id, 'task', 'Task to review',
      t.title || ' · from ' || (select p.display_name from public.daymark_profiles p where p.id = i.person_id),
      '/clock/tasks');
  end if;
end;
$$;

create or replace function private.review_task(item uuid, approve boolean, comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  i public.daymark_task_items%rowtype := private.task_item(review_task.item);
  t public.daymark_tasks%rowtype;
  said text := nullif(btrim(review_task.comment), '');
begin
  select * into t from public.daymark_tasks x where x.id = i.task_id;
  if t.reviewer_id is distinct from me then
    raise exception 'Only the task''s reviewer can review it.' using errcode = '42501';
  end if;
  if i.status <> 'in_review' then
    raise exception 'This task isn''t waiting for review.' using errcode = '22023';
  end if;
  if review_task.approve is null then
    raise exception 'Approve it or ask for changes.' using errcode = '22023';
  end if;
  if char_length(said) > 1000 then
    raise exception 'Keep the comment to 1,000 characters.' using errcode = '22023';
  end if;
  if not review_task.approve and said is null then
    raise exception 'Say what needs changing.' using errcode = '22023';
  end if;

  if review_task.approve then
    update public.daymark_task_items x
    set status = 'done', done_at = private.clock_now(), reviewed_by = me, reviewed_at = private.clock_now()
    where x.id = i.id;
  else
    update public.daymark_task_items x set status = 'in_progress', done_at = null where x.id = i.id;
  end if;
  -- An approval without a comment still leaves an "approved" line in the thread.
  insert into public.daymark_task_comments (item_id, author_id, author_name, body, kind, created_at)
  select i.id, me, p.display_name, coalesce(said, 'Approved.'),
         case when review_task.approve then 'approved' else 'changes' end, private.clock_now()
  from public.daymark_profiles p where p.id = me;
  perform private.notify(i.person_id, 'task',
    case when review_task.approve then 'Approved: ' else 'Changes needed: ' end || t.title,
    coalesce(said, ''), '/clock/tasks?item=' || i.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Subtasks, time, blocked
-- ---------------------------------------------------------------------------
create or replace function private.add_subtask(item uuid, title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.daymark_task_items%rowtype := private.require_subtask_editor(add_subtask.item);
  new_id uuid;
begin
  if char_length(btrim(coalesce(add_subtask.title, ''))) not between 1 and 140 then
    raise exception 'Write a subtask up to 140 characters.' using errcode = '22023';
  end if;
  -- ponytail: caps live subtasks at the template's 30 so a copy can't grow without bound.
  if (select count(*) from public.daymark_task_subtasks s where s.item_id = i.id and s.removed_at is null) >= 30 then
    raise exception 'A task can have up to 30 subtasks.' using errcode = '22023';
  end if;
  insert into public.daymark_task_subtasks (item_id, title, position, created_by, created_at)
  select i.id, btrim(add_subtask.title), coalesce(max(s.position), 0) + 1, (select auth.uid()), private.clock_now()
  from public.daymark_task_subtasks s where s.item_id = i.id
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function private.set_subtask(id uuid, done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.daymark_task_subtasks%rowtype;
begin
  select * into s from public.daymark_task_subtasks x where x.id = set_subtask.id and x.removed_at is null;
  if not found then
    raise exception 'That subtask is gone.' using errcode = 'P0002';
  end if;
  perform private.require_subtask_editor(s.item_id);
  update public.daymark_task_subtasks x
  set done_at = case when set_subtask.done then coalesce(x.done_at, private.clock_now()) end,
      done_by = case when set_subtask.done then coalesce(x.done_by, (select auth.uid())) end
  where x.id = s.id;
end;
$$;

create or replace function private.remove_subtask(id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.daymark_task_subtasks%rowtype;
begin
  select * into s from public.daymark_task_subtasks x where x.id = remove_subtask.id and x.removed_at is null;
  if not found then
    raise exception 'That subtask is gone.' using errcode = 'P0002';
  end if;
  perform private.require_subtask_editor(s.item_id);
  update public.daymark_task_subtasks x set removed_at = private.clock_now() where x.id = s.id;
end;
$$;

create or replace function private.log_task_time(item uuid, minutes int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.daymark_task_items%rowtype := private.task_item(log_task_time.item);
begin
  if i.person_id is distinct from (select auth.uid()) then
    raise exception 'Only the person it''s for can log time on it.' using errcode = '42501';
  end if;
  if log_task_time.minutes is null or log_task_time.minutes not between 0 and 60000 then
    raise exception 'Log between 0 and 1,000 hours.' using errcode = '22023';
  end if;
  update public.daymark_task_items x set spent_minutes = log_task_time.minutes where x.id = i.id;
end;
$$;

create or replace function private.set_task_blocked(item uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  i public.daymark_task_items%rowtype := private.task_item(set_task_blocked.item);
  t public.daymark_tasks%rowtype;
  why text := btrim(set_task_blocked.reason);
  who uuid;
begin
  if i.person_id is distinct from me and not private.manages_tasks_of(i.person_id) then
    raise exception 'Only the person it''s for or their supervisor can mark it blocked.' using errcode = '42501';
  end if;
  if set_task_blocked.reason is not null and char_length(why) not between 1 and 300 then
    raise exception 'Say why it''s blocked, up to 300 characters.' using errcode = '22023';
  end if;
  update public.daymark_task_items x
  set blocked_reason = why,
      blocked_at = case when why is not null then private.clock_now() end
  where x.id = i.id;
  if why is not null then
    select * into t from public.daymark_tasks x where x.id = i.task_id;
    for who in select distinct x from unnest(array[t.created_by, t.reviewer_id]) x where x is not null and x <> me loop
      perform private.notify(who, 'task', 'Blocked: ' || t.title, why, '/clock/tasks?item=' || i.id);
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Thread: subtasks and comments
-- ---------------------------------------------------------------------------
create or replace function private.task_thread(item uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i public.daymark_task_items%rowtype := private.task_item(task_thread.item);
begin
  if not private.task_participant(i.id) then
    raise exception 'You''re not part of this task.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'subtasks', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'position', s.position,
                                                               'done_at', s.done_at, 'done_by_name', p.display_name)
                                           order by s.position, s.created_at)
                          from public.daymark_task_subtasks s
                          left join public.daymark_profiles p on p.id = s.done_by
                          where s.item_id = i.id and s.removed_at is null), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'subtask_id', c.subtask_id,
                                                               'author_name', c.author_name, 'body', c.body,
                                                               'kind', c.kind, 'created_at', c.created_at,
                                                               'mine', coalesce(c.author_id = (select auth.uid()), false))
                                           order by c.created_at, c.id)
                          from public.daymark_task_comments c
                          where c.item_id = i.id), '[]'::jsonb));
end;
$$;

create or replace function private.add_task_comment(item uuid, body text, subtask uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  i public.daymark_task_items%rowtype := private.task_item(add_task_comment.item);
  t public.daymark_tasks%rowtype;
  said text := btrim(add_task_comment.body);
  item_link text := '/clock/tasks?item=' || i.id;
  author text;
  new_id uuid;
  who uuid;
begin
  if not private.task_participant(i.id) then
    raise exception 'You''re not part of this task.' using errcode = '42501';
  end if;
  if coalesce(char_length(said), 0) not between 1 and 1000 then
    raise exception 'Write a comment up to 1,000 characters.' using errcode = '22023';
  end if;
  if add_task_comment.subtask is not null
     and not exists (select 1 from public.daymark_task_subtasks s
                     where s.id = add_task_comment.subtask and s.item_id = i.id and s.removed_at is null) then
    raise exception 'Pick a subtask of this task.' using errcode = '22023';
  end if;
  select * into t from public.daymark_tasks x where x.id = i.task_id;
  select p.display_name into author from public.daymark_profiles p where p.id = me;
  insert into public.daymark_task_comments (item_id, subtask_id, author_id, author_name, body, kind, created_at)
  values (i.id, add_task_comment.subtask, me, coalesce(author, 'Someone'), said, 'comment', private.clock_now())
  returning id into new_id;

  -- The person, creator and reviewer (not the writer), at most once per copy every 10 minutes.
  for who in select distinct x from unnest(array[i.person_id, t.created_by, t.reviewer_id]) x
             where x is not null and x <> me
               and not exists (select 1 from public.daymark_notifications n
                               where n.person_id = x and n.kind = 'task' and n.link = item_link
                                 and n.title like 'New comment: %'
                                 and n.created_at > private.clock_now() - interval '10 minutes') loop
    perform private.notify(who, 'task', 'New comment: ' || t.title,
      coalesce(author, 'Someone') || ': ' || left(said, 200), item_link);
  end loop;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Reads: the new columns, and copies waiting for the caller's review
-- ---------------------------------------------------------------------------
drop function public.my_tasks();
drop function private.my_tasks();
drop function public.staff_tasks(uuid);
drop function private.staff_tasks(uuid);

create function private.my_tasks()
returns table (item_id uuid, task_id uuid, title text, description text, priority text, due_date date, due_time time,
               link text, status text, done_at timestamptz, done_note text, created_by_name text, own boolean,
               working_with text[], repeat_days int[], reviewer_id uuid, reviewer_name text, estimate_minutes int,
               spent_minutes int, blocked_reason text, subtasks_total int, subtasks_done int, comments int,
               review_requested_at timestamptz, to_review boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, t.id, t.title, t.description, t.priority, i.due_date, t.due_time, t.link, i.status, i.done_at, i.done_note,
         coalesce(c.display_name, 'Someone'), i.person_id = (select auth.uid()),
         -- Own copy: the teammates. A teammate's (or reviewer's) view: the owner and the other teammates.
         array(select p.display_name from public.daymark_profiles p
               where p.id <> (select auth.uid())
                 and (p.id = i.person_id
                      or exists (select 1 from public.daymark_task_collaborators k
                                 where k.task_id = t.id and k.person_id = p.id and k.removed_at is null))
               order by p.display_name),
         t.repeat_days, t.reviewer_id, r.display_name, t.estimate_minutes, i.spent_minutes, i.blocked_reason,
         (select count(*)::int from public.daymark_task_subtasks s where s.item_id = i.id and s.removed_at is null),
         (select count(*)::int from public.daymark_task_subtasks s
          where s.item_id = i.id and s.removed_at is null and s.done_at is not null),
         (select count(*)::int from public.daymark_task_comments m where m.item_id = i.id),
         i.review_requested_at,
         coalesce(t.reviewer_id = (select auth.uid()) and i.status = 'in_review', false)
  from public.daymark_task_items i
  join public.daymark_tasks t on t.id = i.task_id and t.archived_at is null
  left join public.daymark_profiles c on c.id = t.created_by
  left join public.daymark_profiles r on r.id = t.reviewer_id
  where (i.person_id = (select auth.uid())
         or exists (select 1 from public.daymark_task_collaborators k
                    where k.task_id = t.id and k.person_id = (select auth.uid()) and k.removed_at is null)
         or (t.reviewer_id = (select auth.uid()) and i.status = 'in_review'))
    and not (i.status = 'done' and i.done_at <= private.clock_now() - interval '30 days')
    and private.task_item_live(i)
  order by i.status = 'done',
           case when i.status <> 'done' then i.due_date end nulls last,
           case when i.status <> 'done' then case t.priority when 'high' then 0 when 'medium' then 1 else 2 end end,
           i.done_at desc nulls last, t.title;
$$;

create function private.staff_tasks(intern uuid default null)
returns table (item_id uuid, task_id uuid, person_id uuid, person_name text, title text, description text, priority text,
               due_date date, due_time time, link text, status text, done_at timestamptz, done_note text,
               created_by_name text, repeat_days int[], repeat_until date, reviewer_id uuid, reviewer_name text,
               estimate_minutes int, spent_minutes int, blocked_reason text, subtasks_total int, subtasks_done int,
               comments int, review_requested_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, t.id, i.person_id, p.display_name, t.title, t.description, t.priority, i.due_date, t.due_time, t.link,
         i.status, i.done_at, i.done_note, coalesce(c.display_name, 'Someone'), t.repeat_days, t.repeat_until,
         t.reviewer_id, r.display_name, t.estimate_minutes, i.spent_minutes, i.blocked_reason,
         (select count(*)::int from public.daymark_task_subtasks s where s.item_id = i.id and s.removed_at is null),
         (select count(*)::int from public.daymark_task_subtasks s
          where s.item_id = i.id and s.removed_at is null and s.done_at is not null),
         (select count(*)::int from public.daymark_task_comments m where m.item_id = i.id),
         i.review_requested_at
  from public.daymark_task_items i
  join public.daymark_tasks t on t.id = i.task_id and t.archived_at is null
  join public.daymark_profiles p on p.id = i.person_id
  left join public.daymark_profiles c on c.id = t.created_by
  left join public.daymark_profiles r on r.id = t.reviewer_id
  where (staff_tasks.intern is null or i.person_id = staff_tasks.intern)
    and private.manages_tasks_of(i.person_id)
    and not (i.status = 'done' and i.done_at <= private.clock_now() - interval '30 days')
    and private.task_item_live(i)
  order by i.due_date nulls last, t.created_at, t.id, p.display_name;
$$;

-- ---------------------------------------------------------------------------
-- 8. The 8 am summary, as in 20261018010000_tasks.sql, plus blocked copies and copies waiting for their review
-- ---------------------------------------------------------------------------
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
                                        and pl.status in ('active', 'extended', 'target_reached')))) as overdue,
      (select count(*)::int
         from public.daymark_task_items i
         join public.daymark_tasks t on t.id = i.task_id and t.archived_at is null
         where i.status <> 'done' and i.blocked_reason is not null and private.task_item_live(i)
           and (p.is_admin or exists (select 1 from public.daymark_placements pl
                                      where pl.intern_id = i.person_id and pl.supervisor_id = p.id
                                        and pl.status in ('active', 'extended', 'target_reached')))) as blocked,
      (select count(*)::int
         from public.daymark_task_items i
         join public.daymark_tasks t on t.id = i.task_id and t.archived_at is null
         where i.status = 'in_review' and t.reviewer_id = p.id and private.task_item_live(i)) as to_review
    from public.daymark_profiles p
    where p.active and (p.is_admin or p.is_supervisor)
  loop
    parts := '{}';
    if r.late > 0 then parts := parts || (r.late || ' not clocked in yet'); end if;
    if r.waiting > 0 then parts := parts || (r.waiting || ' waiting for your approval'); end if;
    if r.overdue > 0 then
      parts := parts || (r.overdue || case when r.overdue = 1 then ' task overdue' else ' tasks overdue' end);
    end if;
    if r.blocked > 0 then parts := parts || (r.blocked || ' blocked'); end if;
    if r.to_review > 0 then parts := parts || (r.to_review || ' waiting for your review'); end if;
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

-- ---------------------------------------------------------------------------
-- 9. Wrappers and grants
-- ---------------------------------------------------------------------------
create function public.save_task(id uuid, title text, description text, priority text, due_date date,
  due_time time, link text, assignees uuid[], repeat_days int[], repeat_until date, collaborators uuid[],
  reviewer uuid default null, estimate_minutes int default null, subtasks text[] default null)
returns uuid language sql security invoker set search_path = ''
as $$ select private.save_task(id, title, description, priority, due_date, due_time, link, assignees, repeat_days,
                               repeat_until, collaborators, reviewer, estimate_minutes, subtasks); $$;
create or replace function public.review_task(item uuid, approve boolean, comment text default null)
returns void language sql security invoker set search_path = ''
as $$ select private.review_task(item, approve, comment); $$;
create or replace function public.add_subtask(item uuid, title text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.add_subtask(item, title); $$;
create or replace function public.set_subtask(id uuid, done boolean)
returns void language sql security invoker set search_path = ''
as $$ select private.set_subtask(id, done); $$;
create or replace function public.remove_subtask(id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.remove_subtask(id); $$;
create or replace function public.log_task_time(item uuid, minutes int)
returns void language sql security invoker set search_path = ''
as $$ select private.log_task_time(item, minutes); $$;
create or replace function public.set_task_blocked(item uuid, reason text)
returns void language sql security invoker set search_path = ''
as $$ select private.set_task_blocked(item, reason); $$;
create or replace function public.task_thread(item uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.task_thread(item); $$;
create or replace function public.add_task_comment(item uuid, body text, subtask uuid default null)
returns uuid language sql security invoker set search_path = ''
as $$ select private.add_task_comment(item, body, subtask); $$;
create function public.my_tasks()
returns table (item_id uuid, task_id uuid, title text, description text, priority text, due_date date, due_time time,
               link text, status text, done_at timestamptz, done_note text, created_by_name text, own boolean,
               working_with text[], repeat_days int[], reviewer_id uuid, reviewer_name text, estimate_minutes int,
               spent_minutes int, blocked_reason text, subtasks_total int, subtasks_done int, comments int,
               review_requested_at timestamptz, to_review boolean)
language sql stable security invoker set search_path = ''
as $$ select * from private.my_tasks(); $$;
create function public.staff_tasks(intern uuid default null)
returns table (item_id uuid, task_id uuid, person_id uuid, person_name text, title text, description text, priority text,
               due_date date, due_time time, link text, status text, done_at timestamptz, done_note text,
               created_by_name text, repeat_days int[], repeat_until date, reviewer_id uuid, reviewer_name text,
               estimate_minutes int, spent_minutes int, blocked_reason text, subtasks_total int, subtasks_done int,
               comments int, review_requested_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.staff_tasks(intern); $$;

revoke all on function private.task_item_subtasks() from public, anon, authenticated;
revoke all on function private.task_participant(uuid) from public, anon;
revoke all on function private.task_item(uuid) from public, anon;
revoke all on function private.require_subtask_editor(uuid) from public, anon;
revoke all on function private.save_task(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[], uuid, int, text[])
  from public, anon;
revoke all on function private.set_task_status(uuid, text, text) from public, anon;
revoke all on function private.review_task(uuid, boolean, text) from public, anon;
revoke all on function private.add_subtask(uuid, text) from public, anon;
revoke all on function private.set_subtask(uuid, boolean) from public, anon;
revoke all on function private.remove_subtask(uuid) from public, anon;
revoke all on function private.log_task_time(uuid, int) from public, anon;
revoke all on function private.set_task_blocked(uuid, text) from public, anon;
revoke all on function private.task_thread(uuid) from public, anon;
revoke all on function private.add_task_comment(uuid, text, uuid) from public, anon;
revoke all on function private.my_tasks() from public, anon;
revoke all on function private.staff_tasks(uuid) from public, anon;
revoke all on function private.job_digest() from public, anon, authenticated;
revoke all on function public.save_task(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[], uuid, int, text[])
  from public, anon;
revoke all on function public.review_task(uuid, boolean, text) from public, anon;
revoke all on function public.add_subtask(uuid, text) from public, anon;
revoke all on function public.set_subtask(uuid, boolean) from public, anon;
revoke all on function public.remove_subtask(uuid) from public, anon;
revoke all on function public.log_task_time(uuid, int) from public, anon;
revoke all on function public.set_task_blocked(uuid, text) from public, anon;
revoke all on function public.task_thread(uuid) from public, anon;
revoke all on function public.add_task_comment(uuid, text, uuid) from public, anon;
revoke all on function public.my_tasks() from public, anon;
revoke all on function public.staff_tasks(uuid) from public, anon;
grant execute on function private.task_participant(uuid) to authenticated;
grant execute on function private.task_item(uuid) to authenticated;
grant execute on function private.require_subtask_editor(uuid) to authenticated;
grant execute on function private.save_task(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[], uuid, int, text[])
  to authenticated;
grant execute on function private.set_task_status(uuid, text, text) to authenticated;
grant execute on function private.review_task(uuid, boolean, text) to authenticated;
grant execute on function private.add_subtask(uuid, text) to authenticated;
grant execute on function private.set_subtask(uuid, boolean) to authenticated;
grant execute on function private.remove_subtask(uuid) to authenticated;
grant execute on function private.log_task_time(uuid, int) to authenticated;
grant execute on function private.set_task_blocked(uuid, text) to authenticated;
grant execute on function private.task_thread(uuid) to authenticated;
grant execute on function private.add_task_comment(uuid, text, uuid) to authenticated;
grant execute on function private.my_tasks() to authenticated;
grant execute on function private.staff_tasks(uuid) to authenticated;
grant execute on function public.save_task(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[], uuid, int, text[])
  to authenticated;
grant execute on function public.review_task(uuid, boolean, text) to authenticated;
grant execute on function public.add_subtask(uuid, text) to authenticated;
grant execute on function public.set_subtask(uuid, boolean) to authenticated;
grant execute on function public.remove_subtask(uuid) to authenticated;
grant execute on function public.log_task_time(uuid, int) to authenticated;
grant execute on function public.set_task_blocked(uuid, text) to authenticated;
grant execute on function public.task_thread(uuid) to authenticated;
grant execute on function public.add_task_comment(uuid, text, uuid) to authenticated;
grant execute on function public.my_tasks() to authenticated;
grant execute on function public.staff_tasks(uuid) to authenticated;

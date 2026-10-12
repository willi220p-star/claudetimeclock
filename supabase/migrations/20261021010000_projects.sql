-- Projects, milestones, labels and workload (Dilip, 13 Oct; D49). Contract: docs/superpowers/specs/2026-10-13-projects-contract.md.
-- A project groups tasks, with a lead, members, milestones and an activity feed. An intern's project waits for their
-- supervisor or an admin; staff projects are approved at once. Labels tag tasks. Nothing here deletes a row: a removed
-- project, milestone or label is archived, a removed member or task label is marked removed, and the old functions
-- are renamed to *_d48 with their access switched off (the remote apply tool refuses removals).

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
-- approved_at and approved_by are both null while the project waits for approval.
create table public.daymark_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  client_name text check (char_length(client_name) <= 120),
  contact_name text check (char_length(contact_name) <= 80),
  contact_email text check (char_length(contact_email) <= 200 and strpos(contact_email, '@') > 0),
  contact_phone text check (char_length(contact_phone) <= 30),
  start_date date,
  due_date date,
  status text not null default 'planning' check (status in ('planning', 'active', 'on_hold', 'completed')),
  description text check (char_length(description) <= 2000),
  -- Each link (https://, up to 500 characters) is checked by save_project; a check constraint can't look inside the array.
  links text[] check (cardinality(links) <= 5),
  lead_id uuid references public.daymark_profiles (id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references public.daymark_profiles (id) on delete set null,
  created_by uuid references public.daymark_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint daymark_projects_dates_check check (due_date >= start_date)
);
create index daymark_projects_lead_idx on public.daymark_projects (lead_id);
create index daymark_projects_created_by_idx on public.daymark_projects (created_by);
create index daymark_projects_approved_by_idx on public.daymark_projects (approved_by);

-- removed_at: a removed member (null while current). Rows are never deleted.
create table public.daymark_project_members (
  project_id uuid not null references public.daymark_projects (id) on delete cascade,
  person_id uuid not null references public.daymark_profiles (id) on delete cascade,
  removed_at timestamptz,
  primary key (project_id, person_id)
);
create index daymark_project_members_person_idx on public.daymark_project_members (person_id);

create table public.daymark_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.daymark_projects (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  due_date date,
  position int not null,
  archived_at timestamptz
);
create index daymark_milestones_project_idx on public.daymark_milestones (project_id, position);

alter table public.daymark_tasks
  add column project_id uuid references public.daymark_projects (id) on delete set null,
  add column milestone_id uuid references public.daymark_milestones (id) on delete set null;
create index daymark_tasks_project_idx on public.daymark_tasks (project_id);
create index daymark_tasks_milestone_idx on public.daymark_tasks (milestone_id);

-- actor_name is frozen at writing, as the audit log does.
create table public.daymark_project_activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.daymark_projects (id) on delete cascade,
  actor_id uuid references public.daymark_profiles (id) on delete set null,
  actor_name text not null,
  kind text not null check (kind in ('task_added', 'task_done', 'review_approved', 'changes_asked', 'status_changed',
                                     'member_added', 'milestone_added', 'milestone_done', 'project_created',
                                     'project_approved')),
  text text not null check (char_length(text) <= 200),
  created_at timestamptz not null default now()
);
create index daymark_project_activity_project_idx on public.daymark_project_activity (project_id, created_at desc);
create index daymark_project_activity_actor_idx on public.daymark_project_activity (actor_id);

create table public.daymark_labels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 30),
  colour text not null check (colour in ('blue', 'teal', 'green', 'orange', 'red', 'purple', 'pink', 'grey')),
  archived_at timestamptz
);
create unique index daymark_labels_name_idx on public.daymark_labels (lower(name)) where archived_at is null;

-- removed_at: a label taken off the task. Rows are never deleted; putting it back clears removed_at.
create table public.daymark_task_labels (
  task_id uuid not null references public.daymark_tasks (id) on delete cascade,
  label_id uuid not null references public.daymark_labels (id) on delete cascade,
  removed_at timestamptz,
  primary key (task_id, label_id)
);
create index daymark_task_labels_label_idx on public.daymark_task_labels (label_id);

alter table public.daymark_projects enable row level security;
alter table public.daymark_project_members enable row level security;
alter table public.daymark_milestones enable row level security;
alter table public.daymark_project_activity enable row level security;
alter table public.daymark_labels enable row level security;
alter table public.daymark_task_labels enable row level security;
revoke all on table public.daymark_projects from public, anon, authenticated;
revoke all on table public.daymark_project_members from public, anon, authenticated;
revoke all on table public.daymark_milestones from public, anon, authenticated;
revoke all on table public.daymark_project_activity from public, anon, authenticated;
revoke all on table public.daymark_labels from public, anon, authenticated;
revoke all on table public.daymark_task_labels from public, anon, authenticated;
grant all on table public.daymark_projects to service_role;
grant all on table public.daymark_project_members to service_role;
grant all on table public.daymark_milestones to service_role;
grant all on table public.daymark_project_activity to service_role;
grant all on table public.daymark_labels to service_role;
grant all on table public.daymark_task_labels to service_role;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- Who sees a project. A project waiting for approval: its creator, admins and the creator's supervisors. Otherwise
-- admins, the lead, the creator, current members, anyone with a live copy of one of its tasks, and supervisors of
-- the lead, members or those copies' people.
create or replace function private.project_visible(project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.daymark_projects p
    where p.id = project_visible.project
      and (private.is_admin()
           or case when p.approved_at is null
                then coalesce(p.created_by = (select auth.uid()), false) or private.manages_tasks_of(p.created_by)
                else coalesce((select auth.uid()) in (p.lead_id, p.created_by), false)
                  or private.manages_tasks_of(p.lead_id)
                  or exists (select 1 from public.daymark_project_members m
                             where m.project_id = p.id and m.removed_at is null
                               and (m.person_id = (select auth.uid()) or private.manages_tasks_of(m.person_id)))
                  or exists (select 1 from public.daymark_task_items i
                             join public.daymark_tasks t on t.id = i.task_id and t.archived_at is null
                             where t.project_id = p.id and private.task_item_live(i)
                               and (i.person_id = (select auth.uid()) or private.manages_tasks_of(i.person_id)))
              end));
$$;

-- A live (unarchived) project, or "That project is gone."
create or replace function private.require_project(id uuid)
returns public.daymark_projects
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.daymark_projects%rowtype;
begin
  select * into p from public.daymark_projects x where x.id = require_project.id and x.archived_at is null;
  if not found then
    raise exception 'That project is gone.' using errcode = 'P0002';
  end if;
  return p;
end;
$$;

-- Copies counted toward a milestone: live copies of its unarchived tasks.
create or replace function private.milestone_counts(milestone uuid, out total int, out done int)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int, (count(*) filter (where i.status = 'done'))::int
  from public.daymark_task_items i
  join public.daymark_tasks t on t.id = i.task_id and t.archived_at is null
  where t.milestone_id = milestone_counts.milestone and private.task_item_live(i);
$$;

-- Done: at least one task, and all of them done.
create or replace function private.milestone_done(milestone uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select k.total > 0 and k.total = k.done from private.milestone_counts(milestone_done.milestone) k;
$$;

-- One line in the project's feed, by the caller.
create or replace function private.project_log(project uuid, kind text, body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.daymark_project_activity (project_id, actor_id, actor_name, kind, text, created_at)
  select project_log.project, (select auth.uid()),
         coalesce((select p.display_name from public.daymark_profiles p where p.id = (select auth.uid())), 'Someone'),
         project_log.kind, left(project_log.body, 200), private.clock_now();
$$;

-- Activity for a copy whose status just changed, plus milestone_done when it was the milestone's last open copy.
create or replace function private.task_project_log(t public.daymark_tasks, was text, kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if t.project_id is null then
    return;
  end if;
  perform private.project_log(t.project_id, task_project_log.kind, t.title);
  if was <> 'done' and t.milestone_id is not null and private.milestone_done(t.milestone_id) then
    perform private.project_log(t.project_id, 'milestone_done',
      (select m.name from public.daymark_milestones m where m.id = t.milestone_id));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. People and projects
-- ---------------------------------------------------------------------------
-- Staff add any active intern or staff member; an intern adds active interns. With a project the caller can see,
-- its current lead and members are included too, so an edit form can show them.
create or replace function private.project_people(project uuid default null)
returns table (person_id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name
  from public.daymark_profiles p
  join public.daymark_profiles me on me.id = (select auth.uid()) and me.active
  where p.active
    and ((p.is_intern and (private.is_staff() or me.is_intern))
         or (private.is_staff() and (p.is_supervisor or p.is_admin))
         or (project_people.project is not null and private.project_visible(project_people.project)
             and (p.id = (select x.lead_id from public.daymark_projects x where x.id = project_people.project)
                  or exists (select 1 from public.daymark_project_members m
                             where m.project_id = project_people.project and m.person_id = p.id and m.removed_at is null))))
  order by p.display_name, p.id;
$$;

create or replace function private.save_project(id uuid, name text, client_name text, contact_name text,
  contact_email text, contact_phone text, start_date date, due_date date, status text, description text, links text[],
  lead uuid, members uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  staff boolean := private.is_staff();
  old public.daymark_projects%rowtype;
  p public.daymark_projects%rowtype;
  hrefs text[] := array(select btrim(l) from unnest(save_project.links) l where nullif(btrim(l), '') is not null);
  people uuid[] := array(select distinct x from unnest(coalesce(save_project.members, '{}')) x where x is not null);
  fresh uuid[];
  who uuid;
  status_names constant jsonb := '{"planning": "Planning", "active": "Active", "on_hold": "On hold", "completed": "Completed"}';
begin
  if not exists (select 1 from public.daymark_profiles x where x.id = me and x.active) then
    raise exception 'Only an active person can add projects.' using errcode = '42501';
  end if;

  -- Fields.
  if char_length(btrim(coalesce(save_project.name, ''))) not between 1 and 80 then
    raise exception 'Write a project name up to 80 characters.' using errcode = '22023';
  end if;
  if char_length(btrim(save_project.client_name)) > 120 then
    raise exception 'Keep the client name to 120 characters.' using errcode = '22023';
  end if;
  if char_length(btrim(save_project.contact_name)) > 80 then
    raise exception 'Keep the contact name to 80 characters.' using errcode = '22023';
  end if;
  if nullif(btrim(save_project.contact_email), '') is not null
     and (strpos(save_project.contact_email, '@') = 0 or char_length(btrim(save_project.contact_email)) > 200) then
    raise exception 'Write the contact email with an @, up to 200 characters.' using errcode = '22023';
  end if;
  if char_length(btrim(save_project.contact_phone)) > 30 then
    raise exception 'Keep the contact phone to 30 characters.' using errcode = '22023';
  end if;
  if save_project.due_date < save_project.start_date then
    raise exception 'The due date must be on or after the start date.' using errcode = '22023';
  end if;
  if coalesce(save_project.status, 'planning') not in ('planning', 'active', 'on_hold', 'completed') then
    raise exception 'Pick a status: planning, active, on hold or completed.' using errcode = '22023';
  end if;
  if char_length(save_project.description) > 2000 then
    raise exception 'Keep the description to 2,000 characters.' using errcode = '22023';
  end if;
  if cardinality(hrefs) > 5 or exists (select 1 from unnest(hrefs) l where l !~ '^https://.+' or char_length(l) > 500) then
    raise exception 'Add up to 5 links, each starting with https:// (up to 500 characters).' using errcode = '22023';
  end if;

  if save_project.id is not null then
    old := private.require_project(save_project.id);
    if not (coalesce(me in (old.lead_id), false)
            or (old.approved_at is null and coalesce(old.created_by = me, false))
            or (staff and private.project_visible(old.id))) then
      raise exception 'Only the project''s lead, its creator or staff can change it.' using errcode = '42501';
    end if;
  end if;

  -- People: the lead is active; a new lead or member is someone the caller may add.
  if save_project.lead is not null
     and (not exists (select 1 from public.daymark_profiles x where x.id = save_project.lead and x.active)
          or (save_project.lead is distinct from old.lead_id
              and not exists (select 1 from private.project_people(old.id) x where x.person_id = save_project.lead))) then
    raise exception 'Pick an active person as the lead.' using errcode = '22023';
  end if;
  fresh := array(select x from unnest(people) x
                 where not exists (select 1 from public.daymark_project_members m
                                   where m.project_id = old.id and m.person_id = x and m.removed_at is null));
  if exists (select 1 from unnest(fresh) x where not exists (select 1 from private.project_people(old.id) y where y.person_id = x)) then
    raise exception 'Pick members from the list of active people.' using errcode = '22023';
  end if;

  if save_project.id is null then
    insert into public.daymark_projects (name, client_name, contact_name, contact_email, contact_phone, start_date, due_date,
                                         status, description, links, lead_id, approved_at, approved_by, created_by,
                                         created_at)
    values (btrim(save_project.name), nullif(btrim(save_project.client_name), ''),
            nullif(btrim(save_project.contact_name), ''), nullif(btrim(save_project.contact_email), ''),
            nullif(btrim(save_project.contact_phone), ''), save_project.start_date, save_project.due_date,
            coalesce(save_project.status, 'planning'), nullif(btrim(save_project.description), ''), nullif(hrefs, '{}'),
            -- ponytail: no lead means the creator leads, so every project has someone to show on its card.
            coalesce(save_project.lead, me),
            case when staff then private.clock_now() end, case when staff then me end, me, private.clock_now())
    returning * into p;
    perform private.project_log(p.id, 'project_created', p.name);
  else
    update public.daymark_projects x
    set name = btrim(save_project.name), client_name = nullif(btrim(save_project.client_name), ''),
        contact_name = nullif(btrim(save_project.contact_name), ''),
        contact_email = nullif(btrim(save_project.contact_email), ''),
        contact_phone = nullif(btrim(save_project.contact_phone), ''), start_date = save_project.start_date,
        due_date = save_project.due_date, status = coalesce(save_project.status, 'planning'),
        description = nullif(btrim(save_project.description), ''), links = nullif(hrefs, '{}'), lead_id = save_project.lead
    where x.id = old.id
    returning * into p;
    if p.status <> old.status then
      perform private.project_log(p.id, 'status_changed', (status_names ->> old.status) || ' → ' || (status_names ->> p.status));
    end if;
  end if;

  -- Members: new ones (or ones coming back) are added; ones left out are marked removed.
  update public.daymark_project_members m set removed_at = private.clock_now()
  where m.project_id = p.id and m.removed_at is null and not (m.person_id = any (people));
  insert into public.daymark_project_members (project_id, person_id)
  select p.id, x from unnest(fresh) x
  on conflict (project_id, person_id) do update set removed_at = null;
  perform private.project_log(p.id, 'member_added', x.display_name)
  from public.daymark_profiles x where x.id = any (fresh);

  -- An intern's new project waits for their supervisor or an admin.
  if save_project.id is null and not staff then
    for who in
      select x.id from public.daymark_profiles x where x.is_admin and x.active
      union
      select pl.supervisor_id from public.daymark_placements pl
      join public.daymark_profiles s on s.id = pl.supervisor_id and s.is_supervisor and s.active
      where pl.intern_id = me and pl.status in ('active', 'extended', 'target_reached')
    loop
      continue when who = me;
      -- Admins open their own Projects page; a supervisor-only person opens theirs.
      perform private.notify(who, 'request', 'Project to approve: ' || p.name,
        coalesce((select x.display_name from public.daymark_profiles x where x.id = me), ''),
        case when (select x.is_admin from public.daymark_profiles x where x.id = who) then '/admin/projects'
             else '/supervisor/projects' end);
    end loop;
  end if;

  perform private.audit('save_project', 'daymark_projects', p.id::text,
    case when old.id is not null then to_jsonb(old) end, to_jsonb(p) || jsonb_build_object('members', to_jsonb(people)));
  return p.id;
end;
$$;

create or replace function private.approve_project(id uuid, approve boolean, note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  p public.daymark_projects%rowtype := private.require_project(approve_project.id);
  said text := nullif(btrim(approve_project.note), '');
begin
  if not private.manages_tasks_of(p.created_by) or coalesce(p.created_by = me, false) then
    raise exception 'Only an admin or the creator''s supervisor can approve this project.' using errcode = '42501';
  end if;
  if p.approved_at is not null then
    raise exception 'This project isn''t waiting for approval.' using errcode = '22023';
  end if;
  if approve_project.approve is null then
    raise exception 'Approve it or decline it.' using errcode = '22023';
  end if;
  if char_length(said) > 500 then
    raise exception 'Keep the note to 500 characters.' using errcode = '22023';
  end if;

  if approve_project.approve then
    update public.daymark_projects x set approved_at = private.clock_now(), approved_by = me where x.id = p.id;
    perform private.project_log(p.id, 'project_approved', p.name);
    perform private.notify(p.created_by, 'request', 'Project approved: ' || p.name, coalesce(said, ''),
      '/clock/projects/view?id=' || p.id);
  else
    update public.daymark_projects x set archived_at = private.clock_now() where x.id = p.id;
    perform private.notify(p.created_by, 'request', 'Project declined: ' || p.name, coalesce(said, ''), '/clock/projects');
  end if;
  perform private.audit(case when approve_project.approve then 'approve_project' else 'decline_project' end,
    'daymark_projects', p.id::text, null, jsonb_build_object('note', said));
end;
$$;

create or replace function private.archive_project(id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  p public.daymark_projects%rowtype := private.require_project(archive_project.id);
begin
  if not (coalesce(me in (p.lead_id, p.created_by), false) or (private.is_staff() and private.project_visible(p.id))) then
    raise exception 'Only the project''s lead, its creator or staff can archive it.' using errcode = '42501';
  end if;
  update public.daymark_projects x set archived_at = private.clock_now() where x.id = p.id;
  perform private.audit('archive_project', 'daymark_projects', p.id::text, null, null);
end;
$$;

-- The lead, or staff who can see the project.
create or replace function private.require_project_planner(project uuid)
returns public.daymark_projects
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.daymark_projects%rowtype := private.require_project(require_project_planner.project);
begin
  if not (coalesce(p.lead_id = (select auth.uid()), false) or (private.is_staff() and private.project_visible(p.id))) then
    raise exception 'Only the project''s lead or staff can change its milestones.' using errcode = '42501';
  end if;
  return p;
end;
$$;

create or replace function private.save_milestone(id uuid, project uuid, name text, due_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.daymark_milestones%rowtype;
  p public.daymark_projects%rowtype;
begin
  if save_milestone.id is not null then
    select * into m from public.daymark_milestones x where x.id = save_milestone.id and x.archived_at is null;
    if not found then
      raise exception 'That milestone is gone.' using errcode = 'P0002';
    end if;
    if save_milestone.project is not null and save_milestone.project <> m.project_id then
      raise exception 'That milestone belongs to another project.' using errcode = '22023';
    end if;
  end if;
  p := private.require_project_planner(coalesce(m.project_id, save_milestone.project));
  if char_length(btrim(coalesce(save_milestone.name, ''))) not between 1 and 80 then
    raise exception 'Write a milestone name up to 80 characters.' using errcode = '22023';
  end if;

  if m.id is null then
    insert into public.daymark_milestones (project_id, name, due_date, position)
    select p.id, btrim(save_milestone.name), save_milestone.due_date, coalesce(max(x.position), 0) + 1
    from public.daymark_milestones x where x.project_id = p.id
    returning * into m;
    perform private.project_log(p.id, 'milestone_added', m.name);
  else
    update public.daymark_milestones x set name = btrim(save_milestone.name), due_date = save_milestone.due_date
    where x.id = m.id;
  end if;
  return m.id;
end;
$$;

create or replace function private.archive_milestone(id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.daymark_milestones%rowtype;
begin
  select * into m from public.daymark_milestones x where x.id = archive_milestone.id and x.archived_at is null;
  if not found then
    raise exception 'That milestone is gone.' using errcode = 'P0002';
  end if;
  perform private.require_project_planner(m.project_id);
  update public.daymark_milestones x set archived_at = private.clock_now() where x.id = m.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Project reads
-- ---------------------------------------------------------------------------
create or replace function private.my_projects()
returns table (id uuid, name text, client_name text, status text, start_date date, due_date date, lead_name text,
               waiting boolean, tasks_total int, tasks_done int, estimate_minutes int, spent_minutes int, overdue int,
               blocked int, in_review int, next_milestone text, next_milestone_due date)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.client_name, p.status, p.start_date, p.due_date, l.display_name, p.approved_at is null,
         c.total, c.done, c.estimate, c.spent, c.overdue, c.blocked, c.in_review, nm.name, nm.due_date
  from public.daymark_projects p
  left join public.daymark_profiles l on l.id = p.lead_id
  cross join lateral (
    select count(*)::int as total, (count(*) filter (where i.status = 'done'))::int as done,
           coalesce(sum(t.estimate_minutes), 0)::int as estimate, coalesce(sum(i.spent_minutes), 0)::int as spent,
           (count(*) filter (where i.status <> 'done' and i.due_date < private.darwin_today()))::int as overdue,
           (count(*) filter (where i.status <> 'done' and i.blocked_reason is not null))::int as blocked,
           (count(*) filter (where i.status = 'in_review'))::int as in_review
    from public.daymark_task_items i
    join public.daymark_tasks t on t.id = i.task_id and t.archived_at is null
    where t.project_id = p.id and private.task_item_live(i)) c
  left join lateral (
    select m.name, m.due_date from public.daymark_milestones m
    where m.project_id = p.id and m.archived_at is null and not private.milestone_done(m.id)
    order by m.due_date nulls last, m.position
    limit 1) nm on true
  where p.archived_at is null and private.project_visible(p.id)
  order by p.approved_at is null desc,
           case p.status when 'active' then 0 when 'planning' then 1 when 'on_hold' then 2 else 3 end,
           p.due_date nulls last, p.name, p.id;
$$;

create or replace function private.project_detail(id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.daymark_projects%rowtype := private.require_project(project_detail.id);
begin
  if not private.project_visible(p.id) then
    raise exception 'You''re not part of this project.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'project', to_jsonb(p) || jsonb_build_object(
      'lead_name', (select x.display_name from public.daymark_profiles x where x.id = p.lead_id),
      'created_by_name', (select x.display_name from public.daymark_profiles x where x.id = p.created_by)),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.display_name)
                                          order by x.display_name, x.id)
                         from public.daymark_project_members m
                         join public.daymark_profiles x on x.id = m.person_id
                         where m.project_id = p.id and m.removed_at is null), '[]'::jsonb),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'due_date', m.due_date,
                                                                 'tasks_total', k.total, 'tasks_done', k.done,
                                                                 'done', k.total > 0 and k.total = k.done)
                                             order by m.due_date nulls last, m.position)
                            from public.daymark_milestones m
                            cross join lateral private.milestone_counts(m.id) k
                            where m.project_id = p.id and m.archived_at is null), '[]'::jsonb));
end;
$$;

-- The argument is "project" here: PL/pgSQL can't have an argument and a result column both called id. The public
-- wrapper keeps the contract's name.
create or replace function private.project_activity(project uuid, before timestamptz default null)
returns table (id uuid, actor_name text, kind text, text text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.daymark_projects%rowtype := private.require_project(project_activity.project);
begin
  if not private.project_visible(p.id) then
    raise exception 'You''re not part of this project.' using errcode = '42501';
  end if;
  return query
    select a.id, a.actor_name, a.kind, a.text, a.created_at
    from public.daymark_project_activity a
    where a.project_id = p.id
      and a.created_at < coalesce(project_activity.before, 'infinity')
      and a.created_at > private.clock_now() - interval '90 days'
    order by a.created_at desc, a.id desc
    limit 30;
end;
$$;

create or replace function private.project_lookup(q text default null)
returns table (id uuid, name text, client_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.client_name
  from public.daymark_projects p
  where p.approved_at is not null and p.archived_at is null
    and (nullif(btrim(project_lookup.q), '') is null
         or strpos(lower(p.name), lower(btrim(project_lookup.q))) > 0
         or strpos(lower(coalesce(p.client_name, '')), lower(btrim(project_lookup.q))) > 0)
    and private.project_visible(p.id)
  order by p.name, p.id
  limit 20;
$$;

-- ---------------------------------------------------------------------------
-- 5. Tasks: save_task with a project and milestone, status and review activity
-- ---------------------------------------------------------------------------
-- Renamed and switched off rather than removed (the remote apply tool refuses removals).
alter function public.save_task(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[], uuid, int, text[])
  rename to save_task_d48;
revoke all on function public.save_task_d48(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[], uuid, int, text[])
  from public, anon, authenticated;
-- Renamed and switched off rather than removed (the remote apply tool refuses removals).
alter function private.save_task(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[], uuid, int, text[])
  rename to save_task_d48;
revoke all on function private.save_task_d48(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[], uuid, int, text[])
  from public, anon, authenticated;

create function private.save_task(id uuid, title text, description text, priority text, due_date date,
  due_time time, link text, assignees uuid[], repeat_days int[], repeat_until date, collaborators uuid[],
  reviewer uuid default null, estimate_minutes int default null, subtasks text[] default null,
  project uuid default null, milestone uuid default null)
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
  proj uuid;
  ms uuid;
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

  if save_task.id is not null then
    old := private.require_task_manager(save_task.id);
  end if;

  -- Project and milestone. On an edit, null keeps them; the zero uuid clears them. Only a change is checked, so an
  -- edit to a task whose project was later archived still saves.
  if save_task.project = '00000000-0000-0000-0000-000000000000' then
    proj := null;
    ms := null;
  elsif save_task.project is null and old.id is not null then
    proj := old.project_id;
    ms := coalesce(save_task.milestone, old.milestone_id);
  else
    proj := save_task.project;
    ms := save_task.milestone;
  end if;
  if proj is not null and proj is distinct from old.project_id
     and not exists (select 1 from public.daymark_projects p
                     where p.id = proj and p.approved_at is not null and p.archived_at is null
                       and private.project_visible(p.id)) then
    raise exception 'Pick a project you''re part of.' using errcode = '42501';
  end if;
  if ms is not null and (ms is distinct from old.milestone_id or proj is distinct from old.project_id)
     and not exists (select 1 from public.daymark_milestones m
                     where m.id = ms and m.project_id = proj and m.archived_at is null) then
    raise exception 'Pick a milestone of this project.' using errcode = '22023';
  end if;

  if save_task.id is null then
    insert into public.daymark_tasks (title, description, priority, due_date, due_time, link, repeat_days, repeat_until,
                                      created_by, created_at, reviewer_id, estimate_minutes, subtask_titles, project_id,
                                      milestone_id)
    values (btrim(save_task.title), nullif(btrim(save_task.description), ''), coalesce(save_task.priority, 'medium'),
            case when save_task.repeat_days is null then save_task.due_date end, save_task.due_time,
            nullif(btrim(save_task.link), ''), case when save_task.repeat_days is not null then days end,
            case when save_task.repeat_days is not null then save_task.repeat_until end, me, private.clock_now(),
            save_task.reviewer, save_task.estimate_minutes, nullif(checklist, '{}'), proj, ms)
    returning * into t;
  else
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
        subtask_titles = case when save_task.subtasks is null then x.subtask_titles else nullif(checklist, '{}') end,
        project_id = proj, milestone_id = ms
    where x.id = old.id
    returning * into t;
    if t.repeat_days is null then
      update public.daymark_task_items i set due_date = t.due_date
      where i.task_id = t.id and i.status <> 'done' and i.due_date is distinct from t.due_date;
    end if;
  end if;
  if t.project_id is not null and t.project_id is distinct from old.project_id then
    perform private.project_log(t.project_id, 'task_added', t.title);
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

-- As in 20261020010000_tasks_v2.sql, plus task_done (and milestone_done) activity.
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
  if set_task_status.status = 'done' and i.status <> 'done' then
    perform private.task_project_log(t, i.status, 'task_done');
  end if;
end;
$$;

-- As in 20261020010000_tasks_v2.sql, plus review_approved / changes_asked (and milestone_done) activity.
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
  perform private.task_project_log(t, case when review_task.approve then i.status else 'done' end,
    case when review_task.approve then 'review_approved' else 'changes_asked' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Task reads: project, milestone and labels after the current last column
-- ---------------------------------------------------------------------------
-- Renamed and switched off rather than removed (the remote apply tool refuses removals).
alter function public.my_tasks() rename to my_tasks_d48;
revoke all on function public.my_tasks_d48() from public, anon, authenticated;
-- Renamed and switched off rather than removed (the remote apply tool refuses removals).
alter function private.my_tasks() rename to my_tasks_d48;
revoke all on function private.my_tasks_d48() from public, anon, authenticated;
-- Renamed and switched off rather than removed (the remote apply tool refuses removals).
alter function public.staff_tasks(uuid) rename to staff_tasks_d48;
revoke all on function public.staff_tasks_d48(uuid) from public, anon, authenticated;
-- Renamed and switched off rather than removed (the remote apply tool refuses removals).
alter function private.staff_tasks(uuid) rename to staff_tasks_d48;
revoke all on function private.staff_tasks_d48(uuid) from public, anon, authenticated;

-- Live label names on a task, by name.
create or replace function private.task_label_names(task uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(select l.name from public.daymark_task_labels tl
               join public.daymark_labels l on l.id = tl.label_id and l.archived_at is null
               where tl.task_id = task_label_names.task and tl.removed_at is null
               order by l.name);
$$;

create function private.my_tasks()
returns table (item_id uuid, task_id uuid, title text, description text, priority text, due_date date, due_time time,
               link text, status text, done_at timestamptz, done_note text, created_by_name text, own boolean,
               working_with text[], repeat_days int[], reviewer_id uuid, reviewer_name text, estimate_minutes int,
               spent_minutes int, blocked_reason text, subtasks_total int, subtasks_done int, comments int,
               review_requested_at timestamptz, to_review boolean, project_id uuid, project_name text,
               milestone_id uuid, milestone_name text, labels text[])
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
         coalesce(t.reviewer_id = (select auth.uid()) and i.status = 'in_review', false),
         pr.id, pr.name, ms.id, ms.name, private.task_label_names(t.id)
  from public.daymark_task_items i
  join public.daymark_tasks t on t.id = i.task_id and t.archived_at is null
  left join public.daymark_profiles c on c.id = t.created_by
  left join public.daymark_profiles r on r.id = t.reviewer_id
  left join public.daymark_projects pr on pr.id = t.project_id and pr.archived_at is null
  left join public.daymark_milestones ms on ms.id = t.milestone_id and ms.archived_at is null and pr.id is not null
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
               comments int, review_requested_at timestamptz, project_id uuid, project_name text, milestone_id uuid,
               milestone_name text, labels text[])
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
         i.review_requested_at, pr.id, pr.name, ms.id, ms.name, private.task_label_names(t.id)
  from public.daymark_task_items i
  join public.daymark_tasks t on t.id = i.task_id and t.archived_at is null
  join public.daymark_profiles p on p.id = i.person_id
  left join public.daymark_profiles c on c.id = t.created_by
  left join public.daymark_profiles r on r.id = t.reviewer_id
  left join public.daymark_projects pr on pr.id = t.project_id and pr.archived_at is null
  left join public.daymark_milestones ms on ms.id = t.milestone_id and ms.archived_at is null and pr.id is not null
  where (staff_tasks.intern is null or i.person_id = staff_tasks.intern)
    and private.manages_tasks_of(i.person_id)
    and not (i.status = 'done' and i.done_at <= private.clock_now() - interval '30 days')
    and private.task_item_live(i)
  order by i.due_date nulls last, t.created_at, t.id, p.display_name;
$$;

-- ---------------------------------------------------------------------------
-- 7. Labels
-- ---------------------------------------------------------------------------
create or replace function private.save_label(id uuid, name text, colour text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.daymark_labels%rowtype;
begin
  if not private.is_staff() then
    raise exception 'Only staff can change labels.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(save_label.name, ''))) not between 1 and 30 then
    raise exception 'Write a label name up to 30 characters.' using errcode = '22023';
  end if;
  if save_label.colour is null
     or save_label.colour not in ('blue', 'teal', 'green', 'orange', 'red', 'purple', 'pink', 'grey') then
    raise exception 'Pick a colour: blue, teal, green, orange, red, purple, pink or grey.' using errcode = '22023';
  end if;
  begin
    if save_label.id is null then
      insert into public.daymark_labels (name, colour) values (btrim(save_label.name), save_label.colour)
      returning * into l;
    else
      update public.daymark_labels x set name = btrim(save_label.name), colour = save_label.colour
      where x.id = save_label.id and x.archived_at is null
      returning * into l;
      if not found then
        raise exception 'That label is gone.' using errcode = 'P0002';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'There''s already a label with that name.' using errcode = '22023';
  end;
  perform private.audit('save_label', 'daymark_labels', l.id::text, null, to_jsonb(l));
  return l.id;
end;
$$;

create or replace function private.archive_label(id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_staff() then
    raise exception 'Only staff can change labels.' using errcode = '42501';
  end if;
  update public.daymark_labels x set archived_at = private.clock_now()
  where x.id = archive_label.id and x.archived_at is null;
  if not found then
    raise exception 'That label is gone.' using errcode = 'P0002';
  end if;
  perform private.audit('archive_label', 'daymark_labels', archive_label.id::text, null, null);
end;
$$;

create or replace function private.labels()
returns table (id uuid, name text, colour text)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.name, l.colour from public.daymark_labels l
  where l.archived_at is null and (select auth.uid()) is not null
  order by l.name, l.id;
$$;

-- A task manager, or a current assignee (an intern's own task). Links are never deleted: one left out gets
-- removed_at, and putting it back clears it.
create or replace function private.set_task_labels(task uuid, labels uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.daymark_tasks%rowtype;
  picked uuid[] := array(select distinct x from unnest(coalesce(set_task_labels.labels, '{}')) x where x is not null);
begin
  select * into t from public.daymark_tasks x where x.id = set_task_labels.task and x.archived_at is null;
  if not found then
    raise exception 'That task is gone.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.daymark_task_assignees a
                 where a.task_id = t.id and a.person_id = (select auth.uid()) and a.removed_at is null) then
    perform private.require_task_manager(t.id);
  end if;
  if exists (select 1 from unnest(picked) x
             where not exists (select 1 from public.daymark_labels l where l.id = x and l.archived_at is null)) then
    raise exception 'Pick labels from the list.' using errcode = '22023';
  end if;
  update public.daymark_task_labels tl set removed_at = private.clock_now()
  where tl.task_id = t.id and tl.removed_at is null and not (tl.label_id = any (picked));
  insert into public.daymark_task_labels (task_id, label_id)
  select t.id, x from unnest(picked) x
  on conflict (task_id, label_id) do update set removed_at = null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Workload: the caller's interns (all active interns for an admin) for one Monday–Sunday week
-- ---------------------------------------------------------------------------
create or replace function private.task_workload(week_start date)
returns table (person_id uuid, person_name text, open_tasks int, estimate_due_minutes int, rostered_minutes int,
               overdue int, blocked int, in_review int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := private.darwin_today();
  mon date := coalesce(task_workload.week_start, private.darwin_today());
begin
  if not private.is_staff() then
    raise exception 'Only staff can see the workload.' using errcode = '42501';
  end if;
  mon := mon - (extract(isodow from mon)::int - 1);  -- any day snaps to its Monday
  return query
    select p.id, p.display_name,
           c.open_count, c.estimate,
           (select coalesce(sum(sd.planned_minutes), 0)::int
            from public.daymark_placements pl
            join public.daymark_scheduled_days sd on sd.placement_id = pl.id
            where pl.intern_id = p.id and sd.status = 'scheduled' and sd.work_date between mon and mon + 6),
           c.overdue, c.blocked, c.in_review
    from public.daymark_profiles p
    cross join lateral (
      select count(*)::int as open_count,
             coalesce(sum(t.estimate_minutes) filter (where i.due_date between mon and mon + 6), 0)::int as estimate,
             (count(*) filter (where i.due_date < today))::int as overdue,
             (count(*) filter (where i.blocked_reason is not null))::int as blocked,
             (count(*) filter (where i.status = 'in_review'))::int as in_review
      from public.daymark_task_items i
      join public.daymark_tasks t on t.id = i.task_id and t.archived_at is null
      where i.person_id = p.id and i.status <> 'done' and private.task_item_live(i)) c
    where p.is_intern and p.active and private.manages_tasks_of(p.id)
    order by p.display_name, p.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Wrappers and grants
-- ---------------------------------------------------------------------------
create or replace function public.save_project(id uuid, name text, client_name text, contact_name text,
  contact_email text, contact_phone text, start_date date, due_date date, status text, description text, links text[],
  lead uuid, members uuid[])
returns uuid language sql security invoker set search_path = ''
as $$ select private.save_project(id, name, client_name, contact_name, contact_email, contact_phone, start_date, due_date,
                                  status, description, links, lead, members); $$;
create or replace function public.approve_project(id uuid, approve boolean, note text default null)
returns void language sql security invoker set search_path = ''
as $$ select private.approve_project(id, approve, note); $$;
create or replace function public.archive_project(id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.archive_project(id); $$;
create or replace function public.save_milestone(id uuid, project uuid, name text, due_date date)
returns uuid language sql security invoker set search_path = ''
as $$ select private.save_milestone(id, project, name, due_date); $$;
create or replace function public.archive_milestone(id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.archive_milestone(id); $$;
create or replace function public.my_projects()
returns table (id uuid, name text, client_name text, status text, start_date date, due_date date, lead_name text,
               waiting boolean, tasks_total int, tasks_done int, estimate_minutes int, spent_minutes int, overdue int,
               blocked int, in_review int, next_milestone text, next_milestone_due date)
language sql stable security invoker set search_path = ''
as $$ select * from private.my_projects(); $$;
create or replace function public.project_detail(id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.project_detail(id); $$;
create or replace function public.project_activity(id uuid, before timestamptz default null)
returns table (id uuid, actor_name text, kind text, text text, created_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.project_activity(id, before); $$;
create or replace function public.project_lookup(q text default null)
returns table (id uuid, name text, client_name text)
language sql stable security invoker set search_path = ''
as $$ select * from private.project_lookup(q); $$;
create or replace function public.project_people(project uuid default null)
returns table (person_id uuid, display_name text)
language sql stable security invoker set search_path = ''
as $$ select * from private.project_people(project); $$;
create function public.save_task(id uuid, title text, description text, priority text, due_date date,
  due_time time, link text, assignees uuid[], repeat_days int[], repeat_until date, collaborators uuid[],
  reviewer uuid default null, estimate_minutes int default null, subtasks text[] default null,
  project uuid default null, milestone uuid default null)
returns uuid language sql security invoker set search_path = ''
as $$ select private.save_task(id, title, description, priority, due_date, due_time, link, assignees, repeat_days,
                               repeat_until, collaborators, reviewer, estimate_minutes, subtasks, project, milestone); $$;
create function public.my_tasks()
returns table (item_id uuid, task_id uuid, title text, description text, priority text, due_date date, due_time time,
               link text, status text, done_at timestamptz, done_note text, created_by_name text, own boolean,
               working_with text[], repeat_days int[], reviewer_id uuid, reviewer_name text, estimate_minutes int,
               spent_minutes int, blocked_reason text, subtasks_total int, subtasks_done int, comments int,
               review_requested_at timestamptz, to_review boolean, project_id uuid, project_name text,
               milestone_id uuid, milestone_name text, labels text[])
language sql stable security invoker set search_path = ''
as $$ select * from private.my_tasks(); $$;
create function public.staff_tasks(intern uuid default null)
returns table (item_id uuid, task_id uuid, person_id uuid, person_name text, title text, description text, priority text,
               due_date date, due_time time, link text, status text, done_at timestamptz, done_note text,
               created_by_name text, repeat_days int[], repeat_until date, reviewer_id uuid, reviewer_name text,
               estimate_minutes int, spent_minutes int, blocked_reason text, subtasks_total int, subtasks_done int,
               comments int, review_requested_at timestamptz, project_id uuid, project_name text, milestone_id uuid,
               milestone_name text, labels text[])
language sql stable security invoker set search_path = ''
as $$ select * from private.staff_tasks(intern); $$;
create or replace function public.save_label(id uuid, name text, colour text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.save_label(id, name, colour); $$;
create or replace function public.archive_label(id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.archive_label(id); $$;
create or replace function public.labels()
returns table (id uuid, name text, colour text)
language sql stable security invoker set search_path = ''
as $$ select * from private.labels(); $$;
create or replace function public.set_task_labels(task uuid, labels uuid[])
returns void language sql security invoker set search_path = ''
as $$ select private.set_task_labels(task, labels); $$;
create or replace function public.task_workload(week_start date)
returns table (person_id uuid, person_name text, open_tasks int, estimate_due_minutes int, rostered_minutes int,
               overdue int, blocked int, in_review int)
language sql stable security invoker set search_path = ''
as $$ select * from private.task_workload(week_start); $$;

-- Internal only.
revoke all on function private.project_log(uuid, text, text) from public, anon, authenticated;
revoke all on function private.task_project_log(public.daymark_tasks, text, text) from public, anon, authenticated;
-- Helpers the callers' functions run as the caller.
revoke all on function private.project_visible(uuid) from public, anon;
revoke all on function private.require_project(uuid) from public, anon;
revoke all on function private.require_project_planner(uuid) from public, anon;
revoke all on function private.milestone_counts(uuid) from public, anon;
revoke all on function private.milestone_done(uuid) from public, anon;
revoke all on function private.task_label_names(uuid) from public, anon;
grant execute on function private.project_visible(uuid) to authenticated;
grant execute on function private.require_project(uuid) to authenticated;
grant execute on function private.require_project_planner(uuid) to authenticated;
grant execute on function private.milestone_counts(uuid) to authenticated;
grant execute on function private.milestone_done(uuid) to authenticated;
grant execute on function private.task_label_names(uuid) to authenticated;

revoke all on function private.save_project(uuid, text, text, text, text, text, date, date, text, text, text[], uuid, uuid[])
  from public, anon;
revoke all on function private.approve_project(uuid, boolean, text) from public, anon;
revoke all on function private.archive_project(uuid) from public, anon;
revoke all on function private.save_milestone(uuid, uuid, text, date) from public, anon;
revoke all on function private.archive_milestone(uuid) from public, anon;
revoke all on function private.my_projects() from public, anon;
revoke all on function private.project_detail(uuid) from public, anon;
revoke all on function private.project_activity(uuid, timestamptz) from public, anon;
revoke all on function private.project_lookup(text) from public, anon;
revoke all on function private.project_people(uuid) from public, anon;
revoke all on function private.save_task(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[], uuid, int, text[],
  uuid, uuid) from public, anon;
revoke all on function private.set_task_status(uuid, text, text) from public, anon;
revoke all on function private.review_task(uuid, boolean, text) from public, anon;
revoke all on function private.my_tasks() from public, anon;
revoke all on function private.staff_tasks(uuid) from public, anon;
revoke all on function private.save_label(uuid, text, text) from public, anon;
revoke all on function private.archive_label(uuid) from public, anon;
revoke all on function private.labels() from public, anon;
revoke all on function private.set_task_labels(uuid, uuid[]) from public, anon;
revoke all on function private.task_workload(date) from public, anon;
grant execute on function private.save_project(uuid, text, text, text, text, text, date, date, text, text, text[], uuid, uuid[])
  to authenticated;
grant execute on function private.approve_project(uuid, boolean, text) to authenticated;
grant execute on function private.archive_project(uuid) to authenticated;
grant execute on function private.save_milestone(uuid, uuid, text, date) to authenticated;
grant execute on function private.archive_milestone(uuid) to authenticated;
grant execute on function private.my_projects() to authenticated;
grant execute on function private.project_detail(uuid) to authenticated;
grant execute on function private.project_activity(uuid, timestamptz) to authenticated;
grant execute on function private.project_lookup(text) to authenticated;
grant execute on function private.project_people(uuid) to authenticated;
grant execute on function private.save_task(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[], uuid, int, text[],
  uuid, uuid) to authenticated;
grant execute on function private.set_task_status(uuid, text, text) to authenticated;
grant execute on function private.review_task(uuid, boolean, text) to authenticated;
grant execute on function private.my_tasks() to authenticated;
grant execute on function private.staff_tasks(uuid) to authenticated;
grant execute on function private.save_label(uuid, text, text) to authenticated;
grant execute on function private.archive_label(uuid) to authenticated;
grant execute on function private.labels() to authenticated;
grant execute on function private.set_task_labels(uuid, uuid[]) to authenticated;
grant execute on function private.task_workload(date) to authenticated;

revoke all on function public.save_project(uuid, text, text, text, text, text, date, date, text, text, text[], uuid, uuid[])
  from public, anon;
revoke all on function public.approve_project(uuid, boolean, text) from public, anon;
revoke all on function public.archive_project(uuid) from public, anon;
revoke all on function public.save_milestone(uuid, uuid, text, date) from public, anon;
revoke all on function public.archive_milestone(uuid) from public, anon;
revoke all on function public.my_projects() from public, anon;
revoke all on function public.project_detail(uuid) from public, anon;
revoke all on function public.project_activity(uuid, timestamptz) from public, anon;
revoke all on function public.project_lookup(text) from public, anon;
revoke all on function public.project_people(uuid) from public, anon;
revoke all on function public.save_task(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[], uuid, int, text[],
  uuid, uuid) from public, anon;
revoke all on function public.my_tasks() from public, anon;
revoke all on function public.staff_tasks(uuid) from public, anon;
revoke all on function public.save_label(uuid, text, text) from public, anon;
revoke all on function public.archive_label(uuid) from public, anon;
revoke all on function public.labels() from public, anon;
revoke all on function public.set_task_labels(uuid, uuid[]) from public, anon;
revoke all on function public.task_workload(date) from public, anon;
grant execute on function public.save_project(uuid, text, text, text, text, text, date, date, text, text, text[], uuid, uuid[])
  to authenticated;
grant execute on function public.approve_project(uuid, boolean, text) to authenticated;
grant execute on function public.archive_project(uuid) to authenticated;
grant execute on function public.save_milestone(uuid, uuid, text, date) to authenticated;
grant execute on function public.archive_milestone(uuid) to authenticated;
grant execute on function public.my_projects() to authenticated;
grant execute on function public.project_detail(uuid) to authenticated;
grant execute on function public.project_activity(uuid, timestamptz) to authenticated;
grant execute on function public.project_lookup(text) to authenticated;
grant execute on function public.project_people(uuid) to authenticated;
grant execute on function public.save_task(uuid, text, text, text, date, time, text, uuid[], int[], date, uuid[], uuid, int, text[],
  uuid, uuid) to authenticated;
grant execute on function public.my_tasks() to authenticated;
grant execute on function public.staff_tasks(uuid) to authenticated;
grant execute on function public.save_label(uuid, text, text) to authenticated;
grant execute on function public.archive_label(uuid) to authenticated;
grant execute on function public.labels() to authenticated;
grant execute on function public.set_task_labels(uuid, uuid[]) to authenticated;
grant execute on function public.task_workload(date) to authenticated;

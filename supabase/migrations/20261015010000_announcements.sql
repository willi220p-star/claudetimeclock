-- Announcements with read receipts (Dilip, 12 Oct; D41).
-- An admin posts to everyone or to interns; a supervisor posts to their own interns. A must-acknowledge
-- notice stays pinned on the intern's Home until "I've read this"; staff see who read it and can remind
-- the rest. It never blocks clocking.

create table public.daymark_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  audience text not null check (audience in ('everyone', 'interns', 'my_interns')),
  must_ack boolean not null default false,
  created_by uuid not null references public.daymark_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index daymark_announcements_created_idx on public.daymark_announcements (created_at desc);

create table public.daymark_announcement_reads (
  announcement_id uuid not null references public.daymark_announcements (id) on delete cascade,
  person_id uuid not null references public.daymark_profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  acked_at timestamptz,
  primary key (announcement_id, person_id)
);

-- Everything goes through the functions below.
alter table public.daymark_announcements enable row level security;
alter table public.daymark_announcement_reads enable row level security;
revoke all on table public.daymark_announcements from public, anon, authenticated;
revoke all on table public.daymark_announcement_reads from public, anon, authenticated;
grant all on table public.daymark_announcements to service_role;
grant all on table public.daymark_announcement_reads to service_role;

-- Who an announcement is for: active people, never the poster.
create or replace function private.announcement_recipients(a public.daymark_announcements)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.daymark_profiles p
  where p.active and p.id <> a.created_by
    and (a.audience = 'everyone'
         or (a.audience = 'interns' and p.is_intern)
         or (a.audience = 'my_interns' and p.is_intern and exists (
               select 1 from public.daymark_placements pl
               where pl.intern_id = p.id and pl.supervisor_id = a.created_by
                 and pl.status in ('active', 'extended', 'target_reached'))));
$$;

create or replace function private.post_announcement(title text, body text, audience text, must_ack boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  admin boolean := private.is_admin();
  a public.daymark_announcements%rowtype;
  who uuid;
begin
  if not (admin or exists (select 1 from public.daymark_profiles p where p.id = me and p.is_supervisor and p.active)) then
    raise exception 'Only a supervisor or an admin can post an announcement.' using errcode = '42501';
  end if;
  if post_announcement.audience not in ('everyone', 'interns', 'my_interns') then
    raise exception 'Pick who it is for.' using errcode = '22023';
  end if;
  if post_announcement.audience <> 'my_interns' and not admin then
    raise exception 'A supervisor posts to their own interns.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(post_announcement.title, ''))) not between 1 and 80 then
    raise exception 'Write a title up to 80 characters.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(post_announcement.body, ''))) not between 1 and 2000 then
    raise exception 'Write the announcement, up to 2,000 characters.' using errcode = '22023';
  end if;

  insert into public.daymark_announcements (title, body, audience, must_ack, created_by, created_at)
  values (btrim(post_announcement.title), btrim(post_announcement.body), post_announcement.audience,
          coalesce(post_announcement.must_ack, false), me, private.clock_now())
  returning * into a;
  for who in select private.announcement_recipients(a) loop
    perform private.notify(who, 'announcement', a.title, left(a.body, 200), '/notifications');
  end loop;
  perform private.audit('post_announcement', 'daymark_announcements', a.id::text, null,
    jsonb_build_object('title', a.title, 'audience', a.audience, 'must_ack', a.must_ack));
  return a.id;
end;
$$;

-- The signed-in person's announcements from the last 30 days, newest first.
create or replace function private.my_announcements()
returns table (id uuid, title text, body text, must_ack boolean, created_at timestamptz, author text,
               read_at timestamptz, acked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.title, a.body, a.must_ack, a.created_at, p.display_name, r.read_at, r.acked_at
  from public.daymark_announcements a
  join public.daymark_profiles p on p.id = a.created_by
  left join public.daymark_announcement_reads r on r.announcement_id = a.id and r.person_id = (select auth.uid())
  where a.archived_at is null and a.created_at > private.clock_now() - interval '30 days'
    and (select auth.uid()) in (select private.announcement_recipients(a))
  order by a.created_at desc;
$$;

create or replace function private.mark_announcement(id uuid, ack boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  a public.daymark_announcements%rowtype;
begin
  select * into a from public.daymark_announcements x where x.id = mark_announcement.id;
  if not found or not exists (select 1 from private.announcement_recipients(a) r where r = me) then
    raise exception 'That announcement isn''t for you.' using errcode = '42501';
  end if;
  insert into public.daymark_announcement_reads (announcement_id, person_id, read_at, acked_at)
  values (a.id, me, private.clock_now(), case when mark_announcement.ack then private.clock_now() end)
  on conflict (announcement_id, person_id) do update
    set acked_at = coalesce(daymark_announcement_reads.acked_at, excluded.acked_at);
end;
$$;

-- The poster's (an admin: everyone's) announcements with counts.
create or replace function private.posted_announcements()
returns table (id uuid, title text, body text, audience text, must_ack boolean, created_at timestamptz,
               author text, recipients integer, read integer, acked integer)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.title, a.body, a.audience, a.must_ack, a.created_at, p.display_name,
         (select count(*)::int from private.announcement_recipients(a)),
         (select count(*)::int from public.daymark_announcement_reads r where r.announcement_id = a.id),
         (select count(*)::int from public.daymark_announcement_reads r where r.announcement_id = a.id and r.acked_at is not null)
  from public.daymark_announcements a
  join public.daymark_profiles p on p.id = a.created_by
  where a.archived_at is null and (a.created_by = (select auth.uid()) or private.is_admin())
  order by a.created_at desc;
$$;

create or replace function private.require_poster(id uuid)
returns public.daymark_announcements
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.daymark_announcements%rowtype;
begin
  select * into a from public.daymark_announcements x where x.id = require_poster.id;
  if not found then
    raise exception 'That announcement is gone.' using errcode = 'P0002';
  end if;
  if a.created_by <> (select auth.uid()) and not private.is_admin() then
    raise exception 'Only its author or an admin can see that.' using errcode = '42501';
  end if;
  return a;
end;
$$;

-- Who has read it: one row per recipient.
create or replace function private.announcement_reads(id uuid)
returns table (person_id uuid, display_name text, read_at timestamptz, acked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, r.read_at, r.acked_at
  from private.announcement_recipients(private.require_poster(announcement_reads.id)) who
  join public.daymark_profiles p on p.id = who
  left join public.daymark_announcement_reads r on r.announcement_id = announcement_reads.id and r.person_id = p.id
  order by r.read_at nulls first, p.display_name;
$$;

-- Remind everyone who hasn't read it (or, when it must be acknowledged, hasn't acknowledged it).
create or replace function private.nudge_announcement(id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.daymark_announcements%rowtype := private.require_poster(nudge_announcement.id);
  who uuid;
  n integer := 0;
begin
  for who in
    select r from private.announcement_recipients(a) r
    where not exists (select 1 from public.daymark_announcement_reads x
                      where x.announcement_id = a.id and x.person_id = r
                        and (not a.must_ack or x.acked_at is not null))
  loop
    perform private.notify(who, 'announcement', 'Reminder: ' || a.title, left(a.body, 200), '/notifications');
    n := n + 1;
  end loop;
  perform private.audit('nudge_announcement', 'daymark_announcements', a.id::text, null, jsonb_build_object('people', n));
  return n;
end;
$$;

create or replace function private.archive_announcement(id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.daymark_announcements%rowtype := private.require_poster(archive_announcement.id);
begin
  update public.daymark_announcements x set archived_at = private.clock_now() where x.id = a.id;
  perform private.audit('archive_announcement', 'daymark_announcements', a.id::text, null, null);
end;
$$;

-- Announcements are pushed like the other kinds, ticked by default.
create or replace function private.push_kind_options()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['reminder_shift', 'reminder_break', 'reminder_clock_out', 'reminder_tomorrow', 'digest', 'announcement',
               'schedule', 'times', 'request', 'attendance', 'work_based', 'escalated']::text[];
$$;
alter table public.daymark_settings
  alter column push_kinds set default array['reminder_shift', 'reminder_break', 'reminder_clock_out', 'reminder_tomorrow',
    'digest', 'announcement', 'schedule', 'times', 'request', 'attendance', 'work_based', 'escalated']::text[];
update public.daymark_settings set push_kinds = array(select distinct k from unnest(push_kinds || array['announcement']) k order by 1)
where id = 1;

-- Wrappers and grants.
create or replace function public.post_announcement(title text, body text, audience text, must_ack boolean)
returns uuid language sql security invoker set search_path = ''
as $$ select private.post_announcement(title, body, audience, must_ack); $$;
create or replace function public.my_announcements()
returns table (id uuid, title text, body text, must_ack boolean, created_at timestamptz, author text,
               read_at timestamptz, acked_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.my_announcements(); $$;
create or replace function public.mark_announcement(id uuid, ack boolean)
returns void language sql security invoker set search_path = ''
as $$ select private.mark_announcement(id, ack); $$;
create or replace function public.posted_announcements()
returns table (id uuid, title text, body text, audience text, must_ack boolean, created_at timestamptz,
               author text, recipients integer, read integer, acked integer)
language sql stable security invoker set search_path = ''
as $$ select * from private.posted_announcements(); $$;
create or replace function public.announcement_reads(id uuid)
returns table (person_id uuid, display_name text, read_at timestamptz, acked_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.announcement_reads(id); $$;
create or replace function public.nudge_announcement(id uuid)
returns integer language sql security invoker set search_path = ''
as $$ select private.nudge_announcement(id); $$;
create or replace function public.archive_announcement(id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.archive_announcement(id); $$;

revoke all on function private.announcement_recipients(public.daymark_announcements) from public, anon;
revoke all on function private.post_announcement(text, text, text, boolean) from public, anon;
revoke all on function private.my_announcements() from public, anon;
revoke all on function private.mark_announcement(uuid, boolean) from public, anon;
revoke all on function private.posted_announcements() from public, anon;
revoke all on function private.require_poster(uuid) from public, anon;
revoke all on function private.announcement_reads(uuid) from public, anon;
revoke all on function private.nudge_announcement(uuid) from public, anon;
revoke all on function private.archive_announcement(uuid) from public, anon;
revoke all on function public.post_announcement(text, text, text, boolean) from public, anon;
revoke all on function public.my_announcements() from public, anon;
revoke all on function public.mark_announcement(uuid, boolean) from public, anon;
revoke all on function public.posted_announcements() from public, anon;
revoke all on function public.announcement_reads(uuid) from public, anon;
revoke all on function public.nudge_announcement(uuid) from public, anon;
revoke all on function public.archive_announcement(uuid) from public, anon;
grant execute on function private.announcement_recipients(public.daymark_announcements) to authenticated;
grant execute on function private.post_announcement(text, text, text, boolean) to authenticated;
grant execute on function private.my_announcements() to authenticated;
grant execute on function private.mark_announcement(uuid, boolean) to authenticated;
grant execute on function private.posted_announcements() to authenticated;
grant execute on function private.require_poster(uuid) to authenticated;
grant execute on function private.announcement_reads(uuid) to authenticated;
grant execute on function private.nudge_announcement(uuid) to authenticated;
grant execute on function private.archive_announcement(uuid) to authenticated;
grant execute on function public.post_announcement(text, text, text, boolean) to authenticated;
grant execute on function public.my_announcements() to authenticated;
grant execute on function public.mark_announcement(uuid, boolean) to authenticated;
grant execute on function public.posted_announcements() to authenticated;
grant execute on function public.announcement_reads(uuid) to authenticated;
grant execute on function public.nudge_announcement(uuid) to authenticated;
grant execute on function public.archive_announcement(uuid) to authenticated;

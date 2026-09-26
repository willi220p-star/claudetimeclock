-- 26 Sep requests (Dilip): add an intern with their placement in one step, a Records tab where
-- admins preview, edit and delete any record (supervisors view only, through RLS), deleting a whole
-- person, storage clean-up, and "Intern report" in place of "uni report".
-- The audit log and consent records are never deleted here: they are the legal trail (Dilip, 26 Sep).

-- ---------------------------------------------------------------------------
-- Add an intern and their placement (with its roster) in one transaction.
-- ---------------------------------------------------------------------------
create or replace function private.create_intern(
  display_name text,
  email text,
  password text,
  is_supervisor boolean,
  is_admin boolean,
  placement jsonb,
  allow_extra boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  person jsonb := private.create_person(display_name, email, password, true, is_supervisor, is_admin);
  placement_id uuid := private.save_placement(
    (coalesce(placement, '{}'::jsonb) - 'id') || jsonb_build_object('intern_id', person ->> 'id'), allow_extra);
begin
  return person || jsonb_build_object('placement_id', placement_id);
end;
$$;

create or replace function public.create_intern(
  display_name text,
  email text,
  password text,
  is_supervisor boolean,
  is_admin boolean,
  placement jsonb,
  allow_extra boolean default false
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_intern(display_name, email, password, is_supervisor, is_admin, placement, allow_extra); $$;

-- ---------------------------------------------------------------------------
-- Consent records outlive a deleted person: the row stays, its person_id goes to null.
-- ---------------------------------------------------------------------------
alter table public.daymark_consent_records alter column person_id drop not null;
alter table public.daymark_consent_records drop constraint daymark_consent_records_person_id_fkey;
alter table public.daymark_consent_records add constraint daymark_consent_records_person_id_fkey
  foreign key (person_id) references public.daymark_profiles (id) on delete set null;

create or replace function private.append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('daymark.purging', true) = 'on' then
    return old;
  end if;
  -- delete_person: only the link to the deleted person may be cleared.
  if tg_op = 'UPDATE' and current_setting('daymark.erasing', true) = 'on'
     and to_jsonb(new) ->> 'person_id' is null
     and to_jsonb(new) - 'person_id' = to_jsonb(old) - 'person_id' then
    return new;
  end if;
  raise exception 'These records cannot be changed.' using errcode = 'P0001';
end;
$$;

-- A cleared selfie leaves the punch (and its path, the device-evidence rule needs it); only the file goes.
alter table public.daymark_punches add column photo_deleted_at timestamptz;

-- ---------------------------------------------------------------------------
-- Admins see every record (supervisors keep their RLS scope) and may delete stored files.
-- ---------------------------------------------------------------------------
create policy "Admins read all notifications" on public.daymark_notifications
  for select to authenticated using ((select private.is_admin()));
create policy "Admins read all clock challenges" on public.daymark_clock_challenges
  for select to authenticated using ((select private.is_admin()));

create policy "Admins delete stored files" on storage.objects
  for delete to authenticated
  using (bucket_id in ('daymark-photos', 'daymark-leave-docs') and (select private.is_admin()));

-- Files (bucket + path) in a person's folder, for the browser to remove after the rows go.
create or replace function private.person_files(person uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name) order by o.name), '[]'::jsonb)
  from storage.objects o
  where o.bucket_id in ('daymark-photos', 'daymark-leave-docs') and o.name like person::text || '/%';
$$;

-- ---------------------------------------------------------------------------
-- Delete a person: login, profile and everything that cascades from it (placements, punches,
-- requests, schedule, notifications). The audit log and consent records stay.
-- ---------------------------------------------------------------------------
create or replace function private.delete_person(person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.daymark_profiles%rowtype;
  files jsonb;
begin
  perform private.require_admin();
  select * into p from public.daymark_profiles x where x.id = person;
  if not found then
    raise exception 'That person is already gone.' using errcode = 'P0002';
  end if;
  if person = (select auth.uid()) then
    raise exception 'You can''t delete yourself. Ask another admin.' using errcode = '22023';
  end if;
  if exists (select 1 from public.daymark_placements x where x.supervisor_id = person) then
    raise exception 'This person supervises a placement. Give it another supervisor first.' using errcode = '22023';
  end if;

  files := private.person_files(person);
  perform private.audit('delete_person', 'daymark_profiles', person::text,
    to_jsonb(p) || jsonb_build_object('placements',
      (select count(*) from public.daymark_placements x where x.intern_id = person)),
    null);
  perform set_config('daymark.erasing', 'on', true);
  delete from auth.users u where u.id = person;           -- cascades to the profile and its rows
  delete from public.daymark_profiles x where x.id = person;  -- a profile with no login
  perform set_config('daymark.erasing', 'off', true);
  return jsonb_build_object('files', files);
end;
$$;

-- ---------------------------------------------------------------------------
-- Delete one record. Derived hours are rebuilt; files the row pointed to are returned for the
-- browser to remove. Audit log, consent records, notices, settings, sites and the derived
-- shift/day tables can't be deleted here.
-- ---------------------------------------------------------------------------
create or replace function private.delete_record(tbl text, row_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row jsonb;
  files jsonb := '[]'::jsonb;
  pid uuid;
  day date;
begin
  perform private.require_admin();

  if tbl = 'daymark_profiles' then
    return private.delete_person(row_id::uuid);
  end if;
  if tbl = 'daymark_closure_days' then
    perform private.remove_closure_day(row_id::uuid);  -- puts the scheduled days back, audited
    return jsonb_build_object('files', files);
  end if;
  if tbl not in ('daymark_placements', 'daymark_punches', 'daymark_requests', 'daymark_scheduled_days',
                 'daymark_checkins', 'daymark_work_logs', 'daymark_notifications', 'daymark_exit_feedback',
                 'daymark_clock_challenges', 'daymark_schedule_history', 'daymark_cohorts') then
    raise exception 'Records in this table can''t be deleted.' using errcode = '42501';
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.id::text = $1', tbl) into before_row using row_id;
  if before_row is null then
    raise exception 'That record is already gone.' using errcode = 'P0002';
  end if;

  if tbl = 'daymark_placements' then
    select coalesce(jsonb_agg(jsonb_build_object('bucket', 'daymark-photos', 'path', x.photo_path)), '[]')
      into files from public.daymark_punches x where x.placement_id = row_id::uuid and x.photo_path is not null;
    files := files || (select coalesce(jsonb_agg(jsonb_build_object('bucket', 'daymark-leave-docs', 'path', r.attachment_path)), '[]')
                       from public.daymark_requests r where r.placement_id = row_id::uuid and r.attachment_path is not null);
  elsif tbl = 'daymark_punches' then
    if exists (select 1 from public.daymark_punches f where f.replaces_punch_id = row_id::uuid) then
      raise exception 'A punch fix replaces this punch. Delete the fix first.' using errcode = '22023';
    end if;
    if before_row ->> 'photo_path' is not null then
      files := jsonb_build_array(jsonb_build_object('bucket', 'daymark-photos', 'path', before_row ->> 'photo_path'));
    end if;
    pid := (before_row ->> 'placement_id')::uuid;
    day := ((before_row ->> 'occurred_at')::timestamptz at time zone 'Australia/Darwin')::date;
  elsif tbl = 'daymark_requests' then
    if before_row ->> 'attachment_path' is not null then
      files := jsonb_build_array(jsonb_build_object('bucket', 'daymark-leave-docs', 'path', before_row ->> 'attachment_path'));
    end if;
    if before_row ->> 'type' = 'overtime' then
      pid := (before_row ->> 'placement_id')::uuid;
      day := (before_row -> 'dates' ->> 0)::date;
    end if;
  elsif tbl = 'daymark_scheduled_days' then
    pid := (before_row ->> 'placement_id')::uuid;
    day := (before_row ->> 'work_date')::date;
  end if;

  execute format('delete from public.%I t where t.id::text = $1', tbl) using row_id;
  if pid is not null and day is not null then
    perform private.rebuild_shifts(pid, day);
  end if;
  perform private.audit('delete_record', tbl, row_id, before_row, null);
  return jsonb_build_object('files', files);
end;
$$;

-- ---------------------------------------------------------------------------
-- Edit one record: only the listed columns, one audited row. Table triggers still apply
-- (capacity on scheduled days, shift rebuild on punches and scheduled days).
-- ---------------------------------------------------------------------------
create or replace function private.record_columns(tbl text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case tbl
    when 'daymark_profiles' then array['display_name']
    when 'daymark_placements' then array['university', 'course', 'uni_coordinator_name', 'uni_coordinator_email']
    when 'daymark_punches' then array['occurred_at']
    when 'daymark_requests' then array['reason', 'supervisor_note', 'admin_note']
    when 'daymark_scheduled_days' then array['start_time', 'end_time']
    when 'daymark_checkins' then array['reliability', 'quality', 'communication', 'comment']
    when 'daymark_work_logs' then array['summary']
    when 'daymark_notifications' then array['title', 'body']
    when 'daymark_cohorts' then array['name', 'starts_on', 'notes']
    when 'daymark_closure_days' then array['name']
    else array[]::text[]
  end;
$$;

create or replace function private.update_record(tbl text, row_id text, patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed text[] := private.record_columns(tbl);
  cols text[];
  required text[] := array['display_name', 'university', 'course', 'reason', 'summary', 'title', 'name', 'occurred_at',
                           'start_time', 'end_time', 'reliability', 'quality', 'communication'];
  k text;
  sets text;
  before_row jsonb;
  after_row jsonb;
begin
  perform private.require_admin();
  if cardinality(allowed) = 0 then
    raise exception 'Records in this table can''t be edited here.' using errcode = '42501';
  end if;
  if jsonb_typeof(patch) is distinct from 'object' then
    raise exception 'Nothing to save.' using errcode = '22023';
  end if;
  select array_agg(x) into cols from jsonb_object_keys(patch) x;
  if cols is null then
    raise exception 'Nothing to save.' using errcode = '22023';
  end if;
  foreach k in array cols loop
    if not k = any (allowed) then
      raise exception 'That field can''t be edited here.' using errcode = '42501';
    end if;
    if k = any (required) and nullif(btrim(patch ->> k), '') is null then
      raise exception 'Fill in every required field.' using errcode = '22023';
    end if;
    if char_length(coalesce(patch ->> k, '')) > 2000 then
      raise exception 'Keep each field under 2,000 characters.' using errcode = '22023';
    end if;
  end loop;
  if tbl = 'daymark_profiles' and char_length(btrim(patch ->> 'display_name')) > 80 then
    raise exception 'Enter a name up to 80 characters.' using errcode = '22023';
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.id::text = $1', tbl) into before_row using row_id;
  if before_row is null then
    raise exception 'That record is already gone.' using errcode = 'P0002';
  end if;

  select string_agg(format('%1$I = x.%1$I', c), ', ') into sets from unnest(cols) c;
  if before_row ? 'updated_at' then
    sets := sets || ', updated_at = private.clock_now()';
  end if;
  execute format(
    'update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I, $2) x where t.id::text = $1 returning to_jsonb(t)',
    tbl, sets) into after_row using row_id, patch;

  perform private.audit('update_record', tbl, row_id,
    (select jsonb_object_agg(c, before_row -> c) from unnest(cols) c),
    (select jsonb_object_agg(c, after_row -> c) from unnest(cols) c));
  return after_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: usage per bucket, and clean-up of rows and files nobody needs any more.
-- ---------------------------------------------------------------------------
create or replace function private.storage_usage()
returns table (bucket text, files bigint, bytes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select b.id::text, count(o.id), coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint
    from storage.buckets b
    left join storage.objects o on o.bucket_id = b.id
    where b.id in ('daymark-photos', 'daymark-leave-docs')
    group by b.id
    order by b.id;
end;
$$;

-- Files nobody points at, older than a day (a selfie is uploaded just before its punch).
create or replace function private.orphan_files()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name)), '[]'::jsonb)
  from storage.objects o
  where o.created_at < now() - interval '1 day'
    and ((o.bucket_id = 'daymark-photos'
          and not exists (select 1 from public.daymark_punches p where p.photo_path = o.name and p.photo_deleted_at is null))
      or (o.bucket_id = 'daymark-leave-docs'
          and not exists (select 1 from public.daymark_requests r where r.attachment_path = o.name)));
$$;

create or replace function private.cleanup_preview(older_than_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz := private.clock_now() - make_interval(days => greatest(coalesce(older_than_days, 0), 0));
begin
  perform private.require_admin();
  return jsonb_build_object(
    'notifications', (select count(*) from public.daymark_notifications n where n.read_at is not null and n.read_at < cutoff),
    'challenges', (select count(*) from public.daymark_clock_challenges c where c.expires_at < cutoff),
    'selfies', (select count(*) from public.daymark_punches p
                where p.photo_path is not null and p.photo_deleted_at is null and p.occurred_at < cutoff),
    'selfie_bytes', (select coalesce(sum((o.metadata ->> 'size')::bigint), 0) from storage.objects o
                     join public.daymark_punches p on p.photo_path = o.name
                     where o.bucket_id = 'daymark-photos' and p.photo_deleted_at is null and p.occurred_at < cutoff),
    'orphans', jsonb_array_length(private.orphan_files())
  );
end;
$$;

create or replace function private.cleanup_run(kind text, older_than_days integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz := private.clock_now() - make_interval(days => greatest(coalesce(older_than_days, 0), 0));
  n integer := 0;
  files jsonb := '[]'::jsonb;
begin
  perform private.require_admin();
  if kind = 'notifications' then
    delete from public.daymark_notifications x where x.read_at is not null and x.read_at < cutoff;
    get diagnostics n = row_count;
  elsif kind = 'challenges' then
    delete from public.daymark_clock_challenges x where x.expires_at < cutoff;
    get diagnostics n = row_count;
  elsif kind = 'selfies' then
    with cleared as (
      update public.daymark_punches x set photo_deleted_at = private.clock_now()
      where x.photo_path is not null and x.photo_deleted_at is null and x.occurred_at < cutoff
      returning x.photo_path
    )
    select count(*), coalesce(jsonb_agg(jsonb_build_object('bucket', 'daymark-photos', 'path', c.photo_path)), '[]')
      into n, files from cleared c;
  elsif kind = 'orphans' then
    files := private.orphan_files();
    n := jsonb_array_length(files);
  else
    raise exception 'Unknown clean-up.' using errcode = '22023';
  end if;
  perform private.audit('cleanup_' || kind, 'storage', null, null,
    jsonb_build_object('rows', n, 'older_than_days', older_than_days));
  return jsonb_build_object('rows', n, 'files', files);
end;
$$;

-- ---------------------------------------------------------------------------
-- "Intern report" wording (Dilip, 26 Sep). Function names stay.
-- ---------------------------------------------------------------------------
create or replace function private.send_retention_reminder(pl public.daymark_placements, mark integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := 'retention_' || mark;
  v_link text := '/clock/me?placement=' || pl.id;
  delete_on date := private.retention_date(pl.ended_on);
  intern_name text := (select display_name from public.daymark_profiles where id = pl.intern_id);
begin
  if not exists (select 1 from public.daymark_notifications n
                 where n.person_id = pl.intern_id and n.kind = v_kind and n.link = v_link) then
    perform private.notify(pl.intern_id, v_kind,
      case mark when 0 then 'Your placement has ended' else 'Download your records before ' || private.fmt_day(delete_on) end,
      'You can view and download your records until ' || private.fmt_day(delete_on)
        || '. After that everything about your placement is permanently deleted.',
      v_link);
  end if;
  if not exists (select 1 from public.daymark_notifications n
                 where n.person_id = pl.supervisor_id and n.kind = v_kind
                   and n.link = '/supervisor/intern?id=' || pl.intern_id) then
    perform private.notify(pl.supervisor_id, v_kind,
      intern_name || '''s records are deleted on ' || private.fmt_day(delete_on),
      'Download the intern report and anything else you need before then.',
      '/supervisor/intern?id=' || pl.intern_id);
  end if;
end;
$$;

create or replace function private.approve_uni_report(placement uuid, note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype := private.require_placement_manager(placement);
begin
  if pl.status not in ('target_reached', 'completed', 'withdrawn') then
    raise exception 'Approve the report once the hours are final: after the target is reached or the placement ends.'
      using errcode = '22023';
  end if;
  update public.daymark_placements
  set report_approved_by = (select auth.uid()), report_approved_at = private.clock_now(),
      report_approval_note = nullif(btrim(note), '')
  where id = placement;
  perform private.audit('approve_uni_report', 'daymark_placements', placement::text, null,
    jsonb_build_object('note', note));
  perform private.notify(pl.intern_id, 'report', 'Your intern report is ready',
    'Your supervisor approved your intern report. Download it under Me.', '/clock/me');
end;
$$;

-- ---------------------------------------------------------------------------
-- Thin public wrappers and grants.
-- ---------------------------------------------------------------------------
create or replace function public.delete_record(tbl text, row_id text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.delete_record(tbl, row_id); $$;

create or replace function public.update_record(tbl text, row_id text, patch jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.update_record(tbl, row_id, patch); $$;

create or replace function public.storage_usage()
returns table (bucket text, files bigint, bytes bigint) language sql stable security invoker set search_path = ''
as $$ select * from private.storage_usage(); $$;

create or replace function public.cleanup_preview(older_than_days integer)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.cleanup_preview(older_than_days); $$;

create or replace function public.cleanup_run(kind text, older_than_days integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.cleanup_run(kind, older_than_days); $$;

revoke all on function private.create_intern(text, text, text, boolean, boolean, jsonb, boolean) from public, anon;
revoke all on function private.person_files(uuid) from public, anon, authenticated;
revoke all on function private.orphan_files() from public, anon, authenticated;
revoke all on function private.delete_person(uuid) from public, anon;
revoke all on function private.delete_record(text, text) from public, anon;
revoke all on function private.record_columns(text) from public, anon;
revoke all on function private.update_record(text, text, jsonb) from public, anon;
revoke all on function private.storage_usage() from public, anon;
revoke all on function private.cleanup_preview(integer) from public, anon;
revoke all on function private.cleanup_run(text, integer) from public, anon;
revoke all on function public.create_intern(text, text, text, boolean, boolean, jsonb, boolean) from public, anon;
revoke all on function public.delete_record(text, text) from public, anon;
revoke all on function public.update_record(text, text, jsonb) from public, anon;
revoke all on function public.storage_usage() from public, anon;
revoke all on function public.cleanup_preview(integer) from public, anon;
revoke all on function public.cleanup_run(text, integer) from public, anon;

grant execute on function private.create_intern(text, text, text, boolean, boolean, jsonb, boolean) to authenticated;
grant execute on function private.delete_person(uuid) to authenticated;
grant execute on function private.delete_record(text, text) to authenticated;
grant execute on function private.record_columns(text) to authenticated;
grant execute on function private.update_record(text, text, jsonb) to authenticated;
grant execute on function private.storage_usage() to authenticated;
grant execute on function private.cleanup_preview(integer) to authenticated;
grant execute on function private.cleanup_run(text, integer) to authenticated;
grant execute on function public.create_intern(text, text, text, boolean, boolean, jsonb, boolean) to authenticated;
grant execute on function public.delete_record(text, text) to authenticated;
grant execute on function public.update_record(text, text, jsonb) to authenticated;
grant execute on function public.storage_usage() to authenticated;
grant execute on function public.cleanup_preview(integer) to authenticated;
grant execute on function public.cleanup_run(text, integer) to authenticated;

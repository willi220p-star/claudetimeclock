-- Phase 7: the admin's people directory and audit log search (§6, §11.3, §14).

-- Every person with their sign-in email, roles, flags, last sign-in and live placement.
-- §14: never a password, hash or token column.
create or replace function private.people_directory()
returns table (
  id uuid,
  display_name text,
  email text,
  is_intern boolean,
  is_supervisor boolean,
  is_admin boolean,
  active boolean,
  must_change_password boolean,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  placement_id uuid,
  placement_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select p.id, p.display_name, u.email::text, p.is_intern, p.is_supervisor, p.is_admin, p.active,
         p.must_change_password, u.last_sign_in_at, p.created_at, lp.id, lp.status
  from public.daymark_profiles p
  left join auth.users u on u.id = p.id
  left join lateral (
    select x.id, x.status from public.daymark_placements x
    where x.intern_id = p.id and x.status in ('active', 'extended', 'target_reached')
    order by x.created_at desc
    limit 1
  ) lp on true
  order by lower(p.display_name), p.id;
end;
$$;

-- Newest first (by id, the order entries were written), keyset paginated: pass the previous
-- page's next_before_id as before_id. from_ts is inclusive, to_ts exclusive.
-- Returns {rows: [{id, at, actor_id, actor_name, action, table_name, row_id, before, after}], next_before_id}.
-- ponytail: filters by action/table scan the id index backwards; add (action, id) indexes if the log
-- grows past a few hundred thousand rows.
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
    select a.id, a.at, a.actor_id, pr.display_name as actor_name, a.action, a.table_name, a.row_id, a.before, a.after
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

create or replace function public.people_directory()
returns table (
  id uuid, display_name text, email text, is_intern boolean, is_supervisor boolean, is_admin boolean,
  active boolean, must_change_password boolean, last_sign_in_at timestamptz, created_at timestamptz,
  placement_id uuid, placement_status text
)
language sql stable security invoker set search_path = ''
as $$ select * from private.people_directory(); $$;

create or replace function public.audit_search(
  action text default null,
  table_name text default null,
  actor uuid default null,
  from_ts timestamptz default null,
  to_ts timestamptz default null,
  before_id bigint default null,
  page_size integer default 50
)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.audit_search(action, table_name, actor, from_ts, to_ts, before_id, page_size); $$;

revoke all on function private.people_directory() from public, anon;
revoke all on function private.audit_search(text, text, uuid, timestamptz, timestamptz, bigint, integer) from public, anon;
revoke all on function public.people_directory() from public, anon;
revoke all on function public.audit_search(text, text, uuid, timestamptz, timestamptz, bigint, integer) from public, anon;
grant execute on function private.people_directory() to authenticated;
grant execute on function private.audit_search(text, text, uuid, timestamptz, timestamptz, bigint, integer) to authenticated;
grant execute on function public.people_directory() to authenticated;
grant execute on function public.audit_search(text, text, uuid, timestamptz, timestamptz, bigint, integer) to authenticated;

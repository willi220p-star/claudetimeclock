-- Local end-to-end tests drive the business clock through database-level settings, because
-- PostgREST sessions are not the postgres session user. Both settings must be set with
-- `alter database … set` on a local stack; production never sets them, and the nightly guard
-- below tells the admin if either ever appears (security review loophole 18).

create or replace function private.clock_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when nullif(current_setting('daymark.test_now', true), '') is not null
         and (session_user = 'postgres' or current_setting('daymark.e2e_clock', true) = 'on')
      then current_setting('daymark.test_now', true)::timestamptz
    else now()
  end;
$$;

-- Returns true (and warns every admin once a day) when a fake clock is configured.
create or replace function private.job_clock_guard()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  fake boolean := current_setting('daymark.e2e_clock', true) = 'on'
                  or nullif(current_setting('daymark.test_now', true), '') is not null;
  admin_id uuid;
begin
  if fake then
    for admin_id in select id from public.daymark_profiles where is_admin and active loop
      if not exists (select 1 from public.daymark_notifications n
                     where n.person_id = admin_id and n.kind = 'clock_guard' and n.created_at > now() - interval '20 hours') then
        insert into public.daymark_notifications (person_id, kind, title, body, link)
        values (admin_id, 'clock_guard', 'The test clock is switched on',
                'The database has a test clock setting, so hours may use the wrong time. Remove daymark.e2e_clock and daymark.test_now.', null);
      end if;
    end loop;
  end if;
  return fake;
end;
$$;

revoke all on function private.job_clock_guard() from public, anon, authenticated;

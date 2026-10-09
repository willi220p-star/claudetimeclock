-- Who has reminders on (Dilip, 9 Oct; D40). Staff see On/Off and the device type for the people they manage:
-- an admin for everyone, a supervisor for their own interns. The phone's keys never leave the table.
create or replace function private.reminder_status()
returns table (person_id uuid, device text, last_ok_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.is_admin() or exists (select 1 from public.daymark_profiles p
                                        where p.id = (select auth.uid()) and p.is_supervisor and p.active)) then
    raise exception 'Only staff can see this.' using errcode = '42501';
  end if;
  return query
    select s.person_id,
           (array_agg(case when s.user_agent ilike '%iphone%' or s.user_agent ilike '%ipad%' then 'iPhone'
                           when s.user_agent ilike '%android%' then 'Android'
                           else 'Browser' end order by s.last_ok_at desc nulls last, s.created_at desc))[1],
           max(s.last_ok_at)
    from public.daymark_push_subscriptions s
    where private.is_admin() or private.is_supervisor_of(s.person_id)
    group by s.person_id;
end;
$$;

create or replace function public.reminder_status()
returns table (person_id uuid, device text, last_ok_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.reminder_status(); $$;

revoke all on function private.reminder_status() from public, anon;
revoke all on function public.reminder_status() from public, anon;
grant execute on function private.reminder_status() to authenticated;
grant execute on function public.reminder_status() to authenticated;

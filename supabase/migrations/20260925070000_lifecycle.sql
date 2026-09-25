-- Phase 8: placement lifecycle (R5.11), uni report approval (§13), exit feedback, retention
-- reminders (R5.11.7) and who is due for deletion (§8.12). The purge itself is in a later migration.

create table public.daymark_exit_feedback (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null unique references public.daymark_placements (id) on delete cascade,
  answers jsonb not null,
  submitted_at timestamptz not null default now()
);

alter table public.daymark_exit_feedback enable row level security;
create policy "Interns read their own feedback; admins read all" on public.daymark_exit_feedback
  for select to authenticated
  using ((select private.is_admin()) or exists (
    select 1 from public.daymark_placements p where p.id = placement_id and p.intern_id = (select auth.uid())
  ));
revoke all on table public.daymark_exit_feedback from public, anon, authenticated;
grant select on table public.daymark_exit_feedback to authenticated;
grant all on table public.daymark_exit_feedback to service_role;

-- Supervisor of this placement's intern, or an admin.
create or replace function private.require_placement_manager(placement uuid)
returns public.daymark_placements
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype;
begin
  select * into pl from public.daymark_placements where id = placement;
  if not found then
    raise exception 'That placement doesn''t exist.' using errcode = '22023';
  end if;
  if not (private.is_admin() or (pl.supervisor_id = (select auth.uid()) and exists (
            select 1 from public.daymark_profiles s where s.id = pl.supervisor_id and s.is_supervisor and s.active))) then
    raise exception 'Only the intern''s supervisor or an admin can do that.' using errcode = '42501';
  end if;
  return pl;
end;
$$;

create or replace function private.retention_date(ended_on date)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select ended_on + (select s.retention_days from public.daymark_settings s where s.id = 1);
$$;

-- R5.11.7 day 0 / 14 / 25 reminders to the intern and supervisor, each sent once.
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
      'Download the uni report and anything else you need before then.',
      '/supervisor/intern?id=' || pl.intern_id);
  end if;
end;
$$;

create or replace function private.end_placement(placement uuid, new_status text, note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype := private.require_placement_manager(placement);
  before_row jsonb := to_jsonb(pl);
  today date := private.darwin_today();
begin
  if pl.status not in ('active', 'extended', 'target_reached') then
    raise exception 'This placement has already ended.' using errcode = '22023';
  end if;

  update public.daymark_placements set status = new_status, ended_on = today where id = placement
  returning * into pl;
  update public.daymark_scheduled_days s set status = 'cancelled', updated_at = private.clock_now()
  where s.placement_id = placement and s.work_date > today and s.status in ('scheduled', 'leave');

  perform private.audit(case new_status when 'completed' then 'confirm_completion' else 'withdraw_placement' end,
    'daymark_placements', placement::text, before_row, to_jsonb(pl) || jsonb_build_object('note', note));
  perform private.send_retention_reminder(pl, 0);
end;
$$;

-- R5.11.2
create or replace function private.confirm_completion(placement uuid, note text)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.end_placement(placement, 'completed', nullif(btrim(note), ''));
$$;

-- R5.11.4
create or replace function private.withdraw_placement(placement uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(reason, '')), '') is null then
    raise exception 'Give a reason for the withdrawal.' using errcode = '22023';
  end if;
  perform private.end_placement(placement, 'withdrawn', btrim(reason));
end;
$$;

-- R5.11.3 extend: status extended, days for the added period from the current pattern.
create or replace function private.extend_placement(placement uuid, new_end date, note text, allow_extra boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype := private.require_placement_manager(placement);
  before_row jsonb := to_jsonb(pl);
  old_end date := pl.planned_end_date;
begin
  if pl.status not in ('active', 'extended', 'target_reached') then
    raise exception 'This placement has already ended.' using errcode = '22023';
  end if;
  if new_end is null or new_end <= old_end then
    raise exception 'Pick a new end date after %.', private.fmt_day(old_end) using errcode = '22023';
  end if;
  if allow_extra and not private.is_admin() then
    raise exception 'Only an admin can approve an extra spot.' using errcode = '42501';
  end if;

  update public.daymark_placements set planned_end_date = new_end, status = 'extended' where id = placement
  returning * into pl;
  perform private.regenerate(placement, greatest(old_end + 1, private.darwin_today()), allow_extra);
  perform private.audit('extend_placement', 'daymark_placements', placement::text, before_row,
    to_jsonb(pl) || jsonb_build_object('note', note));
  perform private.notify(pl.intern_id, 'extended', 'Your placement is extended',
    'Your planned end date is now ' || private.fmt_day(new_end) || '. New days are on your schedule.', '/clock/schedule');
end;
$$;

-- §13 The supervisor or admin approves the uni report once hours are final.
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
  perform private.notify(pl.intern_id, 'report', 'Your uni report is ready',
    'Your supervisor approved your hours report. Download it under Me.', '/clock/me');
end;
$$;

-- §13 Exit feedback, once, while the intern is read-only.
create or replace function private.submit_exit_feedback(answers jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  pl uuid;
begin
  select p.id into pl from public.daymark_placements p
  where p.intern_id = me and p.status in ('completed', 'withdrawn')
    and not exists (select 1 from public.daymark_placements x
                    where x.intern_id = me and x.status in ('active', 'extended', 'target_reached'))
  order by p.ended_on desc
  limit 1;
  if pl is null then
    raise exception 'Feedback opens when your placement ends.' using errcode = '22023';
  end if;

  if jsonb_typeof(answers -> 'overall') <> 'number' or (answers ->> 'overall')::numeric not in (1, 2, 3, 4, 5)
     or jsonb_typeof(answers -> 'support') <> 'number' or (answers ->> 'support')::numeric not in (1, 2, 3, 4, 5)
     or jsonb_typeof(answers -> 'recommend') <> 'boolean'
     or char_length(btrim(coalesce(answers ->> 'learned', ''))) not between 1 and 1000
     or char_length(coalesce(answers ->> 'change', '')) > 1000 then
    raise exception 'Answer each question: ratings from 1 to 5, what you learned, and yes or no.' using errcode = '22023';
  end if;

  begin
    insert into public.daymark_exit_feedback (placement_id, answers, submitted_at)
    values (pl, jsonb_build_object(
      'overall', (answers ->> 'overall')::integer, 'learned', btrim(answers ->> 'learned'),
      'support', (answers ->> 'support')::integer, 'change', btrim(coalesce(answers ->> 'change', '')),
      'recommend', (answers ->> 'recommend')::boolean), private.clock_now());
  exception when unique_violation then
    raise exception 'You''ve already sent your feedback. Thank you!' using errcode = '23505';
  end;
end;
$$;

-- R5.11.7 nightly: reminders at day 0 (if missed), 14 and 25 after ended_on.
create or replace function private.job_retention_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.daymark_placements%rowtype;
  mark integer;
  n integer := 0;
  today date := private.darwin_today();
begin
  for pl in
    select p.* from public.daymark_placements p
    where p.status in ('completed', 'withdrawn') and p.ended_on is not null
      and today < private.retention_date(p.ended_on)
  loop
    foreach mark in array array[0, 14, 25] loop
      if today - pl.ended_on >= mark then
        perform private.send_retention_reminder(pl, mark);
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end;
$$;

-- §8.12 Interns whose every placement has ended at least retention_days ago.
create or replace function private.due_for_deletion()
returns table (intern_id uuid, last_ended_on date)
language sql
stable
security definer
set search_path = ''
as $$
  select p.intern_id, max(p.ended_on)
  from public.daymark_placements p
  group by p.intern_id
  having bool_and(p.status in ('completed', 'withdrawn') and p.ended_on is not null)
     and private.retention_date(max(p.ended_on)) <= private.darwin_today();
$$;

create or replace function public.extend_placement(placement uuid, new_end date, note text default null, allow_extra boolean default false)
returns void language sql security invoker set search_path = ''
as $$ select private.extend_placement(placement, new_end, note, allow_extra); $$;

create or replace function public.confirm_completion(placement uuid, note text default null)
returns void language sql security invoker set search_path = ''
as $$ select private.confirm_completion(placement, note); $$;

create or replace function public.withdraw_placement(placement uuid, reason text)
returns void language sql security invoker set search_path = ''
as $$ select private.withdraw_placement(placement, reason); $$;

create or replace function public.approve_uni_report(placement uuid, note text default null)
returns void language sql security invoker set search_path = ''
as $$ select private.approve_uni_report(placement, note); $$;

create or replace function public.submit_exit_feedback(answers jsonb)
returns void language sql security invoker set search_path = ''
as $$ select private.submit_exit_feedback(answers); $$;

revoke all on function private.require_placement_manager(uuid) from public, anon;
revoke all on function private.retention_date(date) from public, anon;
revoke all on function private.send_retention_reminder(public.daymark_placements, integer) from public, anon, authenticated;
revoke all on function private.end_placement(uuid, text, text) from public, anon, authenticated;
revoke all on function private.confirm_completion(uuid, text) from public, anon;
revoke all on function private.withdraw_placement(uuid, text) from public, anon;
revoke all on function private.extend_placement(uuid, date, text, boolean) from public, anon;
revoke all on function private.approve_uni_report(uuid, text) from public, anon;
revoke all on function private.submit_exit_feedback(jsonb) from public, anon;
revoke all on function private.job_retention_reminders() from public, anon, authenticated;
revoke all on function private.due_for_deletion() from public, anon, authenticated;
revoke all on function public.extend_placement(uuid, date, text, boolean) from public, anon;
revoke all on function public.confirm_completion(uuid, text) from public, anon;
revoke all on function public.withdraw_placement(uuid, text) from public, anon;
revoke all on function public.approve_uni_report(uuid, text) from public, anon;
revoke all on function public.submit_exit_feedback(jsonb) from public, anon;

grant execute on function private.require_placement_manager(uuid) to authenticated;
grant execute on function private.retention_date(date) to authenticated;
grant execute on function private.confirm_completion(uuid, text) to authenticated;
grant execute on function private.withdraw_placement(uuid, text) to authenticated;
grant execute on function private.extend_placement(uuid, date, text, boolean) to authenticated;
grant execute on function private.approve_uni_report(uuid, text) to authenticated;
grant execute on function private.submit_exit_feedback(jsonb) to authenticated;
grant execute on function private.due_for_deletion() to service_role;
grant execute on function public.extend_placement(uuid, date, text, boolean) to authenticated;
grant execute on function public.confirm_completion(uuid, text) to authenticated;
grant execute on function public.withdraw_placement(uuid, text) to authenticated;
grant execute on function public.approve_uni_report(uuid, text) to authenticated;
grant execute on function public.submit_exit_feedback(jsonb) to authenticated;

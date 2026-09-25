-- Phase 2: CSV import with a dry run, all or nothing (§11.3 Admin — Import, A6).
-- Columns: display_name,email,university,course,start_date,planned_end_date,target_hours,
--          supervisor_email,cohort,pattern   (pattern: "Mon 09:00-17:00; Wed 09:00-17:00")

create or replace function private.parse_pattern_text(pattern text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  part text;
  m text[];
  days jsonb := '[]';
  names text[] := array['mon', 'tue', 'wed', 'thu', 'fri'];
begin
  for part in select btrim(x) from regexp_split_to_table(coalesce(pattern, ''), ';') x loop
    continue when part = '';
    m := regexp_match(lower(part), '^([a-z]{3})[a-z]*\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$');
    if m is null or array_position(names, m[1]) is null then
      raise exception 'Write the pattern like "Mon 09:00-17:00; Wed 09:00-17:00" (weekdays only).' using errcode = '22023';
    end if;
    days := days || jsonb_build_object('weekday', array_position(names, m[1]), 'start', m[2], 'end', m[3]);
  end loop;
  return days;
end;
$$;

create or replace function private.import_placements(rows jsonb, temp_password text, dry_run boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  i integer := 0;
  results jsonb := '[]';
  failed boolean := false;
  person jsonb;
  sup uuid;
  cohort uuid;
  hours numeric;
begin
  perform private.require_admin();
  perform private.check_password(temp_password);
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) = 0 then
    raise exception 'The file has no rows to import.' using errcode = '22023';
  end if;
  if jsonb_array_length(rows) > 200 then
    raise exception 'Import at most 200 rows at a time.' using errcode = '22023';
  end if;

  begin
    for r in select * from jsonb_array_elements(rows) loop
      begin
        select p.id into sup from public.daymark_profiles p
        join auth.users u on u.id = p.id
        where lower(u.email) = lower(btrim(r ->> 'supervisor_email')) and p.is_supervisor and p.active;
        if sup is null then
          raise exception 'No active supervisor uses %.', coalesce(nullif(btrim(r ->> 'supervisor_email'), ''), 'that email')
            using errcode = '22023';
        end if;

        hours := nullif(btrim(r ->> 'target_hours'), '')::numeric;
        if hours is null or hours * 60 <> round(hours * 60) then
          raise exception 'Target hours must be a number of whole minutes, like 120 or 80.5.' using errcode = '22023';
        end if;

        cohort := null;
        if nullif(btrim(r ->> 'cohort'), '') is not null then
          select c.id into cohort from public.daymark_cohorts c where lower(c.name) = lower(btrim(r ->> 'cohort'));
          if cohort is null then
            insert into public.daymark_cohorts (name) values (btrim(r ->> 'cohort')) returning id into cohort;
          end if;
        end if;

        person := private.create_person(r ->> 'display_name', r ->> 'email', temp_password, true, false, false);
        perform private.save_placement(jsonb_build_object(
          'intern_id', person ->> 'id', 'supervisor_id', sup, 'cohort_id', cohort,
          'university', r ->> 'university', 'course', r ->> 'course',
          'start_date', r ->> 'start_date', 'planned_end_date', r ->> 'planned_end_date',
          'target_minutes', (hours * 60)::integer,
          'pattern', private.parse_pattern_text(r ->> 'pattern')
        ), false);
        results := results || jsonb_build_object('row', i + 1, 'email', r ->> 'email', 'ok', true);
      exception when others then
        failed := true;
        results := results || jsonb_build_object('row', i + 1, 'email', r ->> 'email', 'ok', false,
          'error', case when sqlstate in ('22007', '22008') then 'Use dates like 2026-10-12.'
                        when sqlstate = '22P02' then 'A number or date in this row is not valid.'
                        else sqlerrm end);
      end;
      i := i + 1;
    end loop;

    if dry_run or failed then
      raise exception using errcode = 'DGK01';   -- undo everything above, keep the verdicts
    end if;
  exception when sqlstate 'DGK01' then
    null;
  end;

  if not dry_run and not failed then
    perform private.audit('import_placements', 'daymark_placements', null, null,
      jsonb_build_object('rows', i));   -- never the password
  end if;
  return jsonb_build_object('ok', not failed, 'dry_run', dry_run,
    'imported', case when dry_run or failed then 0 else i end, 'results', results);
end;
$$;

create or replace function public.import_placements(rows jsonb, temp_password text, dry_run boolean default true)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.import_placements(rows, temp_password, dry_run); $$;

revoke all on function private.parse_pattern_text(text) from public, anon;
revoke all on function private.import_placements(jsonb, text, boolean) from public, anon;
revoke all on function public.import_placements(jsonb, text, boolean) from public, anon;
grant execute on function private.parse_pattern_text(text) to authenticated;
grant execute on function private.import_placements(jsonb, text, boolean) to authenticated;
grant execute on function public.import_placements(jsonb, text, boolean) to authenticated;

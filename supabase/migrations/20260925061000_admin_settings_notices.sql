-- Phase 7: admin settings (§10) and publishing a new collection notice (security review §2.4).

-- Partial update of the settings singleton: only the keys sent change, each validated.
-- Returns the whole settings row.
create or replace function private.update_settings(changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row public.daymark_settings%rowtype;
  r public.daymark_settings%rowtype;
  k text;
  v jsonb;
  lim record;
  anchor date;
begin
  perform private.require_admin();
  if jsonb_typeof(changes) is distinct from 'object' or changes = '{}' then
    raise exception 'Change at least one setting.' using errcode = '22023';
  end if;
  select * into old_row from public.daymark_settings s where s.id = 1 for update;

  for k, v in select e.key, e.value from jsonb_each(changes) e loop
    if k = 'fortnight_anchor' then                                   -- R5.7 fortnights start on a Monday
      anchor := null;
      if jsonb_typeof(v) = 'string' then
        begin
          anchor := (v #>> '{}')::date;
        exception when others then
          anchor := null;
        end;
      end if;
      if anchor is null or extract(isodow from anchor) <> 1 then
        raise exception 'The fortnight anchor must be a Monday.' using errcode = '22023';
      end if;
    elsif k = 'notice_version' then
      if jsonb_typeof(v) is distinct from 'string'
         or not exists (select 1 from public.daymark_notices n where n.version = v #>> '{}') then
        raise exception 'That notice version doesn''t exist. Publish it first.' using errcode = '22023';
      end if;
    elsif k in ('break_threshold_minutes', 'break_minutes') then
      -- ponytail: planned_minutes (R5.2.4) is a generated column with 300/30 built in, so changing
      -- the break rule here would make every long day look short. Make planned_minutes read the
      -- settings (a trigger instead of a generated column) before opening these up.
      raise exception 'The break rule (30 minutes off days over 5 hours) is fixed by the schedule rules.'
        using errcode = '22023';
    else
      select * into lim from (values
        ('grace_minutes', 0, 60, 'the grace period', 'minutes'),
        ('max_day_minutes', 600, 720, 'the longest counted day', 'minutes'),   -- ≥ the R5.2.1 day limit
        ('escalation_hours', 1, 336, 'escalation', 'hours'),
        ('retention_days', 1, 365, 'the retention period', 'days'),
        ('notice_hours', 0, 168, 'the request notice', 'hours'),
        ('punch_fix_days', 1, 31, 'the punch fix window', 'days'),
        ('sick_backdate_days', 0, 14, 'sick leave backdating', 'days'),
        ('max_accuracy_m', 20, 500, 'the GPS accuracy limit', 'metres'),
        ('punch_fix_min_reason', 1, 500, 'the shortest punch fix reason', 'characters'),
        ('punch_fix_max_per_fortnight', 1, 20, 'punch fixes per fortnight', 'fixes'),
        ('cert_retention_days', 1, 365, 'medical certificate retention', 'days'),
        ('idle_signout_minutes', 5, 480, 'the idle sign-out', 'minutes')
      ) x(key, lo, hi, label, unit) where x.key = k;
      if not found then
        raise exception 'There''s no setting called "%".', k using errcode = '22023';
      end if;
      if jsonb_typeof(v) is distinct from 'number' then
        raise exception 'Set % to a whole number from % to % %.', lim.label, lim.lo, lim.hi, lim.unit using errcode = '22023';
      end if;
      if v::numeric <> trunc(v::numeric) or v::numeric not between lim.lo and lim.hi then
        raise exception 'Set % to a whole number from % to % %.', lim.label, lim.lo, lim.hi, lim.unit using errcode = '22023';
      end if;
    end if;
  end loop;

  r := jsonb_populate_record(old_row, changes);
  if r.cert_retention_days > r.retention_days then
    raise exception 'Medical certificates can''t be kept longer than the other records (% days).', r.retention_days
      using errcode = '22023';
  end if;

  -- Every key is on the allow-list above, and %I quotes it.
  execute 'update public.daymark_settings s set '
    || (select string_agg(format('%I = x.%I', key, key), ', ') from jsonb_object_keys(changes) key)
    || ', updated_at = $2 from jsonb_populate_record(null::public.daymark_settings, $1) x where s.id = 1 returning s.*'
  into r using changes, private.clock_now();

  perform private.audit('update_settings', 'daymark_settings', '1',
    (select jsonb_object_agg(key, to_jsonb(old_row) -> key) from jsonb_object_keys(changes) key),
    (select jsonb_object_agg(key, to_jsonb(r) -> key) from jsonb_object_keys(changes) key));
  return to_jsonb(r);
end;
$$;

-- A new notice version becomes current at once, so every person must acknowledge it again
-- before clocking (private.has_consent reads settings.notice_version). Active interns are told.
create or replace function private.publish_notice(version text, title text, body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version text := btrim(coalesce(publish_notice.version, ''));
  v_title text := btrim(coalesce(publish_notice.title, ''));
  v_body text := btrim(coalesce(publish_notice.body, ''));
  old_version text;
  n public.daymark_notices%rowtype;
  notified integer;
begin
  perform private.require_admin();
  if v_version !~ '^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$' then
    raise exception 'Use a version like 1.1: letters, numbers, dots and dashes, up to 20 characters.' using errcode = '22023';
  end if;
  if char_length(v_title) not between 1 and 120 then
    raise exception 'Give the notice a title up to 120 characters.' using errcode = '22023';
  end if;
  if char_length(v_body) not between 50 and 20000 then
    raise exception 'Write the full notice, from 50 to 20,000 characters.' using errcode = '22023';
  end if;

  select s.notice_version into old_version from public.daymark_settings s where s.id = 1 for update;
  begin
    insert into public.daymark_notices (version, title, body, published_at)
    values (v_version, v_title, v_body, private.clock_now())
    returning * into n;
  exception when unique_violation then
    raise exception 'Version % already exists. Use a new version number.', v_version using errcode = '23505';
  end;
  update public.daymark_settings s set notice_version = n.version, updated_at = private.clock_now() where s.id = 1;

  perform private.notify(p.id, 'notice', 'We''ve updated how DGK Clock handles your information',
    'Please read it before your next clock-in.', '/clock')
  from public.daymark_profiles p
  where p.is_intern and p.active;
  get diagnostics notified = row_count;

  perform private.audit('publish_notice', 'daymark_notices', n.version,
    jsonb_build_object('notice_version', old_version),
    jsonb_build_object('notice_version', n.version, 'title', n.title, 'sha256', n.sha256));
  return jsonb_build_object('version', n.version, 'title', n.title, 'sha256', n.sha256,
                            'published_at', n.published_at, 'notified', notified);
end;
$$;

create or replace function public.update_settings(changes jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.update_settings(changes); $$;

create or replace function public.publish_notice(version text, title text, body text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.publish_notice(version, title, body); $$;

revoke all on function private.update_settings(jsonb) from public, anon;
revoke all on function private.publish_notice(text, text, text) from public, anon;
revoke all on function public.update_settings(jsonb) from public, anon;
revoke all on function public.publish_notice(text, text, text) from public, anon;
grant execute on function private.update_settings(jsonb) to authenticated;
grant execute on function private.publish_notice(text, text, text) to authenticated;
grant execute on function public.update_settings(jsonb) to authenticated;
grant execute on function public.publish_notice(text, text, text) to authenticated;

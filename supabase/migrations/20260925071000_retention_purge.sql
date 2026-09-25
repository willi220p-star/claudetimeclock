-- Phase 8: permanent deletion 30 days after the placement ends (ADR 0003, §8.12, R5.11.6) and
-- medical certificate files 7 days after the leave decision (security review rule 20).
-- Storage objects and the Auth user are removed by the retention-purge Edge Function; the
-- database rows go here, in one transaction, in FK-safe order.

create extension if not exists pg_net;

-- Rows first; the audit row keeps only a hash of the id, the counts and the date.
create or replace function private.purge_intern(intern uuid, objects_deleted integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  placements uuid[];
  requests uuid[];
  counts jsonb := '{}';
  n integer;
begin
  if not exists (select 1 from private.due_for_deletion() d where d.intern_id = intern) then
    raise exception 'This intern is not due for deletion.' using errcode = '22023';
  end if;
  if exists (select 1 from public.daymark_placements p where p.supervisor_id = intern) then
    raise exception 'This person still supervises a placement. Reassign it before deleting.' using errcode = '22023';
  end if;

  perform set_config('daymark.purging', 'on', true);
  select coalesce(array_agg(id), '{}') into placements from public.daymark_placements where intern_id = intern;
  select coalesce(array_agg(id), '{}') into requests from public.daymark_requests where placement_id = any (placements);

  delete from public.daymark_notifications where person_id = intern;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('notifications', n);
  delete from public.daymark_exit_feedback where placement_id = any (placements);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('exit_feedback', n);
  delete from public.daymark_checkins where placement_id = any (placements);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('checkins', n);
  delete from public.daymark_work_logs where placement_id = any (placements);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('work_logs', n);
  update public.daymark_pattern_versions set request_id = null where request_id = any (requests);
  update public.daymark_scheduled_days set origin_request_id = null where origin_request_id = any (requests);
  update public.daymark_schedule_history set request_id = null where request_id = any (requests);
  delete from public.daymark_requests where id = any (requests);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('requests', n);
  delete from public.daymark_day_results where placement_id = any (placements);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('day_results', n);
  delete from public.daymark_shifts where placement_id = any (placements);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('shifts', n);
  delete from public.daymark_punches where user_id = intern;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('punches', n);
  delete from public.daymark_clock_challenges where person_id = intern;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('challenges', n);
  delete from public.daymark_schedule_history h using public.daymark_scheduled_days d
  where h.scheduled_day_id = d.id and d.placement_id = any (placements);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('schedule_history', n);
  delete from public.daymark_scheduled_days where placement_id = any (placements);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('scheduled_days', n);
  delete from public.daymark_pattern_days x using public.daymark_pattern_versions v
  where x.pattern_version_id = v.id and v.placement_id = any (placements);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('pattern_days', n);
  delete from public.daymark_pattern_versions where placement_id = any (placements);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('pattern_versions', n);
  delete from public.daymark_consent_records where person_id = intern;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('consent_records', n);
  delete from public.daymark_placements where id = any (placements);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('placements', n);
  -- Audit rows about this person carry personal data (names, emails): remove them too.
  delete from public.daymark_audit_log
  where actor_id = intern or row_id = intern::text
     or row_id = any (select x::text from unnest(placements) x) or row_id = any (select x::text from unnest(requests) x);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('audit_rows', n);
  delete from public.daymark_profiles where id = intern;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('profiles', n);
  perform set_config('daymark.purging', 'off', true);

  counts := counts || jsonb_build_object('storage_objects', coalesce(objects_deleted, 0));
  insert into public.daymark_audit_log (actor_id, action, table_name, row_id, before, after, at)
  values (null, 'retention_purge', 'daymark_profiles', encode(extensions.digest(intern::text, 'sha256'), 'hex'), null,
          counts || jsonb_build_object('purged_on', private.darwin_today()), private.clock_now());
  return counts;
end;
$$;

-- Leave certificates: 7 days after the decision (or cancellation), the file goes; the fact stays.
create or replace function private.retention_certificates_due()
returns table (request_id uuid, attachment_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.attachment_path
  from public.daymark_requests r
  where r.attachment_path is not null
    and r.status in ('approved', 'declined', 'cancelled')
    and coalesce(r.admin_decided_at, r.supervisor_decided_at, r.updated_at)
        + make_interval(days => (select s.cert_retention_days from public.daymark_settings s where s.id = 1))
        <= private.clock_now();
$$;

create or replace function private.retention_certificate_removed(request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.daymark_requests set attachment_path = null where id = request_id and attachment_path is not null;
  perform private.audit('certificate_deleted', 'daymark_requests', request_id::text, null, '{"file": "deleted"}');
end;
$$;

-- pg_cron → pg_net → Edge Function, with the URL and shared secret from Vault. Until Dilip adds the
-- Vault secrets `project_url` and `cron_secret` (release checklist), the job does nothing.
create or replace function private.call_retention_purge()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
  if url is null or secret is null then
    raise notice 'retention purge is not configured (Vault secrets project_url and cron_secret)';
    return null;
  end if;
  return net.http_post(
    url := rtrim(url, '/') || '/functions/v1/retention-purge',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

create or replace function public.retention_due()
returns table (intern_id uuid)
language sql stable security invoker set search_path = ''
as $$ select d.intern_id from private.due_for_deletion() d; $$;

create or replace function public.purge_intern(intern uuid, objects_deleted integer default 0)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.purge_intern(intern, objects_deleted); $$;

create or replace function public.retention_certificates_due()
returns table (request_id uuid, attachment_path text)
language sql stable security invoker set search_path = ''
as $$ select * from private.retention_certificates_due(); $$;

create or replace function public.retention_certificate_removed(request_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.retention_certificate_removed(request_id); $$;

-- Service role only (the Edge Function); never signed-in people.
revoke all on function private.purge_intern(uuid, integer) from public, anon, authenticated;
revoke all on function private.retention_certificates_due() from public, anon, authenticated;
revoke all on function private.retention_certificate_removed(uuid) from public, anon, authenticated;
revoke all on function private.call_retention_purge() from public, anon, authenticated;
revoke all on function public.retention_due() from public, anon, authenticated;
revoke all on function public.purge_intern(uuid, integer) from public, anon, authenticated;
revoke all on function public.retention_certificates_due() from public, anon, authenticated;
revoke all on function public.retention_certificate_removed(uuid) from public, anon, authenticated;
grant execute on function private.due_for_deletion() to service_role;
grant execute on function private.purge_intern(uuid, integer) to service_role;
grant execute on function private.retention_certificates_due() to service_role;
grant execute on function private.retention_certificate_removed(uuid) to service_role;
grant execute on function public.retention_due() to service_role;
grant execute on function public.purge_intern(uuid, integer) to service_role;
grant execute on function public.retention_certificates_due() to service_role;
grant execute on function public.retention_certificate_removed(uuid) to service_role;

select cron.schedule('daymark-retention-purge', '33 16 * * *', 'select private.call_retention_purge()');  -- 02:03 Darwin

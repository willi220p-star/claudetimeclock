-- Phase 5: optional medical certificates for leave (§9.2, §14 storage, review §2.3, §2.7, rule 20).
-- Private bucket, path <intern>/<uuid>.<ext>; the owner uploads, the owner, their supervisor and
-- admins read; no update or delete through the API (the retention purge uses the Storage API).
-- Signed URLs are made by the client with a 60 s TTL; there are no public URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('daymark-leave-docs', 'daymark-leave-docs', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png']::text[])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Interns upload their own leave certificates" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'daymark-leave-docs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png)$'
  );

create policy "Leave certificates are readable by the intern, their supervisor and admins" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'daymark-leave-docs'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select private.is_admin())
      or ((storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
          and private.is_supervisor_of(((storage.foldername(name))[1])::uuid))
    )
  );

-- After uploading, the intern links the file to their pending leave request. The consent row
-- (record_consent('medical_certificate', 'granted', request_id)) must come first.
create or replace function private.attach_leave_certificate(request_id uuid, path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  r public.daymark_requests%rowtype;
  before_row jsonb;
begin
  select * into r from public.daymark_requests x where x.id = request_id for update;
  if not found or r.intern_id is distinct from me then
    raise exception 'You can only add a certificate to your own leave request.' using errcode = '42501';
  end if;
  if r.type <> 'leave' or r.status not in ('pending_supervisor', 'pending_admin') then
    raise exception 'You can add a certificate only to a pending leave request.' using errcode = 'P0001';
  end if;
  if path is null or path !~ ('^' || me::text || '/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png)$') then
    raise exception 'That file isn''t one of your uploads.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o
                 where o.bucket_id = 'daymark-leave-docs' and o.name = path and o.owner_id = me::text) then
    raise exception 'We didn''t get your certificate. Upload it again.' using errcode = 'P0001';
  end if;
  if not coalesce((select c.decision = 'granted' from public.daymark_consent_records c
                   where c.person_id = me and c.purpose = 'medical_certificate' and c.related_id = r.id
                   order by c.id desc limit 1), false) then
    raise exception 'Agree to how we store your certificate before adding it.' using errcode = 'P0001', hint = 'consent';
  end if;

  before_row := to_jsonb(r);
  update public.daymark_requests x set attachment_path = path, updated_at = private.clock_now()
  where x.id = r.id returning * into r;
  perform private.audit('attach_certificate', 'daymark_requests', r.id::text, before_row, to_jsonb(r));
  return to_jsonb(r);
end;
$$;

-- Review rule 20: the supervisor (or admin) saw the certificate in person; no file is kept.
create or replace function private.mark_certificate_sighted(request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  r public.daymark_requests%rowtype;
  before_row jsonb;
begin
  select * into r from public.daymark_requests x where x.id = request_id for update;
  if not found or not private.can_view_placement(r.placement_id) then
    raise exception 'That request doesn''t exist.' using errcode = '22023';
  end if;
  if r.intern_id = me then
    raise exception 'Your supervisor ticks this after seeing your certificate.' using errcode = '42501';
  end if;
  if not private.is_admin() and not exists (
    select 1 from public.daymark_placements p join public.daymark_profiles s on s.id = p.supervisor_id
    where p.id = r.placement_id and p.supervisor_id = me and s.is_supervisor and s.active) then
    raise exception 'Only this intern''s supervisor or the DGK admin can do that.' using errcode = '42501';
  end if;
  if r.type <> 'leave' then
    raise exception 'Only leave requests have certificates.' using errcode = 'P0001';
  end if;

  before_row := to_jsonb(r);
  update public.daymark_requests x set certificate_sighted = true, updated_at = private.clock_now()
  where x.id = r.id returning * into r;
  perform private.audit('sight_certificate', 'daymark_requests', r.id::text, before_row, to_jsonb(r));
  return to_jsonb(r);
end;
$$;

create or replace function public.attach_leave_certificate(request_id uuid, path text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.attach_leave_certificate(request_id, path); $$;

create or replace function public.mark_certificate_sighted(request_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.mark_certificate_sighted(request_id); $$;

revoke all on function private.attach_leave_certificate(uuid, text) from public, anon;
revoke all on function private.mark_certificate_sighted(uuid) from public, anon;
revoke all on function public.attach_leave_certificate(uuid, text) from public, anon;
revoke all on function public.mark_certificate_sighted(uuid) from public, anon;
grant execute on function private.attach_leave_certificate(uuid, text) to authenticated;
grant execute on function private.mark_certificate_sighted(uuid) to authenticated;
grant execute on function public.attach_leave_certificate(uuid, text) to authenticated;
grant execute on function public.mark_certificate_sighted(uuid) to authenticated;

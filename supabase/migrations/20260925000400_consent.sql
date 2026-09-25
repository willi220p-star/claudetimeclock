-- Phase 1: collection notice and append-only consent records (security review §2, D6).

create table public.daymark_notices (
  version text primary key,
  title text not null,
  body text not null,
  sha256 text generated always as (encode(extensions.digest(body, 'sha256'), 'hex')) stored,
  published_at timestamptz not null default now()
);

alter table public.daymark_notices enable row level security;
create policy "Signed-in people read notices" on public.daymark_notices
  for select to authenticated using (true);
revoke all on table public.daymark_notices from public, anon, authenticated;
grant select on table public.daymark_notices to authenticated;
grant all on table public.daymark_notices to service_role;

-- Plain text: blank lines split paragraphs, lines starting "- " are list items.
insert into public.daymark_notices (version, title, body) values ('1.0', 'How DGK Clock handles your information', $notice$
DGK Business Consultancy ("DGK", Palmerston City NT) runs DGK Clock to record your placement hours and give your university an accurate, supervisor-approved hours report.

What we collect and why

- Your details: name, email, university, course, your university coordinator's name and email, and your schedule, so we can run your placement and send reports.
- Location, only when you tap Clock in or Clock out: your phone's GPS position and its accuracy, used once to confirm you are within 200 m of our office at 1 Palmerston Circuit. We never track you in the background, outside the office, or outside Mon–Fri 7:00 am–7:00 pm.
- Selfie, only when you tap Clock in or Clock out: a photo taken live with your phone camera while you show a gesture the app asks for, to confirm it is really you. Only your supervisor or the DGK admin view photos, for spot checks or disputes. We do not use facial recognition or any automated face matching.
- Work logs, weekly supervisor ratings and comments, and exit feedback: to supervise and assess your placement.
- Leave requests and, if you choose, medical certificates: to approve sick or personal leave. A certificate contains health information. You can show it to your supervisor in person instead of uploading it.
- Security records: an audit log of actions in the app and your browser's device description, to prevent fraud and misuse.

Who sees it

You, your assigned supervisor, and the DGK admin. Your university receives only the approved hours report and, if your placement agreement requires it, your supervisor's ratings. We use Supabase (database and file storage; a US company) and GitHub Pages (website hosting; US). We do not sell or share your information for marketing, and we don't send your location to any map or address service.

If you say no

Location and selfie are optional. If you don't agree, you clock in by asking your supervisor to confirm you're at the office, and those hours count once they confirm. Saying no will not affect your placement or assessment. Uploading a medical certificate is always optional.

How long we keep it

Everything about you, including photos and certificates, is permanently deleted 30 days after your placement ends. Uploaded medical certificates are deleted 7 days after your leave request is decided. Your university keeps its own copy of the hours report under its own policies.

Automated checks

The app automatically refuses a clock-in that is outside the office area or outside hours. If you think a refusal is wrong, ask your supervisor for a manual review.

Your rights

You can ask to see or correct your information, withdraw consent at any time under Me → Privacy, or complain. Contact Dilip Sapkota at DGK Business Consultancy. We'll respond within 30 days. If you're not satisfied, you can contact the Office of the Australian Information Commissioner (oaic.gov.au).
$notice$);

create table public.daymark_consent_records (
  id bigint generated always as identity primary key,
  person_id uuid not null references public.daymark_profiles (id) on delete cascade,
  purpose text not null check (purpose in ('collection_notice', 'location', 'selfie', 'medical_certificate', 'privacy_policy')),
  decision text not null check (decision in ('granted', 'refused', 'withdrawn', 'acknowledged')),
  notice_version text not null references public.daymark_notices (version),
  notice_sha256 text not null,
  related_id uuid,
  recorded_at timestamptz not null default now(),
  user_agent text,
  recorded_by uuid not null,
  constraint daymark_consent_records_decision_fits check (
    (purpose in ('collection_notice', 'privacy_policy')) = (decision = 'acknowledged')
  )
);

create index daymark_consent_records_person_idx on public.daymark_consent_records (person_id, purpose, id desc);
create index daymark_consent_records_notice_idx on public.daymark_consent_records (notice_version);

alter table public.daymark_consent_records enable row level security;
create policy "People read their own consent; admins read all" on public.daymark_consent_records
  for select to authenticated
  using (person_id = (select auth.uid()) or (select private.is_admin()));

revoke all on table public.daymark_consent_records from public, anon, authenticated;
grant select on table public.daymark_consent_records to authenticated;
grant select on table public.daymark_consent_records to service_role;

-- Generic append-only guard (the retention purge may delete inside its own transaction).
create or replace function private.append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('daymark.purging', true) = 'on' then
    return old;
  end if;
  raise exception 'These records cannot be changed.' using errcode = 'P0001';
end;
$$;

revoke all on function private.append_only() from public, anon, authenticated;

create trigger daymark_consent_records_append_only
  before update or delete on public.daymark_consent_records
  for each row execute function private.append_only();

-- The browser's user agent from the PostgREST request, or null outside the API.
create or replace function private.request_user_agent()
returns text
language sql
stable
set search_path = ''
as $$
  select left(nullif(current_setting('request.headers', true), '')::json ->> 'user-agent', 400);
$$;

create or replace function private.has_consent(person uuid, purpose text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
      select c.decision = 'granted'
      from public.daymark_consent_records c
      where c.person_id = has_consent.person and c.purpose = has_consent.purpose
      order by c.id desc
      limit 1
    ), false)
    and exists (
      select 1 from public.daymark_consent_records c
      where c.person_id = has_consent.person
        and c.purpose = 'collection_notice'
        and c.notice_version = (select s.notice_version from public.daymark_settings s where s.id = 1)
    );
$$;

create or replace function private.my_consent()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id),
  latest as (
    select distinct on (c.purpose) c.purpose, c.decision
    from public.daymark_consent_records c, me
    where c.person_id = me.id
    order by c.purpose, c.id desc
  )
  select jsonb_build_object(
    'notice_version', (select s.notice_version from public.daymark_settings s where s.id = 1),
    'notice_acknowledged', exists (
      select 1 from public.daymark_consent_records c, me
      where c.person_id = me.id and c.purpose = 'collection_notice'
        and c.notice_version = (select s.notice_version from public.daymark_settings s where s.id = 1)
    ),
    'location', (select decision from latest where purpose = 'location'),
    'selfie', (select decision from latest where purpose = 'selfie')
  );
$$;

create or replace function private.record_consent(purpose text, decision text, related_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  current_version text;
begin
  if me is null or not exists (select 1 from public.daymark_profiles where id = me) then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if purpose not in ('collection_notice', 'location', 'selfie', 'medical_certificate', 'privacy_policy') then
    raise exception 'Unknown consent purpose.' using errcode = '22023';
  end if;
  if (purpose in ('collection_notice', 'privacy_policy')) <> (decision = 'acknowledged')
     or decision not in ('granted', 'refused', 'withdrawn', 'acknowledged') then
    raise exception 'That choice does not fit this consent.' using errcode = '22023';
  end if;
  if purpose = 'medical_certificate' and related_id is null then
    raise exception 'Certificate consent belongs to a leave request.' using errcode = '22023';
  end if;

  select s.notice_version into current_version from public.daymark_settings s where s.id = 1;
  insert into public.daymark_consent_records (
    person_id, purpose, decision, notice_version, notice_sha256, related_id, recorded_at, user_agent, recorded_by
  )
  select me, record_consent.purpose, record_consent.decision, n.version, n.sha256, record_consent.related_id,
         private.clock_now(), private.request_user_agent(), me
  from public.daymark_notices n
  where n.version = current_version;

  return private.my_consent();
end;
$$;

create or replace function public.record_consent(purpose text, decision text, related_id uuid default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.record_consent(purpose, decision, related_id); $$;

create or replace function public.my_consent()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.my_consent(); $$;

revoke all on function private.request_user_agent() from public, anon;
revoke all on function private.has_consent(uuid, text) from public, anon;
revoke all on function private.my_consent() from public, anon;
revoke all on function private.record_consent(text, text, uuid) from public, anon;
revoke all on function public.record_consent(text, text, uuid) from public, anon;
revoke all on function public.my_consent() from public, anon;
grant execute on function private.request_user_agent() to authenticated;
grant execute on function private.has_consent(uuid, text) to authenticated;
grant execute on function private.my_consent() to authenticated;
grant execute on function private.record_consent(text, text, uuid) to authenticated;
grant execute on function public.record_consent(text, text, uuid) to authenticated;
grant execute on function public.my_consent() to authenticated;

-- Email notifications through Gmail and Apps Script (Dilip, 14 Oct; D50).
-- Contract: docs/superpowers/specs/2026-10-14-email-notifications-contract.md. Copies the push sender (D36):
-- a notification → an outbox row (AFTER INSERT trigger) → pg_cron private.call_send_email() every minute →
-- Edge Function send-email (claims rows through email_claim, reports through email_mark) → Apps Script.
-- Email is off until an admin turns it on; at most email_daily_cap emails per Darwin day.

-- ---------------------------------------------------------------------------
-- 1. Settings and the personal switch
-- ---------------------------------------------------------------------------
create or replace function private.email_kind_options()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['request', 'attendance', 'work_based', 'announcement', 'schedule', 'task',
               'times', 'signoff', 'digest', 'escalated']::text[];
$$;

alter table public.daymark_settings
  add column email_enabled boolean not null default false,
  add column email_kinds text[] not null
    default array['request', 'attendance', 'work_based', 'announcement', 'schedule', 'task']::text[],
  add column email_daily_cap integer not null default 80 check (email_daily_cap between 1 and 95);

alter table public.daymark_profiles add column email_opt_out boolean not null default false;

-- Test recipients live in a closed one-row table: daymark_settings is readable by everyone signed in.
create table public.daymark_email_private (
  id integer primary key default 1 check (id = 1),
  test_recipients text[] not null default '{}'
);
insert into public.daymark_email_private (id) values (1);
alter table public.daymark_email_private enable row level security;
revoke all on table public.daymark_email_private from public, anon, authenticated;
grant all on table public.daymark_email_private to service_role;

-- ---------------------------------------------------------------------------
-- 2. The outbox. id is the event_id Apps Script sees, the same on every retry.
-- ---------------------------------------------------------------------------
create table public.daymark_email_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid unique references public.daymark_notifications (id) on delete set null,
  person_id uuid not null references public.daymark_profiles (id) on delete cascade,
  kind text not null,
  template_id text not null,
  recipient_category text not null check (recipient_category in ('user', 'admin')),
  title text not null,
  body text not null default '' check (char_length(body) <= 1000),
  link text check (link is null or link ~ '^/[A-Za-z0-9/_?=&.-]*$'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'retry_pending', 'uncertain', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  processing_at timestamptz,
  completed_at timestamptz,
  error_code text check (char_length(error_code) <= 60),
  error_message text check (char_length(error_message) <= 300)
);
create index daymark_email_outbox_due_idx on public.daymark_email_outbox (status, next_attempt_at);
create index daymark_email_outbox_sent_idx on public.daymark_email_outbox (completed_at) where status = 'sent';
create index daymark_email_outbox_person_idx on public.daymark_email_outbox (person_id);
create index daymark_email_outbox_processing_idx on public.daymark_email_outbox (processing_at);
alter table public.daymark_email_outbox enable row level security;   -- no policies: functions only
revoke all on table public.daymark_email_outbox from public, anon, authenticated;
grant all on table public.daymark_email_outbox to service_role;

-- Which Apps Script template a notification uses.
create or replace function private.email_template(kind text, category text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when kind = 'request' then case when category = 'admin' then 'approval_needed' else 'request_update' end
    when kind in ('attendance', 'work_based') then 'approval_needed'
    when kind = 'announcement' then 'announcement'
    when kind = 'schedule' then 'roster_change'
    when kind = 'task' then 'task_update'
    else 'general_notice'
  end;
$$;

-- Emails that count against today's cap (Darwin day): sent, being sent, or maybe sent.
create or replace function private.email_sent_today()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.daymark_email_outbox o
  where o.status in ('sent', 'processing', 'uncertain')
    and o.processing_at >= private.darwin_at(private.darwin_today(), '00:00')
    and o.processing_at < private.darwin_at(private.darwin_today() + 1, '00:00');
$$;

create or replace function private.queue_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.daymark_settings%rowtype;
  p public.daymark_profiles%rowtype;
  category text;
begin
  select * into st from public.daymark_settings s where s.id = 1;
  if not coalesce(st.email_enabled, false) or not (new.kind = any (st.email_kinds)) then
    return new;
  end if;
  select * into p from public.daymark_profiles x where x.id = new.person_id;
  if not found or not p.active or p.is_kiosk or p.email_opt_out then
    return new;
  end if;
  category := case when p.is_admin or p.is_supervisor then 'admin' else 'user' end;
  insert into public.daymark_email_outbox
    (notification_id, person_id, kind, template_id, recipient_category, title, body, link, next_attempt_at, created_at)
  values (new.id, new.person_id, new.kind, private.email_template(new.kind, category), category,
          new.title, left(new.body, 1000), new.link, private.clock_now(), new.created_at)
  on conflict (notification_id) do nothing;
  return new;
end;
$$;
create trigger daymark_notifications_email after insert on public.daymark_notifications
  for each row execute function private.queue_email();

-- ---------------------------------------------------------------------------
-- 3. Sending: pg_cron calls the send-email Edge Function when something is due
-- ---------------------------------------------------------------------------
create or replace function private.call_send_email()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
  st public.daymark_settings%rowtype;
begin
  -- A send that never reported back may or may not have gone: never retried automatically.
  update public.daymark_email_outbox o
  set status = 'uncertain', error_code = 'stale_processing', completed_at = private.clock_now()
  where o.status = 'processing' and o.processing_at < private.clock_now() - interval '10 minutes';

  select * into st from public.daymark_settings s where s.id = 1;
  if not st.email_enabled or private.email_sent_today() >= st.email_daily_cap
     or not exists (select 1 from public.daymark_email_outbox o
                    where o.status in ('pending', 'retry_pending') and o.next_attempt_at <= private.clock_now()) then
    return null;
  end if;
  if url is null or secret is null then
    raise notice 'email sending is not configured (Vault secrets project_url and cron_secret)';
    return null;
  end if;
  return net.http_post(
    url := rtrim(url, '/') || '/functions/v1/send-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

-- The Edge Function takes due rows (service role only). The cap counts today's sent, processing and
-- uncertain rows, so anything over it waits for 00:00 Darwin.
-- ponytail: two runs claiming at the same instant could pass the cap by one batch; pg_cron starts one a minute.
create or replace function private.email_claim(max_rows integer)
returns table (
  id uuid, correlation_id uuid, template_id text, recipient_category text, kind text, title text, body text,
  link text, created_at timestamptz, attempts integer, recipient_name text, recipient_email text,
  test_only boolean, allowed boolean
)
language sql
security definer
set search_path = ''
as $$
  with st as (
    select s.email_enabled, s.email_daily_cap, e.test_recipients as email_test_recipients
    from public.daymark_settings s cross join public.daymark_email_private e where s.id = 1 and e.id = 1
  ), due as (
    select x.id from public.daymark_email_outbox x
    where (select email_enabled from st)
      and x.status in ('pending', 'retry_pending') and x.next_attempt_at <= private.clock_now()
    order by x.next_attempt_at, x.created_at
    limit greatest(0, least(coalesce(max_rows, 0), (select email_daily_cap from st) - private.email_sent_today()))
    for update of x skip locked
  )
  update public.daymark_email_outbox o
  set status = 'processing', processing_at = private.clock_now(), attempts = o.attempts + 1
  from due d
  join public.daymark_profiles p on true
  left join auth.users u on u.id = p.id
  cross join st
  where o.id = d.id and p.id = o.person_id
  returning o.id, o.correlation_id, o.template_id, o.recipient_category, o.kind, o.title, o.body, o.link,
            o.created_at, o.attempts, p.display_name, lower(u.email),
            cardinality(st.email_test_recipients) > 0,
            cardinality(st.email_test_recipients) = 0 or lower(u.email) = any (st.email_test_recipients);
$$;

-- Error text never carries addresses, and is kept short.
create or replace function private.email_clean_error(message text)
returns text
language sql
immutable
set search_path = ''
as $$ select left(regexp_replace(message, '[^\s@<>"'']+@[^\s@<>"'']+', '[address]', 'g'), 300); $$;

-- The Edge Function reports how a claimed row went (service role only). Only a processing row changes,
-- so a sent row is never overwritten.
create or replace function private.email_mark(id uuid, status text, error_code text, error_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.daymark_email_outbox%rowtype;
  now_ts timestamptz := private.clock_now();
  code text := left(nullif(btrim(email_mark.error_code), ''), 60);
  message text := private.email_clean_error(nullif(btrim(email_mark.error_message), ''));
begin
  if email_mark.status is null or email_mark.status not in ('sent', 'retry_pending', 'failed', 'uncertain', 'skipped') then
    raise exception 'That isn''t an email outcome.' using errcode = '22023';
  end if;
  select * into r from public.daymark_email_outbox o where o.id = email_mark.id and o.status = 'processing' for update;
  if not found then
    return;
  end if;
  if email_mark.status = 'sent' then
    update public.daymark_email_outbox o
    set status = 'sent', completed_at = now_ts, error_code = null, error_message = null where o.id = r.id;
  elsif email_mark.status = 'retry_pending' and r.attempts >= 5 then
    update public.daymark_email_outbox o
    set status = 'failed', completed_at = now_ts, error_code = 'max_attempts', error_message = coalesce(message, code)
    where o.id = r.id;
  elsif email_mark.status = 'retry_pending' then
    -- 2, 4, 8, 16 minutes (plus up to 30 s), at most an hour.
    update public.daymark_email_outbox o
    set status = 'retry_pending', error_code = code, error_message = message,
        next_attempt_at = now_ts + least(interval '60 minutes',
          make_interval(mins => power(2, r.attempts)::integer) + make_interval(secs => random() * 30))
    where o.id = r.id;
  else
    update public.daymark_email_outbox o
    set status = email_mark.status, completed_at = now_ts, error_code = code, error_message = message
    where o.id = r.id;
  end if;
end;
$$;

select cron.schedule('daymark-send-email', '* * * * *', 'select private.call_send_email()');

-- ---------------------------------------------------------------------------
-- 4. Admin: settings, failures, retry
-- ---------------------------------------------------------------------------
create or replace function private.email_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  st public.daymark_settings%rowtype;
begin
  perform private.require_admin();
  select * into st from public.daymark_settings s where s.id = 1;
  return jsonb_build_object(
    'enabled', st.email_enabled,
    'kinds', to_jsonb(st.email_kinds),
    'options', to_jsonb(private.email_kind_options()),
    'test_recipients', to_jsonb((select e.test_recipients from public.daymark_email_private e where e.id = 1)),
    'daily_cap', st.email_daily_cap,
    'sent_today', private.email_sent_today(),
    'queued', (select count(*) from public.daymark_email_outbox o where o.status in ('pending', 'retry_pending')),
    'failed_7d', (select count(*) from public.daymark_email_outbox o
                  where o.status = 'failed' and o.completed_at >= private.clock_now() - interval '7 days'),
    'uncertain_7d', (select count(*) from public.daymark_email_outbox o
                     where o.status = 'uncertain' and o.completed_at >= private.clock_now() - interval '7 days'));
end;
$$;

create or replace function private.save_email_settings(enabled boolean, kinds text[], test_recipients text[], daily_cap integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.daymark_settings%rowtype;
  old_to text[];
  clean_kinds text[] := array(select distinct k from unnest(coalesce(kinds, '{}')) k order by 1);
  clean_to text[] := array(select distinct lower(btrim(t)) from unnest(coalesce(test_recipients, '{}')) t
                           where nullif(btrim(t), '') is not null order by 1);
begin
  perform private.require_admin();
  if enabled is null then
    raise exception 'Turn email on or off.' using errcode = '22023';
  end if;
  if kinds is null or exists (select 1 from unnest(clean_kinds) k where k is null or not (k = any (private.email_kind_options()))) then
    raise exception 'That isn''t a notification DGK Clock emails.' using errcode = '22023';
  end if;
  if cardinality(clean_to) > 20
     or exists (select 1 from unnest(clean_to) t where t !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(t) > 254) then
    raise exception 'Write up to 20 test email addresses, one per line.' using errcode = '22023';
  end if;
  if daily_cap is null or daily_cap not between 1 and 95 then
    raise exception 'Set the daily limit between 1 and 95 emails.' using errcode = '22023';
  end if;
  select * into st from public.daymark_settings s where s.id = 1;
  select e.test_recipients into old_to from public.daymark_email_private e where e.id = 1;
  update public.daymark_settings s
  set email_enabled = save_email_settings.enabled, email_kinds = clean_kinds,
      email_daily_cap = save_email_settings.daily_cap, updated_at = private.clock_now()
  where s.id = 1;
  update public.daymark_email_private e set test_recipients = clean_to where e.id = 1;
  perform private.audit('save_email_settings', 'daymark_settings', '1',
    jsonb_build_object('email_enabled', st.email_enabled, 'email_kinds', st.email_kinds,
                       'email_test_recipients', old_to, 'email_daily_cap', st.email_daily_cap),
    jsonb_build_object('email_enabled', enabled, 'email_kinds', clean_kinds,
                       'email_test_recipients', clean_to, 'email_daily_cap', daily_cap));
end;
$$;

-- Failed and uncertain emails from the last 30 days, without addresses.
create or replace function private.email_failures(max_rows integer default 50)
returns table (
  id uuid, created_at timestamptz, kind text, template_id text, recipient_category text, person_name text,
  status text, attempts integer, error_code text, error_message text, completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select o.id, o.created_at, o.kind, o.template_id, o.recipient_category, p.display_name,
         o.status, o.attempts, o.error_code, o.error_message, o.completed_at
  from public.daymark_email_outbox o
  join public.daymark_profiles p on p.id = o.person_id
  where o.status in ('failed', 'uncertain') and o.created_at >= private.clock_now() - interval '30 days'
  order by o.created_at desc
  limit least(greatest(coalesce(email_failures.max_rows, 50), 1), 200);
end;
$$;

-- A manual retry gets a fresh set of attempts.
create or replace function private.retry_email(id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.daymark_email_outbox%rowtype;
begin
  perform private.require_admin();
  select * into r from public.daymark_email_outbox o
  where o.id = retry_email.id and o.status in ('failed', 'uncertain') for update;
  if not found then
    raise exception 'Only a failed or uncertain email can be sent again.' using errcode = 'P0002';
  end if;
  update public.daymark_email_outbox o
  set status = 'retry_pending', next_attempt_at = private.clock_now(), attempts = 0, completed_at = null
  where o.id = r.id;
  perform private.audit('retry_email', 'daymark_email_outbox', r.id::text,
    jsonb_build_object('status', r.status, 'attempts', r.attempts, 'error_code', r.error_code),
    jsonb_build_object('status', 'retry_pending', 'attempts', 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Self-service: "Email me notifications"
-- ---------------------------------------------------------------------------
create or replace function private.set_my_email(enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if enabled is null then
    raise exception 'Turn email on or off.' using errcode = '22023';
  end if;
  update public.daymark_profiles p set email_opt_out = not set_my_email.enabled
  where p.id = (select auth.uid()) and p.active;
  if not found then
    raise exception 'Sign in to change your email setting.' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.my_email_setting()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select not p.email_opt_out from public.daymark_profiles p where p.id = (select auth.uid()); $$;

-- ---------------------------------------------------------------------------
-- 6. Wrappers and grants
-- ---------------------------------------------------------------------------
create or replace function public.email_claim(max_rows integer default 20)
returns table (
  id uuid, correlation_id uuid, template_id text, recipient_category text, kind text, title text, body text,
  link text, created_at timestamptz, attempts integer, recipient_name text, recipient_email text,
  test_only boolean, allowed boolean
)
language sql security invoker set search_path = ''
as $$ select * from private.email_claim(max_rows); $$;

create or replace function public.email_mark(id uuid, status text, error_code text default null, error_message text default null)
returns void language sql security invoker set search_path = ''
as $$ select private.email_mark(id, status, error_code, error_message); $$;

create or replace function public.email_settings()
returns jsonb language sql security invoker set search_path = ''
as $$ select private.email_settings(); $$;

create or replace function public.save_email_settings(enabled boolean, kinds text[], test_recipients text[], daily_cap integer)
returns void language sql security invoker set search_path = ''
as $$ select private.save_email_settings(enabled, kinds, test_recipients, daily_cap); $$;

create or replace function public.email_failures(max_rows integer default 50)
returns table (
  id uuid, created_at timestamptz, kind text, template_id text, recipient_category text, person_name text,
  status text, attempts integer, error_code text, error_message text, completed_at timestamptz
)
language sql security invoker set search_path = ''
as $$ select * from private.email_failures(max_rows); $$;

create or replace function public.retry_email(id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.retry_email(id); $$;

create or replace function public.set_my_email(enabled boolean)
returns void language sql security invoker set search_path = ''
as $$ select private.set_my_email(enabled); $$;

create or replace function public.my_email_setting()
returns boolean language sql security invoker set search_path = ''
as $$ select private.my_email_setting(); $$;

revoke all on function private.email_kind_options() from public, anon;
revoke all on function private.email_template(text, text) from public, anon, authenticated;
revoke all on function private.email_sent_today() from public, anon, authenticated;
revoke all on function private.queue_email() from public, anon, authenticated;
revoke all on function private.call_send_email() from public, anon, authenticated;
revoke all on function private.email_claim(integer) from public, anon, authenticated;
revoke all on function private.email_clean_error(text) from public, anon, authenticated;
revoke all on function private.email_mark(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.email_claim(integer) from public, anon, authenticated;
revoke all on function public.email_mark(uuid, text, text, text) from public, anon, authenticated;
revoke all on function private.email_settings() from public, anon;
revoke all on function private.save_email_settings(boolean, text[], text[], integer) from public, anon;
revoke all on function private.email_failures(integer) from public, anon;
revoke all on function private.retry_email(uuid) from public, anon;
revoke all on function private.set_my_email(boolean) from public, anon;
revoke all on function private.my_email_setting() from public, anon;
revoke all on function public.email_settings() from public, anon;
revoke all on function public.save_email_settings(boolean, text[], text[], integer) from public, anon;
revoke all on function public.email_failures(integer) from public, anon;
revoke all on function public.retry_email(uuid) from public, anon;
revoke all on function public.set_my_email(boolean) from public, anon;
revoke all on function public.my_email_setting() from public, anon;
grant execute on function private.email_kind_options() to authenticated;
grant execute on function private.email_claim(integer) to service_role;
grant execute on function private.email_mark(uuid, text, text, text) to service_role;
grant execute on function public.email_claim(integer) to service_role;
grant execute on function public.email_mark(uuid, text, text, text) to service_role;
grant execute on function private.email_settings() to authenticated;
grant execute on function private.save_email_settings(boolean, text[], text[], integer) to authenticated;
grant execute on function private.email_failures(integer) to authenticated;
grant execute on function private.retry_email(uuid) to authenticated;
grant execute on function private.set_my_email(boolean) to authenticated;
grant execute on function private.my_email_setting() to authenticated;
grant execute on function public.email_settings() to authenticated;
grant execute on function public.save_email_settings(boolean, text[], text[], integer) to authenticated;
grant execute on function public.email_failures(integer) to authenticated;
grant execute on function public.retry_email(uuid) to authenticated;
grant execute on function public.set_my_email(boolean) to authenticated;
grant execute on function public.my_email_setting() to authenticated;

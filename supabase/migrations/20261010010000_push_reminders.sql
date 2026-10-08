-- Push reminders (Dilip, 8 Oct; design docs/superpowers/specs/2026-10-08-offline-push-design.md, D36):
-- interns get a phone notification when they haven't clocked in, their break runs long or they forgot
-- to clock out; staff get one for new requests. No pushes 9 pm–7 am Darwin (they wait until 7 am).
-- Every push is also an in-app notification; the push only goes to phones that turned reminders on.

-- ---------------------------------------------------------------------------
-- 1. Phones that turned reminders on (Web Push subscriptions)
-- ---------------------------------------------------------------------------
create table public.daymark_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.daymark_profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index daymark_push_subscriptions_person_idx on public.daymark_push_subscriptions (person_id);
alter table public.daymark_push_subscriptions enable row level security;
create policy "People see their own phones" on public.daymark_push_subscriptions
  for select to authenticated using (person_id = (select auth.uid()));
revoke all on table public.daymark_push_subscriptions from public, anon, authenticated;
grant select on table public.daymark_push_subscriptions to authenticated;
grant all on table public.daymark_push_subscriptions to service_role;

create or replace function private.save_push_subscription(endpoint text, p256dh text, auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null or not exists (select 1 from public.daymark_profiles x where x.id = me and x.active) then
    raise exception 'Sign in to turn on reminders.' using errcode = '42501';
  end if;
  if endpoint is null or endpoint !~ '^https://' or char_length(endpoint) > 1000
     or nullif(btrim(p256dh), '') is null or nullif(btrim(auth), '') is null
     or char_length(p256dh) > 200 or char_length(auth) > 100 then
    raise exception 'This browser sent an incomplete subscription. Try again.' using errcode = '22023';
  end if;
  -- One phone, one owner: signing in as someone else on the same phone moves it to them.
  insert into public.daymark_push_subscriptions (person_id, endpoint, p256dh, auth, user_agent)
  values (me, endpoint, p256dh, auth, private.request_user_agent())
  on conflict on constraint daymark_push_subscriptions_endpoint_key do update
  set person_id = excluded.person_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end;
$$;

create or replace function private.delete_push_subscription(endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.daymark_push_subscriptions s
  where s.endpoint = delete_push_subscription.endpoint and s.person_id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 2. The send queue: push-worthy notifications for people with a phone, held overnight
-- ---------------------------------------------------------------------------
create table public.daymark_push_outbox (
  id bigint generated always as identity primary key,
  notification_id uuid not null references public.daymark_notifications (id) on delete cascade,
  person_id uuid not null references public.daymark_profiles (id) on delete cascade,
  send_after timestamptz not null,
  sent_at timestamptz,
  attempts integer not null default 0,
  error text
);
create index daymark_push_outbox_due_idx on public.daymark_push_outbox (send_after) where sent_at is null;
alter table public.daymark_push_outbox enable row level security;   -- no policies: the Edge Function only
revoke all on table public.daymark_push_outbox from public, anon, authenticated;
grant all on table public.daymark_push_outbox to service_role;

-- Quiet hours: 9 pm–7 am Darwin waits until 7 am.
create or replace function private.push_send_after(at timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when extract(hour from at at time zone 'Australia/Darwin') >= 21
      then private.darwin_at((at at time zone 'Australia/Darwin')::date + 1, '07:00')
    when extract(hour from at at time zone 'Australia/Darwin') < 7
      then private.darwin_at((at at time zone 'Australia/Darwin')::date, '07:00')
    else at
  end;
$$;

-- The kinds that are worth a buzz: the three reminders and new things for staff to act on.
create or replace function private.push_worthy(kind text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select kind in ('reminder', 'request', 'attendance', 'work_based', 'escalated', 'schedule', 'times'); $$;

create or replace function private.queue_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.push_worthy(new.kind)
     and exists (select 1 from public.daymark_push_subscriptions s where s.person_id = new.person_id) then
    insert into public.daymark_push_outbox (notification_id, person_id, send_after)
    values (new.id, new.person_id, private.push_send_after(new.created_at));
  end if;
  return new;
end;
$$;
create trigger daymark_notifications_push after insert on public.daymark_notifications
  for each row execute function private.queue_push();

-- ---------------------------------------------------------------------------
-- 3. Reminders, every 5 minutes; each fires once per person, kind and day
-- ---------------------------------------------------------------------------
create table public.daymark_reminders_sent (
  person_id uuid not null references public.daymark_profiles (id) on delete cascade,
  kind text not null check (kind in ('not_clocked_in', 'long_break', 'forgot_clock_out')),
  work_date date not null,
  sent_at timestamptz not null default now(),
  primary key (person_id, kind, work_date)
);
alter table public.daymark_reminders_sent enable row level security;
revoke all on table public.daymark_reminders_sent from public, anon, authenticated;
grant all on table public.daymark_reminders_sent to service_role;

create or replace function private.job_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_ts timestamptz := private.clock_now();
  today date := private.darwin_today();
  r record;
  sent integer := 0;
begin
  for r in
    select pl.id as placement_id, pl.intern_id, coalesce(pl.break_minutes, st.break_minutes) as break_minutes,
           sd.start_time, sd.end_time,
           lp.event_type as last_event, lp.is_break as last_break, lp.occurred_at as last_at,
           exists (select 1 from public.daymark_punches x where x.user_id = pl.intern_id
                   and x.event_type in ('shift_in', 'shift_out')
                   and (x.occurred_at at time zone 'Australia/Darwin')::date = today) as clocked_today
    from public.daymark_placements pl
    join public.daymark_profiles p on p.id = pl.intern_id and p.active and p.is_intern
    cross join public.daymark_settings st
    left join public.daymark_scheduled_days sd
      on sd.placement_id = pl.id and sd.work_date = today and sd.status = 'scheduled'
    left join lateral (
      select x.event_type, x.is_break, x.occurred_at from public.daymark_punches x
      where x.user_id = pl.intern_id and x.event_type in ('shift_in', 'shift_out') and x.occurred_at <= now_ts
      order by x.occurred_at desc limit 1
    ) lp on true
    where st.id = 1 and pl.status in ('active', 'extended') and today between pl.start_date and pl.planned_end_date
  loop
    -- Rostered, 10 minutes past the start, not clocked yet today.
    if r.start_time is not null and not r.clocked_today
       and now_ts >= private.darwin_at(today, r.start_time) + interval '10 minutes'
       and now_ts < private.darwin_at(today, r.end_time) then
      insert into public.daymark_reminders_sent (person_id, kind, work_date) values (r.intern_id, 'not_clocked_in', today)
      on conflict do nothing;
      if found then
        perform private.notify(r.intern_id, 'reminder', 'Time to clock in',
          'You''re rostered from ' || private.fmt_clock(r.start_time) || '. Clock in when you arrive.', '/clock');
        sent := sent + 1;
      end if;
    end if;
    -- On a break for longer than the assigned break.
    if r.last_event = 'shift_out' and r.last_break and r.break_minutes > 0
       and now_ts >= r.last_at + make_interval(mins => r.break_minutes)
       and (r.last_at at time zone 'Australia/Darwin')::date = today then
      insert into public.daymark_reminders_sent (person_id, kind, work_date) values (r.intern_id, 'long_break', today)
      on conflict do nothing;
      if found then
        perform private.notify(r.intern_id, 'reminder', 'Your break is up',
          'Your ' || r.break_minutes || '-minute break is up. Tap End break when you''re back.', '/clock');
        sent := sent + 1;
      end if;
    end if;
    -- Still clocked in 15 minutes after the rostered finish.
    if r.end_time is not null and r.last_event = 'shift_in'
       and now_ts >= private.darwin_at(today, r.end_time) + interval '15 minutes' then
      insert into public.daymark_reminders_sent (person_id, kind, work_date) values (r.intern_id, 'forgot_clock_out', today)
      on conflict do nothing;
      if found then
        perform private.notify(r.intern_id, 'reminder', 'Still clocked in?',
          'Your day finished at ' || private.fmt_clock(r.end_time) || '. Clock out or tap Finish.', '/clock');
        sent := sent + 1;
      end if;
    end if;
  end loop;
  return sent;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Sending: pg_cron calls the send-push Edge Function when something is due
-- ---------------------------------------------------------------------------
create or replace function private.call_send_push()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
  -- Each call counts as an attempt on the rows it is about to send (at most 3), so a function that
  -- can't send (secrets missing, rejected) stops being called; rows for people without a phone any
  -- more are closed instead of waiting forever.
  update public.daymark_push_outbox o set sent_at = private.clock_now(), error = 'no phone'
  where o.sent_at is null and o.send_after <= private.clock_now()
    and not exists (select 1 from public.daymark_push_subscriptions s where s.person_id = o.person_id);
  update public.daymark_push_outbox o set attempts = o.attempts + 1
  where o.sent_at is null and o.attempts < 3 and o.send_after <= private.clock_now();
  if not found then
    return null;
  end if;
  if url is null or secret is null then
    raise notice 'push sending is not configured (Vault secrets project_url and cron_secret)';
    return null;
  end if;
  return net.http_post(
    url := rtrim(url, '/') || '/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

-- The Edge Function's view of what is due (service role only).
create or replace function private.push_due(max_rows integer)
returns table (outbox_id bigint, attempts integer, endpoint text, p256dh text, auth text, title text, body text, link text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.attempts, s.endpoint, s.p256dh, s.auth, n.title, n.body, n.link
  from public.daymark_push_outbox o
  join public.daymark_notifications n on n.id = o.notification_id
  join public.daymark_push_subscriptions s on s.person_id = o.person_id
  where o.sent_at is null and o.attempts between 1 and 3 and o.send_after <= private.clock_now()
  order by o.id
  limit max_rows;
$$;

create or replace function public.push_due(max_rows integer default 100)
returns table (outbox_id bigint, attempts integer, endpoint text, p256dh text, auth text, title text, body text, link text)
language sql security invoker set search_path = ''
as $$ select * from private.push_due(max_rows); $$;

select cron.schedule('daymark-reminders', '*/5 * * * *', 'select private.job_reminders()');
select cron.schedule('daymark-send-push', '* * * * *', 'select private.call_send_push()');

-- ---------------------------------------------------------------------------
-- 5. Wrappers and grants
-- ---------------------------------------------------------------------------
create or replace function public.save_push_subscription(endpoint text, p256dh text, auth text)
returns void language sql security invoker set search_path = ''
as $$ select private.save_push_subscription(endpoint, p256dh, auth); $$;

create or replace function public.delete_push_subscription(endpoint text)
returns void language sql security invoker set search_path = ''
as $$ select private.delete_push_subscription(endpoint); $$;

revoke all on function private.save_push_subscription(text, text, text) from public, anon;
revoke all on function private.delete_push_subscription(text) from public, anon;
revoke all on function public.save_push_subscription(text, text, text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
revoke all on function private.push_send_after(timestamptz) from public, anon;
revoke all on function private.push_worthy(text) from public, anon;
revoke all on function private.queue_push() from public, anon, authenticated;
revoke all on function private.job_reminders() from public, anon, authenticated;
revoke all on function private.call_send_push() from public, anon, authenticated;
revoke all on function private.push_due(integer) from public, anon, authenticated;
revoke all on function public.push_due(integer) from public, anon, authenticated;
grant execute on function private.save_push_subscription(text, text, text) to authenticated;
grant execute on function private.delete_push_subscription(text) to authenticated;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function private.push_send_after(timestamptz) to authenticated;
grant execute on function private.push_worthy(text) to authenticated;
grant execute on function private.push_due(integer) to service_role;
grant execute on function public.push_due(integer) to service_role;

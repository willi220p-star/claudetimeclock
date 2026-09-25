-- The selfie freshness check compares Storage's real upload time with the real time the
-- challenge was issued. Business time (window, expiry, occurred_at) still comes from
-- private.clock_now(), so a local e2e test clock no longer breaks the selfie check.

alter table public.daymark_clock_challenges add column issued_real_at timestamptz not null default now();

create or replace function private.clock_punch(
  challenge_id uuid,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  client_reported_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  ch public.daymark_clock_challenges%rowtype;
  path text;
  saved public.daymark_punches%rowtype;
begin
  perform private.require_clocking_consent(me);

  select * into ch from public.daymark_clock_challenges c
  where c.id = clock_punch.challenge_id and c.person_id = me
  for update;
  if not found or ch.used_at is not null or private.clock_now() > ch.expires_at then
    raise exception 'That clock-in timed out. Tap Clock in again.' using errcode = 'P0001';
  end if;

  path := me || '/' || ch.id || '.jpg';
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'daymark-photos' and o.name = path and o.owner_id = me::text
      and o.created_at between ch.issued_real_at and ch.issued_real_at + interval '3 minutes'
  ) then
    raise exception 'We didn''t get your selfie. Take it again.' using errcode = 'P0001';
  end if;

  update public.daymark_clock_challenges set used_at = private.clock_now() where id = ch.id;

  insert into public.daymark_punches (
    user_id, event_type, latitude, longitude, accuracy_m, photo_path, source,
    client_reported_at, challenge_id, user_agent
  ) values (
    me, ch.event_type, clock_punch.latitude, clock_punch.longitude, clock_punch.accuracy_m, path, 'device',
    clock_punch.client_reported_at, ch.id, private.request_user_agent()
  )
  returning * into saved;

  return to_jsonb(saved);
end;
$$;

-- Kiosk mode (Dilip, 12 Oct; D42): an office tablet at the front desk. Any intern taps their name, enters
-- their PIN and takes a live selfie with the gesture; the tablet stands in for GPS (it is registered to the
-- office). A kiosk punch is an ordinary device punch at the site's position, marked kiosk, so every hours
-- rule stays the same. The kiosk account can only clock: it reads no one's records.

alter table public.daymark_profiles
  add column is_kiosk boolean not null default false,
  add column kiosk_site_id uuid references public.daymark_sites (id) on delete set null;

-- PINs are bcrypt hashes in their own table with no grants: a 4-6 digit hash is quick to crack offline,
-- so nobody (staff, the person, the kiosk) can read one; only the functions below compare them.
create table public.daymark_kiosk_pins (
  person_id uuid primary key references public.daymark_profiles (id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.daymark_kiosk_pins enable row level security;
revoke all on table public.daymark_kiosk_pins from public, anon, authenticated;
grant all on table public.daymark_kiosk_pins to service_role;

alter table public.daymark_clock_challenges add column kiosk_id uuid references public.daymark_profiles (id) on delete cascade;
alter table public.daymark_punches add column kiosk_id uuid references public.daymark_profiles (id) on delete set null;

alter table public.daymark_punches drop constraint daymark_punches_verification_method_check;
alter table public.daymark_punches add constraint daymark_punches_verification_method_check
  check (verification_method in ('gps_selfie', 'supervisor', 'punch_fix', 'staff_edit', 'offline', 'kiosk'));

-- Wrong PINs per person: 5 in a row lock that person out of every kiosk for 15 minutes.
create table public.daymark_kiosk_attempts (
  person_id uuid primary key references public.daymark_profiles (id) on delete cascade,
  failures integer not null default 0,
  locked_until timestamptz
);
alter table public.daymark_kiosk_attempts enable row level security;
revoke all on table public.daymark_kiosk_attempts from public, anon, authenticated;
grant all on table public.daymark_kiosk_attempts to service_role;

-- Kiosk punches: no phone GPS to judge, so no GPS flags; the selfie is still required.
create or replace function private.punch_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  err text;
  site public.daymark_sites%rowtype;
begin
  if new.source = 'device' then
    new.occurred_at := private.clock_now();                                      -- server time only
  end if;
  new.placement_id := coalesce(new.placement_id, (private.live_placement(new.user_id)).id,
                               private.current_placement(new.user_id));
  err := private.punch_rule_error(new);
  if err is not null then
    raise exception '%', err using errcode = 'P0001';
  end if;
  if new.source = 'device' then
    site := private.site_for(new.user_id);
    new.distance_m := private.distance_metres(new.latitude, new.longitude, site.latitude, site.longitude);
    new.place_name := site.name;
    new.verification_method := case when new.kiosk_id is null then 'gps_selfie' else 'kiosk' end;
    new.flags := case when new.kiosk_id is null then private.punch_flags(new) else '{}' end;
  end if;
  return new;
end;
$$;

-- The signed-in kiosk's site, or an error for anyone else.
create or replace function private.require_kiosk()
returns public.daymark_sites
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.daymark_sites%rowtype;
begin
  select st.* into s from public.daymark_profiles p
  join public.daymark_sites st on st.id = p.kiosk_site_id
  where p.id = (select auth.uid()) and p.is_kiosk and p.active;
  if not found then
    raise exception 'This device isn''t a DGK Clock kiosk.' using errcode = '42501';
  end if;
  return s;
end;
$$;

-- Admin: a kiosk account for an office tablet. It holds no role, so it opens nothing but /kiosk.
create or replace function private.create_kiosk(display_name text, email text, password text, site uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  made jsonb;
begin
  perform private.require_admin();
  if not exists (select 1 from public.daymark_sites s where s.id = create_kiosk.site) then
    raise exception 'Pick the office this tablet sits in.' using errcode = '22023';
  end if;
  -- ponytail: create_person needs a role, so the kiosk is made as a supervisor and the role taken off at once.
  made := private.create_person(display_name, email, password, false, true, false);
  update public.daymark_profiles p
  set is_supervisor = false, is_kiosk = true, kiosk_site_id = create_kiosk.site, must_change_password = false
  where p.id = (made ->> 'id')::uuid;
  perform private.audit('create_kiosk', 'daymark_profiles', made ->> 'id', null, jsonb_build_object('site', create_kiosk.site));
  return made;
end;
$$;

-- An intern sets (or changes) their own 4-6 digit kiosk PIN on Me.
create or replace function private.set_kiosk_pin(pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if coalesce(set_kiosk_pin.pin, '') !~ '^[0-9]{4,6}$' then
    raise exception 'Use 4 to 6 digits.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.daymark_profiles p where p.id = me and p.is_intern and p.active) then
    raise exception 'Only an intern clocks at the kiosk.' using errcode = '42501';
  end if;
  insert into public.daymark_kiosk_pins (person_id, pin_hash, updated_at)
  values (me, extensions.crypt(set_kiosk_pin.pin, extensions.gen_salt('bf', 8)), private.clock_now())
  on conflict (person_id) do update set pin_hash = excluded.pin_hash, updated_at = excluded.updated_at;
  delete from public.daymark_kiosk_attempts a where a.person_id = me;
  perform private.audit('set_kiosk_pin', 'daymark_profiles', me::text, null, null);
end;
$$;

-- Admin: clear a forgotten PIN (the intern sets a new one on Me).
create or replace function private.reset_kiosk_pin(person uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  delete from public.daymark_kiosk_pins k where k.person_id = reset_kiosk_pin.person;
  delete from public.daymark_kiosk_attempts a where a.person_id = reset_kiosk_pin.person;
  perform private.audit('reset_kiosk_pin', 'daymark_profiles', reset_kiosk_pin.person::text, null, null);
end;
$$;

-- The kiosk's name grid: first names and initials of interns on a live placement at its site, with a PIN.
create or replace function private.kiosk_people()
returns table (person_id uuid, first_name text, initials text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, split_part(p.display_name, ' ', 1),
         upper(left(p.display_name, 1) || coalesce(left(nullif(split_part(p.display_name, ' ', 2), ''), 1), ''))
  from public.daymark_profiles p
  join public.daymark_placements pl on pl.intern_id = p.id
  where pl.site_id = (private.require_kiosk()).id
    and pl.status in ('active', 'extended', 'target_reached')
    and p.active and p.is_intern and exists (select 1 from public.daymark_kiosk_pins k where k.person_id = p.id)
  order by p.display_name;
$$;

-- Name + PIN + action -> the person's live selfie challenge, issued by this kiosk.
create or replace function private.kiosk_start(person uuid, pin text, event_type text, day_kind text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  site public.daymark_sites%rowtype := private.require_kiosk();
  p public.daymark_profiles%rowtype;
  hash text;
  tries public.daymark_kiosk_attempts%rowtype;
  reason text;
  gestures text[] := private.clock_gestures();
  ch public.daymark_clock_challenges%rowtype;
begin
  -- Only interns placed at this kiosk's office.
  select x.* into p from public.daymark_profiles x
  where x.id = kiosk_start.person and x.active and x.is_intern
    and exists (select 1 from public.daymark_placements pl where pl.intern_id = x.id and pl.site_id = site.id
                and pl.status in ('active', 'extended', 'target_reached'));
  select k.pin_hash into hash from public.daymark_kiosk_pins k where k.person_id = kiosk_start.person;
  select * into tries from public.daymark_kiosk_attempts a where a.person_id = kiosk_start.person;
  -- One answer for an unknown person, a wrong PIN and a lock, so the screen gives nothing away.
  -- A refusal is returned, not raised, so the count of wrong tries is kept.
  if tries.locked_until is not null and tries.locked_until > private.clock_now() then
    return jsonb_build_object('error', 'That PIN didn''t work. Try again, or clock on your phone.');
  end if;
  if p.id is null or hash is null or extensions.crypt(coalesce(kiosk_start.pin, ''), hash) <> hash then
    if p.id is not null then
      insert into public.daymark_kiosk_attempts as a (person_id, failures)
      values (p.id, 1)
      on conflict (person_id) do update
        set failures = case when a.locked_until is not null and a.locked_until <= private.clock_now() then 1 else a.failures + 1 end,
            locked_until = case when (case when a.locked_until is not null and a.locked_until <= private.clock_now() then 1
                                            else a.failures + 1 end) >= 5
                                then private.clock_now() + interval '15 minutes' end;
    end if;
    return jsonb_build_object('error', 'That PIN didn''t work. Try again, or clock on your phone.');
  end if;
  delete from public.daymark_kiosk_attempts a where a.person_id = p.id;

  if kiosk_start.event_type not in ('shift_in', 'shift_out', 'break_start', 'break_end') then
    raise exception 'Pick what you''re doing.' using errcode = '22023';
  end if;
  reason := private.clock_block_reason(p.id, kiosk_start.event_type, private.clock_now());
  if reason is not null then
    raise exception '%', reason using errcode = 'P0001';
  end if;
  perform private.require_clocking_consent(p.id);
  if kiosk_start.event_type = 'shift_in' then
    -- The first clock-in of a day needs Full day or Work-based: the kiosk asks, like the phone.
    if kiosk_start.day_kind is not null then
      perform private.save_day_kind(private.live_placement(p.id), private.darwin_today(), kiosk_start.day_kind);
    end if;
    perform private.require_day_kind(p.id);
  end if;

  insert into public.daymark_clock_challenges (person_id, event_type, gesture, issued_at, expires_at, kiosk_id)
  values (p.id, kiosk_start.event_type, gestures[1 + floor(random() * array_length(gestures, 1))::int],
          private.clock_now(), private.clock_now() + interval '90 seconds', (select auth.uid()))
  returning * into ch;
  return jsonb_build_object('challenge_id', ch.id, 'event_type', ch.event_type, 'gesture', ch.gesture,
    'expires_at', ch.expires_at, 'photo_path', p.id || '/' || ch.id || '.jpg', 'first_name', split_part(p.display_name, ' ', 1));
end;
$$;

-- The kiosk may upload exactly the photo of an open challenge it issued.
create or replace function private.kiosk_may_upload(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.daymark_clock_challenges c
    where c.kiosk_id = (select auth.uid()) and c.used_at is null and c.expires_at > private.clock_now()
      and kiosk_may_upload.name = c.person_id || '/' || c.id || '.jpg');
$$;

create policy "Kiosks upload the selfie for a challenge they issued" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'daymark-photos' and (select private.kiosk_may_upload(name)));

-- The punch: the person's, at the kiosk's site, with the selfie the kiosk just took.
create or replace function private.kiosk_punch(challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  site public.daymark_sites%rowtype := private.require_kiosk();
  ch public.daymark_clock_challenges%rowtype;
  path text;
  saved public.daymark_punches%rowtype;
begin
  select * into ch from public.daymark_clock_challenges c
  where c.id = kiosk_punch.challenge_id and c.kiosk_id = (select auth.uid())
  for update;
  if not found or ch.used_at is not null or private.clock_now() > ch.expires_at then
    raise exception 'That timed out. Start again.' using errcode = 'P0001';
  end if;
  path := ch.person_id || '/' || ch.id || '.jpg';
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'daymark-photos' and o.name = path and o.owner_id = (select auth.uid())::text
      and o.created_at between ch.issued_real_at and ch.issued_real_at + interval '3 minutes'
  ) then
    raise exception 'We didn''t get the selfie. Take it again.' using errcode = 'P0001';
  end if;
  update public.daymark_clock_challenges set used_at = private.clock_now() where id = ch.id;

  insert into public.daymark_punches (
    user_id, event_type, is_break, latitude, longitude, accuracy_m, photo_path, source, challenge_id, user_agent, kiosk_id
  ) values (
    ch.person_id,
    case ch.event_type when 'break_start' then 'shift_out' when 'break_end' then 'shift_in' else ch.event_type end,
    ch.event_type in ('break_start', 'break_end'),
    site.latitude, site.longitude, 10, path, 'device', ch.id, private.request_user_agent(), (select auth.uid())
  )
  returning * into saved;
  return jsonb_build_object('event', ch.event_type, 'occurred_at', saved.occurred_at,
    'first_name', (select split_part(p.display_name, ' ', 1) from public.daymark_profiles p where p.id = ch.person_id));
end;
$$;

-- Wrappers and grants.
create or replace function public.create_kiosk(display_name text, email text, password text, site uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_kiosk(display_name, email, password, site); $$;
create or replace function public.set_kiosk_pin(pin text)
returns void language sql security invoker set search_path = ''
as $$ select private.set_kiosk_pin(pin); $$;
create or replace function public.reset_kiosk_pin(person uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.reset_kiosk_pin(person); $$;
create or replace function public.kiosk_people()
returns table (person_id uuid, first_name text, initials text)
language sql stable security invoker set search_path = ''
as $$ select * from private.kiosk_people(); $$;
create or replace function public.kiosk_start(person uuid, pin text, event_type text, day_kind text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.kiosk_start(person, pin, event_type, day_kind); $$;
create or replace function public.kiosk_punch(challenge_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.kiosk_punch(challenge_id); $$;

revoke all on function private.require_kiosk() from public, anon;
revoke all on function private.create_kiosk(text, text, text, uuid) from public, anon;
revoke all on function private.set_kiosk_pin(text) from public, anon;
revoke all on function private.reset_kiosk_pin(uuid) from public, anon;
revoke all on function private.kiosk_people() from public, anon;
revoke all on function private.kiosk_start(uuid, text, text, text) from public, anon;
revoke all on function private.kiosk_may_upload(text) from public, anon;
revoke all on function private.kiosk_punch(uuid) from public, anon;
revoke all on function public.create_kiosk(text, text, text, uuid) from public, anon;
revoke all on function public.set_kiosk_pin(text) from public, anon;
revoke all on function public.reset_kiosk_pin(uuid) from public, anon;
revoke all on function public.kiosk_people() from public, anon;
revoke all on function public.kiosk_start(uuid, text, text, text) from public, anon;
revoke all on function public.kiosk_punch(uuid) from public, anon;
grant execute on function private.require_kiosk() to authenticated;
grant execute on function private.create_kiosk(text, text, text, uuid) to authenticated;
grant execute on function private.set_kiosk_pin(text) to authenticated;
grant execute on function private.reset_kiosk_pin(uuid) to authenticated;
grant execute on function private.kiosk_people() to authenticated;
grant execute on function private.kiosk_start(uuid, text, text, text) to authenticated;
grant execute on function private.kiosk_may_upload(text) to authenticated;
grant execute on function private.kiosk_punch(uuid) to authenticated;
grant execute on function public.create_kiosk(text, text, text, uuid) to authenticated;
grant execute on function public.set_kiosk_pin(text) to authenticated;
grant execute on function public.reset_kiosk_pin(uuid) to authenticated;
grant execute on function public.kiosk_people() to authenticated;
grant execute on function public.kiosk_start(uuid, text, text, text) to authenticated;
grant execute on function public.kiosk_punch(uuid) to authenticated;

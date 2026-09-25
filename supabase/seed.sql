-- Local seed only (never run against the hosted project). `supabase db reset` loads it after the
-- migrations. It replays about ten weeks of placement life day by day through the real rules:
-- device punches under the business clock, work logs, the 19:05/19:10 jobs, requests and
-- decisions made as the right person. Everything is relative to today (Darwin), so the data stays
-- realistic whenever the database is reset. Password for every account: Password-1234.

create schema if not exists seed;

create or replace function seed.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
end $$;

create or replace function seed.at(ts timestamptz) returns void language sql as $$
  select set_config('daymark.test_now', ts::text, true);
$$;

create or replace function seed.punch(uid uuid, event text, ts timestamptz) returns void language plpgsql as $$
declare
  jitter double precision := ((extract(doy from ts)::int * 7 + extract(minute from ts)::int) % 9 - 4) * 0.00004;
begin
  perform seed.at(ts);
  insert into public.daymark_punches (user_id, event_type, latitude, longitude, accuracy_m, photo_path, source)
  values (uid, event, -12.4785082 + jitter, 130.9854825 - jitter, 8 + (abs(jitter) * 100000)::int % 9,
          uid || '/' || gen_random_uuid() || '.jpg', 'device');
end $$;

create or replace function seed.work_log(pl uuid, d date) returns void language sql as $$
  insert into public.daymark_work_logs (placement_id, work_date, summary)
  values (pl, d, (array[
    'Researched competitor pricing for a retail client and summarised it in a one-page brief.',
    'Cleaned up the CRM export and tagged 120 leads by industry. Learned the dedupe workflow.',
    'Drafted three outreach emails with my supervisor and fixed the tone after feedback.',
    'Sat in on a discovery call and wrote up the notes. Learned how to ask follow-up questions.',
    'Built a simple dashboard of weekly enquiries in the spreadsheet template.'
  ])[1 + (extract(doy from d)::int % 5)])
  on conflict (placement_id, work_date) do nothing;
$$;

create or replace function seed.person(email text, name text, intern boolean, supervisor boolean, admin boolean)
returns uuid language plpgsql as $$
declare
  j jsonb;
begin
  j := private.create_person(name, email, 'Password-1234', intern, supervisor, admin);
  update public.daymark_profiles set must_change_password = false where id = (j ->> 'id')::uuid;
  return (j ->> 'id')::uuid;
end $$;

do $seed$
declare
  today date := private.darwin_today();
  s date := date_trunc('week', today)::date - 70;            -- Monday ten weeks ago
  admin uuid;
  sup1 uuid;
  sup2 uuid;
  dual uuid;
  i1 uuid; i2 uuid; i3 uuid; i4 uuid; i5 uuid; i6 uuid; i7 uuid;
  c1 uuid; c2 uuid; c3 uuid;
  site uuid := (select id from public.daymark_sites where name = 'Regus Palmerston');
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; p7 uuid; pd uuid;
  d date;
  r record;
  req jsonb;
  n integer := 0;
  late boolean;
  in_at timestamptz;
  out_at timestamptz;
  i3_days date[];
  auto_day date;
  a1_last date;
  ot_seen integer := 0;
  rid uuid;
begin
  -- People. The first admin is created directly (nobody can authorise it yet).
  admin := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', admin, 'authenticated', 'authenticated', 'admin@dgk.test',
    extensions.crypt('Password-1234', extensions.gen_salt('bf', 10)), now(), '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), false, false);
  insert into auth.identities (user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (admin, jsonb_build_object('sub', admin::text, 'email', 'admin@dgk.test', 'email_verified', true),
          'email', admin::text, now(), now(), now());
  insert into public.daymark_profiles (id, login_id, display_name, contact_email, is_admin)
  values (admin, 'admin', 'Dilip Sapkota', 'admin@dgk.test', true);

  perform seed.act_as(admin);
  sup1 := seed.person('sup1@dgk.test', 'Priya Raman', false, true, false);
  sup2 := seed.person('sup2@dgk.test', 'Tom Walsh', false, true, false);
  dual := seed.person('dual@dgk.test', 'Eli Brooks', true, true, false);
  i1 := seed.person('intern1@dgk.test', 'Aisha Khan', true, false, false);
  i2 := seed.person('intern2@dgk.test', 'Ben Nguyen', true, false, false);
  i3 := seed.person('intern3@dgk.test', 'Chloe Martin', true, false, false);
  i4 := seed.person('intern4@dgk.test', 'Dev Patel', true, false, false);
  i5 := seed.person('intern5@dgk.test', 'Fatima Ali', true, false, false);
  i6 := seed.person('intern6@dgk.test', 'Grace Lee', true, false, false);
  i7 := seed.person('intern7@dgk.test', 'Hana Sato', true, false, false);

  c1 := private.save_cohort(null, 'Winter 2026', s, 'CDU business interns');
  c2 := private.save_cohort(null, 'Spring 2026', s + 21, null);
  c3 := private.save_cohort(null, 'Summer 2026–27', today + 60, 'Starts after the Christmas break');

  -- Consent for everyone who clocks in (as each intern).
  foreach rid in array array[i1, i2, i3, i4, i5, i6, i7, dual] loop
    perform seed.act_as(rid);
    perform private.record_consent('collection_notice', 'acknowledged', null);
    perform private.record_consent('location', 'granted', null);
    perform private.record_consent('selfie', 'granted', null);
  end loop;

  -- Placements (≤ 3 per weekday at the office). Pattern days: Mon 1 … Fri 5.
  perform seed.act_as(admin);
  perform seed.at(private.darwin_at(s - 3, '09:00'));
  p1 := private.save_placement(jsonb_build_object('intern_id', i1, 'supervisor_id', sup1, 'cohort_id', c1,
    'university', 'Charles Darwin University', 'course', 'Bachelor of Business', 'uni_coordinator_name', 'Dr Sarah Cole',
    'uni_coordinator_email', 'sarah.cole@cdu.test', 'start_date', s, 'planned_end_date', s + 7 * 13 - 3, 'target_minutes', 17550,
    'pattern', '[{"weekday":1,"start":"09:00","end":"17:00"},{"weekday":3,"start":"09:00","end":"17:00"},{"weekday":5,"start":"09:00","end":"17:00"}]'::jsonb), false);
  p2 := private.save_placement(jsonb_build_object('intern_id', i2, 'supervisor_id', sup1, 'cohort_id', c1,
    'university', 'Charles Darwin University', 'course', 'Bachelor of IT', 'start_date', s, 'planned_end_date', s + 7 * 14 - 3,
    'target_minutes', 12600, 'pattern', '[{"weekday":2,"start":"09:00","end":"17:00"},{"weekday":4,"start":"09:00","end":"17:00"}]'::jsonb), false);
  p3 := private.save_placement(jsonb_build_object('intern_id', i3, 'supervisor_id', sup2, 'cohort_id', c1,
    'university', 'Flinders University', 'course', 'Bachelor of Commerce', 'start_date', s, 'planned_end_date', s + 7 * 12 - 3,
    'target_minutes', 16200, 'pattern', '[{"weekday":1,"start":"08:30","end":"16:30"},{"weekday":2,"start":"08:30","end":"16:30"},{"weekday":3,"start":"08:30","end":"16:30"}]'::jsonb), false);
  p4 := private.save_placement(jsonb_build_object('intern_id', i4, 'supervisor_id', sup2, 'cohort_id', c2,
    'university', 'Charles Darwin University', 'course', 'Bachelor of Accounting', 'start_date', s, 'planned_end_date', today - 7,
    'target_minutes', 14400, 'pattern', '[{"weekday":3,"start":"09:00","end":"15:00"},{"weekday":4,"start":"09:00","end":"15:00"},{"weekday":5,"start":"09:00","end":"15:00"}]'::jsonb), false);
  pd := private.save_placement(jsonb_build_object('intern_id', dual, 'supervisor_id', sup1, 'cohort_id', c2,
    'university', 'Charles Darwin University', 'course', 'Master of Business Administration', 'start_date', s + 14,
    'planned_end_date', s + 7 * 16 - 3, 'target_minutes', 3360, 'pattern', '[{"weekday":2,"start":"10:00","end":"14:00"}]'::jsonb), false);
  p5 := private.save_placement(jsonb_build_object('intern_id', i5, 'supervisor_id', sup2, 'cohort_id', c1,
    'university', 'Charles Darwin University', 'course', 'Bachelor of Laws', 'start_date', s, 'planned_end_date', s + 7 * 11 - 3,
    'target_minutes', 3600, 'pattern', '[{"weekday":5,"start":"09:00","end":"17:00"}]'::jsonb), false);
  p6 := private.save_placement(jsonb_build_object('intern_id', i6, 'supervisor_id', sup1, 'cohort_id', c1,
    'university', 'Charles Darwin University', 'course', 'Bachelor of Business', 'start_date', s, 'planned_end_date', today - 13,
    'target_minutes', 3150, 'pattern', '[{"weekday":1,"start":"09:00","end":"17:00"}]'::jsonb), false);
  p7 := private.save_placement(jsonb_build_object('intern_id', i7, 'supervisor_id', sup2, 'cohort_id', c1,
    'university', 'Flinders University', 'course', 'Bachelor of Business', 'start_date', s, 'planned_end_date', s + 7 * 10 - 3,
    'target_minutes', 4500, 'pattern', '[{"weekday":4,"start":"09:00","end":"17:00"}]'::jsonb), false);

  -- The intern with no-shows: the last two of their days before today are missed, the one before
  -- that forgot to clock out (auto-closed, D3) and asks for a punch fix.
  select array_agg(work_date order by work_date desc) into i3_days
  from public.daymark_scheduled_days where placement_id = p3 and work_date < today and status = 'scheduled';
  auto_day := i3_days[3];
  select max(work_date) into a1_last from public.daymark_scheduled_days
  where placement_id = p1 and work_date < today and status = 'scheduled';

  -- Targets: on-track interns get a 10% margin over their schedule; at-risk personas stay tight.
  update public.daymark_placements p set target_minutes = (
    select (round(sum(sd.planned_minutes) * case when p.id in (p1, pd, p3) then 0.9 when p.id = p4 then 1.0 else 1.0 end / 15) * 15)::integer
           + case when p.id = p4 then 4200 else 0 end
    from public.daymark_scheduled_days sd where sd.placement_id = p.id and sd.status = 'scheduled')
  where p.id in (p1, p2, p3, p4, pd);

  -- Replay each weekday.
  for d in select g::date from generate_series(s, today - 1, interval '1 day') g loop

    -- Requests made in the morning, before anyone clocks in.
    perform seed.at(private.darwin_at(d, '07:30'));
    if d = s + 29 then                                          -- Eli: sick on this Tuesday (hours stay owed)
      perform seed.act_as(dual);
      req := private.create_request('leave', jsonb_build_object('dates', jsonb_build_array(s + 29), 'kind', 'sick'), 'Flu, doctor''s certificate');
      perform seed.act_as(sup1);
      perform private.decide_request((req ->> 'id')::uuid, 'approve', 'Get well soon.', null);
    end if;
    if d = s + 49 then                                          -- Aisha books an extra Thursday
      perform seed.act_as(i1);
      req := private.create_request('extra_day', jsonb_build_object('date', s + 52, 'start', '09:00', 'end', '17:00'),
        'Extra day to get ahead before exams.');
      perform seed.act_as(sup1);
      perform private.decide_request((req ->> 'id')::uuid, 'approve', null, null);
    end if;
    if d = today - 10 and exists (select 1 from public.daymark_placements where id = p4 and status in ('active', 'extended')) then
      perform seed.act_as(sup2);                                -- Dev needs more time: extend three weeks
      perform private.extend_placement(p4, today + 21, 'More hours needed for the uni requirement', false);
    end if;
    if d = today - 13 then
      perform seed.act_as(sup1);                                -- Grace finishes: day 13 after the end today
      perform private.confirm_completion(p6, 'Great placement. Hours complete.');
      perform private.approve_uni_report(p6, 'Hours checked against the schedule.');
    end if;
    if d = today - 31 then
      perform seed.act_as(sup2);                                -- Hana withdraws: due for deletion today
      perform private.withdraw_placement(p7, 'Moved interstate for family reasons.');
    end if;

    -- Punches for everyone scheduled today, by persona.
    for r in
      select sd.placement_id, sd.start_time, sd.end_time, p.intern_id
      from public.daymark_scheduled_days sd
      join public.daymark_placements p on p.id = sd.placement_id
      where sd.work_date = d and sd.status = 'scheduled' and p.status in ('active', 'extended')
      order by p.intern_id
    loop
      continue when r.intern_id = i3 and d = any (i3_days[1:2]);                      -- no-shows
      late := (extract(doy from d)::int + ascii(left(r.intern_id::text, 1))) % 9 = 0;
      in_at := private.darwin_at(d, r.start_time) + case when late then interval '22 minutes' else interval '-3 minutes' end;
      out_at := private.darwin_at(d, r.end_time) - interval '3 minutes'   -- same length as planned: no overtime
                + case when late then interval '25 minutes' else interval '0' end;  -- late arrivals stay late (R5.4.11)
      if r.intern_id = i2 and extract(day from d)::int % 2 = 0 then
        out_at := private.darwin_at(d, r.end_time) - interval '2 hours';              -- Ben leaves early → owed
      end if;
      if r.intern_id = i1 and d in (s + 25, s + 39, a1_last) then
        out_at := out_at + case d when s + 25 then interval '60 minutes' when s + 39 then interval '90 minutes'
                                  else interval '45 minutes' end;                     -- Aisha's overtime
      end if;
      perform seed.punch(r.intern_id, 'shift_in', in_at);
      if not (r.intern_id = i3 and d = auto_day) then                                 -- Chloe forgets once
        perform seed.punch(r.intern_id, 'shift_out', least(out_at, private.darwin_at(d, '19:00')));
      end if;
      perform seed.work_log(r.placement_id, d);
      n := n + 1;
    end loop;

    -- Ben's unscheduled Wednesday two weeks ago → all overtime, left pending.
    if d = date_trunc('week', today)::date - 12 then
      perform seed.punch(i2, 'shift_in', private.darwin_at(d, '10:00'));
      perform seed.punch(i2, 'shift_out', private.darwin_at(d, '13:00'));
      perform seed.work_log(p2, d);
    end if;

    continue when extract(isodow from d) > 5;
    -- 19:05 auto-close, 19:10 day close (overtime requests, no-shows, target reached).
    perform seed.act_as(null);
    perform seed.at(private.darwin_at(d, '19:05'));
    perform private.job_auto_close();
    perform seed.at(private.darwin_at(d, '19:10'));
    perform private.job_day_close();

    -- Supervisors decide overtime the next morning: approve the first, part of the second.
    for r in select x.id, x.requested_minutes, x.dates[1] as work_date from public.daymark_requests x
             where x.intern_id = i1 and x.type = 'overtime' and x.status = 'pending_supervisor' and x.dates[1] < d
               and x.requested_minutes >= 30 and x.dates[1] < today - 3 loop
      ot_seen := ot_seen + 1;
      perform seed.at(private.darwin_at(d, '19:20'));
      perform seed.act_as(sup1);
      if ot_seen = 1 then
        perform private.decide_request(r.id, 'approve', 'Thanks for staying for the client call.', r.requested_minutes);
      elsif ot_seen = 2 then
        perform private.decide_request(r.id, 'approve', 'Approving the first 45 minutes.', 45);
      end if;
    end loop;
  end loop;

  -- Today's open items for the inboxes (made "yesterday" morning at the latest).
  perform seed.at(private.darwin_at(today - 1, '08:00'));
  perform seed.act_as(i3);                                      -- punch fix for the auto-closed day
  if auto_day is not null and auto_day >= today - 7 then
    perform private.create_request('punch_fix', jsonb_build_object('date', auto_day, 'clock_out', '16:30',
      'replaces_out_punch_id', (select x.id from public.daymark_punches x where x.user_id = i3 and x.source = 'auto_close'
                                order by x.occurred_at desc limit 1)),
      'I forgot to clock out after the team meeting ran late.');
  end if;
  perform seed.at(private.darwin_at(today - 4, '08:00'));
  perform seed.act_as(i3);                                      -- personal leave waiting > 72 h → escalated
  select min(work_date) into d from public.daymark_scheduled_days
  where placement_id = p3 and status = 'scheduled' and work_date > today + 1;
  if d is not null then
    perform private.create_request('leave', jsonb_build_object('dates', jsonb_build_array(d), 'kind', 'personal'),
      'Family wedding in Katherine.');
  end if;
  perform seed.at(private.darwin_at(today - 1, '09:00'));
  perform seed.act_as(i2);                                      -- Ben asks for longer days next week
  select min(id::text)::uuid into rid from public.daymark_scheduled_days
  where placement_id = p2 and status = 'scheduled' and work_date > today + 2;
  if rid is not null then
    perform private.create_request('shift_change', jsonb_build_object('scheduled_day_id', rid, 'start', '08:00', 'end', '17:00'),
      'Catching up on hours I owe.');
  end if;

  -- Eli's weekly check-in is low (at-risk reason low_checkin).
  insert into public.daymark_checkins (placement_id, supervisor_id, week_start, reliability, quality, communication, comment)
  values (pd, sup1, date_trunc('week', today)::date - 7, 2, 3, 2, 'Missed two stand-ups; let''s set reminders.');

  -- Back to the real clock; escalate anything waiting over 72 h; reconcile the cache.
  perform set_config('daymark.test_now', '', true);
  perform seed.act_as(null);
  perform private.job_escalate();
  perform private.job_reconcile();
  raise notice 'seed: % shifts replayed from % to %', n, s, today - 1;
end
$seed$;

drop schema seed cascade;

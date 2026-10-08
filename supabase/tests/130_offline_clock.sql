begin;
select plan(20);

-- Offline clocks (Dilip, 8 Oct; D35): the phone sends a queued clock with its own time, GPS and a selfie;
-- it waits for the supervisor like a typed-in time and counts once confirmed.
create temp table ids as
select tests.create_person('off.admin@test.dev', false, false, true) as admin,
       tests.create_intern('off.a@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as a,
       tests.create_intern('off.b@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as b,
       gen_random_uuid() as k1, gen_random_uuid() as k2, gen_random_uuid() as k3, gen_random_uuid() as k4,
       gen_random_uuid() as other_photo;
grant select on ids to authenticated;
select tests.consent_all(a) from ids;
select tests.consent_all(b) from ids;

-- The selfies the phone uploaded when the signal came back (k4 is never uploaded).
insert into storage.objects (bucket_id, name, owner, owner_id, created_at)
select 'daymark-photos', a || '/' || k, a, a::text, now() from ids, unnest(array[k1, k2, k3]) k;
insert into storage.objects (bucket_id, name, owner, owner_id, created_at)
select 'daymark-photos', b || '/' || other_photo || '.jpg', b, b::text, now() from ids;
update storage.objects set name = name || '.jpg' where bucket_id = 'daymark-photos' and name !~ '\.jpg$';

-- Monday 12 Oct: no signal at the office. The phone sends everything at 1:00 pm.
select tests.at('2026-10-12 13:00+09:30');
select tests.as_person((select a from ids));
select throws_ok($$select public.submit_offline_punch((select k1 from ids), 'shift_in', '2026-10-12 09:02+09:30',
  -12.4785, 130.9855, 12, 'Give a thumbs up', null)$$, 'P0001', 'Pick Full day or Work-based before you clock in.',
  'the first clock-in carries the day''s kind');
select lives_ok($$select public.submit_offline_punch((select k1 from ids), 'shift_in', '2026-10-12 09:02+09:30',
  -12.4785, 130.9855, 12, 'Give a thumbs up', 'full_day')$$, 'an offline clock-in is accepted');
select is((public.submit_offline_punch((select k1 from ids), 'shift_in', '2026-10-12 09:02+09:30',
  -12.4785, 130.9855, 12, 'Give a thumbs up', 'full_day') ->> 'offline_id')::uuid, (select k1 from ids),
  'sending it again returns the same clock');
select lives_ok($$select public.submit_offline_punch((select k2 from ids), 'break_start', '2026-10-12 12:00+09:30',
  -12.4785, 130.9855, 12, 'Touch your left ear', null)$$, 'an offline break start is accepted');
select throws_ok($$select public.submit_offline_punch((select k4 from ids), 'break_end', '2026-10-12 12:40+09:30',
  -12.4785, 130.9855, 12, null, null)$$, 'P0001', null, 'a clock without its selfie is refused');
select throws_ok($$select public.submit_offline_punch((select other_photo from ids), 'break_end', '2026-10-12 12:40+09:30',
  -12.4785, 130.9855, 12, null, null)$$, 'P0001', null, 'someone else''s selfie doesn''t count');
select throws_ok($$select public.submit_offline_punch(gen_random_uuid(), 'break_end', '2026-10-12 13:30+09:30',
  -12.4785, 130.9855, 12, null, null)$$, '22023', 'That clock''s time is in the future. Check your phone''s clock.',
  'no clocks from the future');
select throws_ok($$select public.submit_offline_punch(gen_random_uuid(), 'shift_in', '2026-10-10 09:00+09:30',
  -12.4785, 130.9855, 12, null, 'full_day')$$, '22023', null, 'nothing more than 2 days old');
reset role;

select is((select count(*)::int from public.daymark_punches where user_id = (select a from ids)), 2, 'two clocks saved, once each');
select is((select string_agg(verification_method || '/' || source || '/' || coalesce(confirmed_at::text, 'waiting'), ','
           order by occurred_at) from public.daymark_punches where user_id = (select a from ids)),
  'offline/supervisor/waiting,offline/supervisor/waiting', 'both wait for the supervisor');
select is((select kind from public.daymark_day_kinds where placement_id = tests.placement((select a from ids))), 'full_day',
  'the day''s kind came with the clock-in');
select ok((select reason from public.daymark_requests where intern_id = (select a from ids) order by created_at limit 1)
  like 'Offline: clocked in offline at 9:02 am (phone time) on Mon 12 Oct, % from %, gesture "Give a thumbs up". Sent 1:00 pm.',
  'the request says when, how far and which gesture');
select ok(exists (select 1 from public.daymark_notifications where person_id = tests.supervisor() and kind = 'attendance'
                  and title like '%clocked offline')
          and exists (select 1 from public.daymark_notifications where person_id = (select admin from ids) and kind = 'attendance'),
  'the supervisor and the admin are told');

-- The intern's sequence still holds: a second break start while on a break is refused.
select tests.as_person((select a from ids));
select throws_ok($$select public.submit_offline_punch((select k3 from ids), 'break_start', '2026-10-12 12:30+09:30',
  -12.4785, 130.9855, 12, null, null)$$, 'P0001', 'Clock in before you clock out.', 'the clock order still applies');
reset role;
select tests.as_person((select a from ids));
select lives_ok($$select public.submit_offline_punch((select k3 from ids), 'break_end', '2026-10-12 12:30+09:30',
  -12.4785, 130.9855, 12, null, null)$$, 'ending the break offline is fine');
reset role;
select tests.clock((select a from ids), 'shift_out', '2026-10-12 17:00+09:30');
select is((tests.day((select a from ids), '2026-10-12')).counted, 0, 'offline clocks count 0 until confirmed');

-- Tuesday: the supervisor confirms all three the next day.
select tests.at('2026-10-13 08:30+09:30');
select tests.as_person(tests.supervisor());
select lives_ok($$select public.decide_request(r.id, 'approve', null, null) from public.daymark_requests r
  where r.intern_id = (select a from ids) and r.type = 'attendance'$$, 'the supervisor confirms them the next day');
reset role;
select is((select count(*)::int from public.daymark_punches where user_id = (select a from ids) and source = 'supervisor' and confirmed_at is null), 0,
  'all confirmed');
select results_eq($$select raw, counted from tests.day((select a from ids), '2026-10-12')$$,
  $$values (448, 448)$$, 'confirmed, the day counts (9:02–12:00 and 12:30–5:00)');

-- Someone else can't reuse another intern's offline id.
select tests.as_person((select b from ids));
select throws_ok($$select public.submit_offline_punch((select k1 from ids), 'shift_in', '2026-10-13 08:00+09:30',
  -12.4785, 130.9855, 12, null, 'full_day')$$, '42501', null, 'an offline id belongs to one intern');
reset role;

select * from finish();
rollback;

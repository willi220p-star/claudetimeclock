begin;
select plan(18);

-- Kiosk mode (Dilip, 12 Oct; D42).
create temp table ids as
select tests.create_person('kiosk.admin@test.dev', false, false, true) as admin,
       tests.create_intern('kiosk.a@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as a,
       tests.create_intern('kiosk.b@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as b;
grant select on ids to authenticated;
select tests.without_seed();
select tests.consent_all(a) from ids;
create temp table k (id uuid, ch uuid);
grant all on k to authenticated;

-- The admin makes a kiosk for A's office.
select tests.as_person((select admin from ids));
insert into k (id) select (public.create_kiosk('Front desk tablet', 'kiosk.desk@test.dev', 'Kiosk-password-123',
  (select site_id from public.daymark_placements where intern_id = (select a from ids))) ->> 'id')::uuid;
reset role;
select ok((select is_kiosk and not (is_intern or is_supervisor or is_admin) from public.daymark_profiles where id = (select id from k)),
  'a kiosk holds no role');

-- PINs.
select tests.as_person((select a from ids));
select throws_ok($$select public.set_kiosk_pin('12a')$$, '22023', null, 'a PIN is 4 to 6 digits');
select lives_ok($$select public.set_kiosk_pin('2468')$$, 'an intern sets a PIN');
select throws_ok($$select pin_hash from public.daymark_kiosk_pins$$, '42501', null, 'nobody can read PIN hashes');
reset role;
select tests.as_person((select b from ids));
select public.set_kiosk_pin('1357');
reset role;

-- What the kiosk sees: first names at its own office, nothing else.
select tests.as_person((select id from k));
select is((select count(*)::int from public.kiosk_people()), 1, 'only interns placed at its office');
select is((select count(*)::int from public.daymark_punches), 0, 'no punches visible');
select is((select count(*)::int from public.daymark_profiles where id <> (select id from k)), 0, 'no other profiles visible');
reset role;
select tests.as_person((select a from ids));
select throws_ok($$select * from public.kiosk_people()$$, '42501', null, 'an intern''s phone isn''t a kiosk');
reset role;

-- Wrong PINs lock after 5, with one message whatever the cause.
select tests.at('2026-10-12 08:55+09:30');
select tests.as_person((select id from k));
select is(public.kiosk_start((select b from ids), '1357', 'shift_in') ->> 'error',
  'That PIN didn''t work. Try again, or clock on your phone.', 'an intern from another office is refused like a wrong PIN');
select is(public.kiosk_start((select a from ids), '0000', 'shift_in') ->> 'error',
  'That PIN didn''t work. Try again, or clock on your phone.', 'wrong PIN');

reset role;
-- Four more wrong tries.
select tests.as_person((select id from k));
select ok(public.kiosk_start((select a from ids), '0001', 'shift_in') ? 'error', 'wrong try 2');
select ok(public.kiosk_start((select a from ids), '0002', 'shift_in') ? 'error', 'wrong try 3');
select ok(public.kiosk_start((select a from ids), '0003', 'shift_in') ? 'error', 'wrong try 4');
select ok(public.kiosk_start((select a from ids), '0004', 'shift_in') ? 'error', 'wrong try 5');
select ok(public.kiosk_start((select a from ids), '2468', 'shift_in') ? 'error', 'locked: even the right PIN is refused');
reset role;

-- 16 minutes later the right PIN works; the punch is A's, at the office, marked kiosk.
select tests.at('2026-10-12 09:12+09:30');
select tests.as_person((select id from k));
select throws_ok(format('select public.kiosk_start(%L, %L, %L)', (select a from ids), '2468', 'shift_in'), 'P0001',
  'Pick Full day or Work-based before you clock in.', 'the first clock-in asks for the day type');
update k set ch = (public.kiosk_start((select a from ids), '2468', 'shift_in', 'full_day') ->> 'challenge_id')::uuid;
reset role;
insert into storage.objects (bucket_id, name, owner, owner_id, created_at)
select 'daymark-photos', (select a from ids) || '/' || ch || '.jpg', id, id::text, now() from k;
select tests.as_person((select id from k));
select lives_ok(format('select public.kiosk_punch(%L)', (select ch from k)), 'the kiosk clocks A in');
reset role;
select is((select verification_method || '/' || cardinality(flags) || '/' || (kiosk_id = (select id from k))
           from public.daymark_punches where user_id = (select a from ids)), 'kiosk/0/true', 'a kiosk punch, no GPS flags');

select * from finish();
rollback;

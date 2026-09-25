begin;
select plan(30);

-- Phase 7: sites (§6, §10, §11.3). Admin only, validated, audited with before/after.
insert into public.daymark_sites (id, name, address, latitude, longitude)
values ('00000000-0000-0000-0000-0000000051e0', 'Busy site', 'Test', -12.4785082, 130.9854825);
create temp table ids as
select tests.create_person('site.admin@test.dev', false, false, true) as admin,
       tests.create_person('site.sup@test.dev', false, true, false) as sup,
       tests.create_person('site.int@test.dev') as intern,
       tests.create_intern('site.i1@test.dev', '00000000-0000-0000-0000-0000000051e0', '{3}', '2026-10-12', '2026-10-16') as i1,
       tests.create_intern('site.i2@test.dev', '00000000-0000-0000-0000-0000000051e0', '{3}', '2026-10-12', '2026-10-16') as i2,
       tests.create_intern('site.i3@test.dev', '00000000-0000-0000-0000-0000000051e0', '{3}', '2026-10-12', '2026-10-16') as i3;
grant select on ids to authenticated;
create temp table res (k text primary key, v jsonb);
grant all on res to authenticated;
select tests.at('2026-10-01 10:00+09:30');

-- §6 only an admin manages sites
select tests.as_person((select intern from ids));
select throws_ok($$select public.save_site('{"name":"X"}')$$, '42501', null, 'an intern cannot save a site');
select throws_ok($$select public.set_site_active('00000000-0000-0000-0000-0000000051e0', false)$$, '42501', null,
  'an intern cannot turn a site off');
reset role;
select tests.as_person((select sup from ids));
select throws_ok($$select public.save_site('{"name":"X"}')$$, '42501', null, 'a supervisor cannot save a site');
select throws_ok($$select public.set_site_active('00000000-0000-0000-0000-0000000051e0', false)$$, '42501', null,
  'a supervisor cannot turn a site off');
reset role;

-- Create: missing keys take the defaults; id and active from the client are ignored
select tests.as_person((select admin from ids));
insert into res select 'darwin', public.save_site(
  '{"id":null,"name":"  Darwin CBD ","address":"1 Smith St, Darwin NT 0800","latitude":-12.4634,"longitude":130.8456,"active":false}');
reset role;
select is((select v - 'id' - 'created_at' from res where k = 'darwin'),
  '{"name":"Darwin CBD","address":"1 Smith St, Darwin NT 0800","latitude":-12.4634,"longitude":130.8456,"radius_m":200,
    "standard_capacity":3,"hard_capacity":4,"window_start":"07:00:00","window_end":"19:00:00","active":true}'::jsonb,
  'a new site gets the default radius, capacity and window, and starts open');
select ok((select before is null and after ->> 'name' = 'Darwin CBD' from public.daymark_audit_log
           where action = 'create_site' and row_id = (select v ->> 'id' from res where k = 'darwin')),
  'creating a site is audited');

-- Update: only the keys sent change
select tests.as_person((select admin from ids));
insert into res select 'darwin2', public.save_site(jsonb_build_object('id', (select v ->> 'id' from res where k = 'darwin'),
  'radius_m', 150, 'standard_capacity', 2, 'hard_capacity', 3, 'window_start', '07:30', 'window_end', '18:00'));
reset role;
select is((select v - 'created_at' from res where k = 'darwin2'),
  (select (v - 'created_at') || '{"radius_m":150,"standard_capacity":2,"hard_capacity":3,"window_start":"07:30:00","window_end":"18:00:00"}'
   from res where k = 'darwin'),
  'an update changes only the keys sent');
select is((select array[before ->> 'radius_m', after ->> 'radius_m'] from public.daymark_audit_log
           where action = 'update_site' and row_id = (select v ->> 'id' from res where k = 'darwin')),
  array['200', '150'], 'the update is audited with before and after');

-- Validation
select tests.as_person((select admin from ids));
select throws_ok($$select public.save_site('{"address":"A","latitude":-12,"longitude":130}')$$,
  '22023', 'Give the site a name up to 80 characters.', 'a site needs a name');
select throws_ok($$select public.save_site('{"name":"A","address":" ","latitude":-12,"longitude":130}')$$,
  '22023', 'Enter the site''s address, up to 240 characters.', 'a site needs an address');
select throws_ok($$select public.save_site('{"name":"A","address":"B","latitude":-91,"longitude":130}')$$,
  '22023', 'Enter a latitude from -90 to 90 and a longitude from -180 to 180.', 'latitude is checked');
select throws_ok($$select public.save_site('{"name":"A","address":"B","latitude":-12,"longitude":"far"}')$$,
  '22023', 'Check the site details: numbers for the location, radius and capacity, and times like 07:00.',
  'a value of the wrong type gets a friendly message');
select throws_ok($$select public.save_site('{"name":"A","address":"B","latitude":-12,"longitude":130,"radius_m":19}')$$,
  '22023', 'Set the geofence radius between 20 and 2,000 metres.', 'radius at least 20 m');
select throws_ok($$select public.save_site('{"name":"A","address":"B","latitude":-12,"longitude":130,"radius_m":2001}')$$,
  '22023', 'Set the geofence radius between 20 and 2,000 metres.', 'radius at most 2,000 m');
select throws_ok($$select public.save_site('{"name":"A","address":"B","latitude":-12,"longitude":130,"standard_capacity":0}')$$,
  '22023', 'Set the standard capacity between 1 and 50.', 'standard capacity at least 1');
select throws_ok($$select public.save_site('{"name":"A","address":"B","latitude":-12,"longitude":130,"standard_capacity":3,"hard_capacity":2}')$$,
  '22023', 'Set the hard limit between the standard capacity and 50.', 'hard limit at least the standard capacity');
select throws_ok($$select public.save_site('{"name":"A","address":"B","latitude":-12,"longitude":130,"window_start":"19:00","window_end":"07:00"}')$$,
  '22023', 'The clock-in window must start before it ends, between 00:00 and 23:59, in 15-minute steps.',
  'the window starts before it ends');
select throws_ok($$select public.save_site('{"name":"A","address":"B","latitude":-12,"longitude":130,"window_start":"07:10"}')$$,
  '22023', 'The clock-in window must start before it ends, between 00:00 and 23:59, in 15-minute steps.',
  'the window uses 15-minute steps');
select throws_ok($$select public.save_site('{"name":"A","address":"B","latitude":-12,"longitude":130,"window_end":"24:00"}')$$,
  '22023', 'The clock-in window must start before it ends, between 00:00 and 23:59, in 15-minute steps.',
  'the window ends by 23:59');
select throws_ok($$select public.save_site('{"id":"00000000-0000-0000-0000-000000000bad","name":"A"}')$$,
  '22023', 'That site doesn''t exist.', 'an unknown site id is rejected');
-- R5.3.5 never leave a booked day above the hard limit
select throws_ok($$select public.save_site('{"id":"00000000-0000-0000-0000-0000000051e0","standard_capacity":2,"hard_capacity":2}')$$,
  '22023', 'Wed 14 Oct already has 3 interns booked. Set the hard limit to at least 3, or move someone first.',
  'the hard limit cannot drop below a booked day');
select lives_ok($$select public.save_site('{"id":"00000000-0000-0000-0000-0000000051e0","standard_capacity":2,"hard_capacity":3}')$$,
  'the standard capacity can drop below a booked day');
reset role;

-- set_site_active
select tests.as_person((select admin from ids));
select throws_ok($$select public.set_site_active('00000000-0000-0000-0000-0000000051e0', false)$$,
  '22023', 'This site has 3 live placements. Move or end them before you turn the site off.',
  'a site with live placements stays on');
select is((public.set_site_active((select (v ->> 'id')::uuid from res where k = 'darwin'), false)) ->> 'active', 'false',
  'an empty site can be turned off');
reset role;
select is((select array[before ->> 'active', after ->> 'active'] from public.daymark_audit_log
           where action = 'set_site_active' and row_id = (select v ->> 'id' from res where k = 'darwin')),
  array['true', 'false'], 'turning a site off is audited');
select tests.as_person((select admin from ids));
select is((public.set_site_active((select (v ->> 'id')::uuid from res where k = 'darwin'), true)) ->> 'active', 'true',
  'and back on');
reset role;
update public.daymark_sites set active = false where id <> (select (v ->> 'id')::uuid from res where k = 'darwin');
select tests.as_person((select admin from ids));
select throws_ok($$select public.set_site_active((select (v ->> 'id')::uuid from res where k = 'darwin'), false)$$,
  '22023', 'Keep at least one site open.', 'the last open site stays on');
select throws_ok($$select public.set_site_active('00000000-0000-0000-0000-000000000bad', true)$$,
  '22023', 'That site doesn''t exist.', 'an unknown site is rejected');
reset role;

-- anon can run none of it
select ok(not has_function_privilege('anon', 'public.save_site(jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.set_site_active(uuid, boolean)', 'execute')
      and not has_function_privilege('anon', 'private.save_site(jsonb)', 'execute')
      and not has_function_privilege('anon', 'private.set_site_active(uuid, boolean)', 'execute'),
  'anon cannot execute the site RPCs');
select tests.as_anon();
select throws_ok($$select public.save_site('{"name":"X"}')$$, '42501', null, 'anon cannot save a site');
reset role;

select * from finish();
rollback;

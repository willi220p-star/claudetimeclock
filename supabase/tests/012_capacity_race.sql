-- R5.3.6 / §8.5: two approvals racing for the last spot. No wrapping transaction: dblink
-- sessions must see committed rows, so this file commits a fixture and cleans it up.
create extension if not exists dblink with schema extensions;
select plan(3);

delete from auth.users where email like 'race%@test.dev';
delete from public.daymark_sites where name = 'Race site';
insert into public.daymark_sites (id, name, address, latitude, longitude)
values ('00000000-0000-0000-0000-0000000ace00', 'Race site', 'Test', -12.4785082, 130.9854825);
select tests.create_intern('race' || n || '@test.dev', '00000000-0000-0000-0000-0000000ace00', '{3}', '2026-10-12', '2026-10-16')
from generate_series(1, 3) n;
select tests.create_intern('race' || n || '@test.dev', '00000000-0000-0000-0000-0000000ace00', '{1}', '2026-10-12', '2026-10-16')
from generate_series(4, 5) n;

create temp table race_conn as
select format('host=%s port=%s dbname=postgres user=postgres password=postgres',
              host(inet_server_addr()), inet_server_port()) as dsn;

select extensions.dblink_connect('race_a', dsn) from race_conn;
select extensions.dblink_connect('race_b', dsn) from race_conn;
select extensions.dblink_exec('race_a', 'begin');
select * from extensions.dblink('race_a', format(
  'select private.add_scheduled_day(%L, %L, %L, %L, %L, null, true)',
  (select p.id from public.daymark_placements p join public.daymark_profiles x on x.id = p.intern_id where x.contact_email = 'race4@test.dev'),
  '2026-10-14', '09:00', '17:00', 'extra_day')) as t(id uuid);
-- B asks for the same last spot while A holds the lock; it waits.
select extensions.dblink_send_query('race_b', format(
  'select private.add_scheduled_day(%L, %L, %L, %L, %L, null, true)',
  (select p.id from public.daymark_placements p join public.daymark_profiles x on x.id = p.intern_id where x.contact_email = 'race5@test.dev'),
  '2026-10-14', '09:00', '17:00', 'extra_day'));
select ok(extensions.dblink_is_busy('race_b') = 1, 'the second approval waits on the site-date lock');
select extensions.dblink_exec('race_a', 'commit');
select * from extensions.dblink_get_result('race_b', false) as t(id uuid);
select matches(extensions.dblink_error_message('race_b'), 'office limit', 'the second approval fails once the first commits');
select is((select count(*)::int from public.daymark_scheduled_days
           where site_id = '00000000-0000-0000-0000-0000000ace00' and work_date = '2026-10-14' and status = 'scheduled'), 4,
  'exactly four interns on the day');

select extensions.dblink_disconnect('race_a');
select extensions.dblink_disconnect('race_b');
delete from auth.users where email like 'race%@test.dev';
delete from public.daymark_sites where name = 'Race site';
select * from finish();

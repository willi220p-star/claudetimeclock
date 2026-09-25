begin;
select plan(10);

-- §14 / review §4.1: every table in exposed schemas has RLS; anon can read nothing and run nothing.
select is(array(select c.relname::text from pg_class c
                where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
                order by 1),
          '{}'::text[], 'every public table has RLS enabled');
select is(array(select c.relname::text from pg_class c
                where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
                  and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
                       or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))
                order by 1),
          '{}'::text[], 'anon has no table privileges');
select is(array(select p.oid::regprocedure::text from pg_proc p
                where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')
                order by 1),
          '{}'::text[], 'anon can execute no public function');
select is(array(select p.oid::regprocedure::text from pg_proc p
                where p.pronamespace = 'public'::regnamespace and p.prosecdef
                order by 1),
          '{}'::text[], 'no SECURITY DEFINER function lives in public');
select is(array(select c.relname::text from pg_class c
                where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
                  and not coalesce('security_invoker=true' = any(c.reloptions), false)
                order by 1),
          '{}'::text[], 'every public view is security_invoker');

-- New objects are closed by default (review §4.1 default privileges)
create function public.zz_probe() returns integer language sql as 'select 1';
create table public.zz_probe_table (id integer);
select ok(not has_function_privilege('anon', 'public.zz_probe()', 'execute'), 'new functions are not executable by anon');
select ok(not has_table_privilege('anon', 'public.zz_probe_table', 'select'), 'new tables are not readable by anon');
drop function public.zz_probe();
drop table public.zz_probe_table;

-- Cross-person reads
create temp table ids as
select tests.create_person('ra@test.dev') as a, tests.create_person('rb@test.dev') as b;
grant select on ids to authenticated;
select tests.consent_all(a) from ids;
select tests.clock((select a from ids), 'shift_in', '2026-10-14 09:00+09:30');

select tests.as_person((select b from ids));
select is((select count(*)::int from public.daymark_punches where user_id = (select a from ids)), 0,
  'intern B cannot read intern A''s punches');
select is((select count(*)::int from storage.objects where name like (select a from ids) || '/%'), 0,
  'intern B cannot read intern A''s selfies');
reset role;
select tests.as_person((select a from ids));
select is((select count(*)::int from public.daymark_punches), 1, 'intern A reads their own punch');
reset role;

select * from finish();
rollback;

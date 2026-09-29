begin;
select plan(44);
select tests.without_seed();

-- 29 Sep requests: overnight shifts, your own name, banners, staff roster edits (date ranges and
-- single days) and the full erase keeping other people's audit rows as "Deleted user".
-- "Today" is Mon 12 Oct 2026, 10:00 Darwin.
select tests.at('2026-10-12 10:00+09:30');
insert into public.daymark_sites (id, name, address, latitude, longitude)
values ('00000000-0000-0000-0000-0000000b0b0b', 'Shared site', 'Test', -12.4785082, 130.9854825);
create temp table ids as
select tests.create_intern('pb.o@test.dev') as o,                                   -- overnight
       tests.create_intern('pb.i@test.dev') as i,                                   -- renames themself
       tests.create_intern('pb.r@test.dev') as r,                                   -- date-range pattern
       tests.create_intern('pb.m@test.dev', null, '{1,3}') as m,                    -- single-day edits
       tests.create_intern('pb.w1@test.dev', '00000000-0000-0000-0000-0000000b0b0b', '{3}') as w1,
       tests.create_intern('pb.w2@test.dev', '00000000-0000-0000-0000-0000000b0b0b', '{3}') as w2,
       tests.create_intern('pb.w3@test.dev', '00000000-0000-0000-0000-0000000b0b0b', '{3}') as w3,
       tests.create_intern('pb.x@test.dev', '00000000-0000-0000-0000-0000000b0b0b', '{1}') as x,
       tests.create_person('pb.s2@test.dev', false, true, false, 'Other Supervisor') as s2,
       tests.create_person('pb.admin@test.dev', false, false, true, 'Pat Admin') as admin,
       tests.create_person('pb.admin2@test.dev', false, false, true, 'Ada Leaving') as admin2;
grant select on ids to authenticated;
-- w1–w3 and x share a site; x belongs to the other supervisor.
update public.daymark_placements set supervisor_id = (select s2 from ids) where intern_id = (select x from ids);

-- Overnight shift: 10 pm Monday to 1 am Tuesday is one shift on Monday ------------------------
select tests.shift((select o from ids), '2026-10-12 22:00', '2026-10-13 01:00');
select results_eq($$select work_date, clock_out_at from public.daymark_shifts where placement_id = tests.placement((select o from ids))$$,
  $$values ('2026-10-12'::date, '2026-10-13 01:00+09:30'::timestamptz)$$, 'an overnight shift is one shift on the day it started');
select is((tests.day((select o from ids), '2026-10-12')).worked, 180, 'and counts its 3 hours worked there');

-- update_my_name ----------------------------------------------------------------------------
select tests.as_person((select i from ids));
select is(public.update_my_name('  Iris Lane '), 'Iris Lane', 'an intern changes their own name');
select throws_ok($$select public.update_my_name('   ')$$, '22023', 'Enter a name up to 80 characters.', 'a blank name is refused');
select throws_ok($$update public.daymark_profiles set display_name = 'Hacked' where id = (select m from ids)$$,
  '42501', null, 'profiles still can''t be updated directly');
reset role;
select is((select display_name from public.daymark_profiles where id = (select i from ids)), 'Iris Lane', 'the name is saved');
select is((select display_name from public.daymark_profiles where id = (select m from ids)), 'pb.m', 'nobody else changes');
select ok(exists (select 1 from public.daymark_audit_log where action = 'update_my_name' and row_id = (select i from ids)::text
  and before ->> 'display_name' = 'pb.i' and after ->> 'display_name' = 'Iris Lane'), 'the change is audited');
select tests.as_anon();
select throws_ok($$select public.update_my_name('Anon')$$, '42501', null, 'anon cannot');
reset role;

-- Banners -----------------------------------------------------------------------------------
select tests.as_person((select i from ids));
select throws_ok($$select public.save_banner(null, 'Hello', 'sticky')$$, '42501',
  'Only a supervisor or an admin can post a banner.', 'an intern cannot post a banner');
reset role;
select tests.as_person((select admin from ids));
create temp table b as select public.save_banner(null, 'Office closed Friday afternoon', 'scrolling') as admin_banner;
grant select on b to authenticated;
select throws_ok($$select public.save_banner(null, repeat('x', 281), 'sticky')$$, '22023',
  'Write a message up to 280 characters.', 'messages stay short');
reset role;
select tests.as_person(tests.supervisor());
select public.save_banner(null, 'Team lunch Wednesday', 'sticky');
alter table b add column sup_banner uuid;
update b set sup_banner = (select id from public.daymark_banners where message = 'Team lunch Wednesday');
select public.save_banner(null, 'Team lunch moved to Thursday', 'sticky');
select is((select active from public.daymark_banners where id = (select sup_banner from b)), false,
  'a new banner ends the author''s previous one');
reset role;

select tests.as_person((select i from ids));
select results_eq($$select message, style, audience from public.current_banners() order by message$$,
  $$values ('Office closed Friday afternoon', 'scrolling', 'everyone'), ('Team lunch moved to Thursday', 'sticky', 'supervisor_interns')$$,
  'an intern sees the admin''s banner and their supervisor''s');
select is((select count(*)::int from public.daymark_banners), 0, 'interns can''t read the banner table itself');
select throws_ok($$select public.end_banner((select admin_banner from b))$$, '42501',
  'Only its author or an admin can end that banner.', 'an intern cannot end a banner');
reset role;
select tests.as_person((select x from ids));
select results_eq($$select message from public.current_banners()$$, $$values ('Office closed Friday afternoon')$$,
  'another supervisor''s intern sees only the admin''s banner');
reset role;
select tests.as_person((select admin from ids));
select public.save_banner(null, 'Next week only', 'sticky', '2026-10-19 00:00+09:30', null);
select is((select count(*)::int from public.current_banners() where message = 'Next week only'), 0,
  'a banner that hasn''t started isn''t shown');
select lives_ok($$select public.end_banner((select id from public.daymark_banners where message = 'Team lunch moved to Thursday'))$$,
  'an admin can end a supervisor''s banner');
reset role;

-- set_pattern_range: Wednesdays 10–2 for two weeks, then the usual Mon–Fri comes back ----------
select tests.as_person((select s2 from ids));
select throws_ok($$select public.set_pattern_range(tests.placement((select r from ids)), '2026-10-19', '2026-10-30',
  '[{"weekday":3,"start":"10:00","end":"14:00"}]')$$, '42501', 'Only the intern''s supervisor or an admin can do that.',
  'another supervisor cannot change the pattern');
reset role;
select tests.as_person(tests.supervisor());
select lives_ok($$select public.set_pattern_range(tests.placement((select r from ids)), '2026-10-19', '2026-10-30',
  '[{"weekday":3,"start":"10:00","end":"14:00"}]')$$, 'the intern''s supervisor sets a two-week pattern');
reset role;
select results_eq($$select work_date, start_time from public.daymark_scheduled_days
                    where placement_id = tests.placement((select r from ids)) and status = 'scheduled'
                      and work_date between '2026-10-19' and '2026-10-30' order by work_date$$,
  $$values ('2026-10-21'::date, '10:00'::time), ('2026-10-28'::date, '10:00'::time)$$, 'inside the range only Wednesdays 10–2');
select is(tests.sday((select r from ids), '2026-10-16') is not null, true, 'the Friday before is untouched');
select results_eq($$select work_date, start_time from public.daymark_scheduled_days
                    where placement_id = tests.placement((select r from ids)) and status = 'scheduled'
                      and work_date between '2026-11-02' and '2026-11-06' order by work_date$$,
  $$values ('2026-11-02'::date, '09:00'::time), ('2026-11-03'::date, '09:00'::time), ('2026-11-04'::date, '09:00'::time),
           ('2026-11-05'::date, '09:00'::time), ('2026-11-06'::date, '09:00'::time)$$, 'after the range the usual days come back');
select ok(exists (select 1 from public.daymark_notifications where person_id = (select r from ids) and kind = 'schedule'),
  'the intern is told');

-- Single-day edits ----------------------------------------------------------------------------
select tests.as_person(tests.supervisor());
create temp table days (k text primary key, v uuid);
grant select on days to authenticated;
insert into days select 'moved', public.staff_move_day(tests.sday((select m from ids), '2026-10-14'), '2026-10-15', '10:00', '14:00');
insert into days select 'added', public.staff_add_day(tests.placement((select m from ids)), '2026-10-16', '09:00', '13:00');
select public.staff_move_day(tests.sday((select m from ids), '2026-10-19'), '2026-10-19', '08:00', '12:00');
select public.staff_cancel_day(tests.sday((select m from ids), '2026-10-21'));
select throws_ok($$select public.staff_add_day(tests.placement((select m from ids)), '2026-10-16', '09:00', '13:00')$$,
  '22023', 'They''re already rostered on Fri 16 Oct.', 'no second day on the same date');
select throws_ok($$select public.staff_add_day(tests.placement((select m from ids)), '2026-10-09', '09:00', '13:00')$$,
  '22023', 'Pick today or a later date.', 'no days in the past');
select throws_ok($$select public.staff_add_day(tests.placement((select m from ids)), '2026-10-23', '06:00', '13:00')$$,
  '22023', 'Days are between 7:00 am and 7:00 pm, in 15-minute steps and at most 10 hours.', 'times are checked');
select throws_ok($$select public.staff_cancel_day(tests.sday((select m from ids), '2026-10-05'))$$,
  '22023', 'Past days can''t be changed. Use a punch fix for hours.', 'past days are locked');
reset role;
select is((select status from public.daymark_scheduled_days
           where placement_id = tests.placement((select m from ids)) and work_date = '2026-10-14'), 'moved', 'the moved day is marked moved');
select results_eq($$select work_date, start_time, end_time, source from public.daymark_scheduled_days where id = (select v from days where k = 'moved')$$,
  $$values ('2026-10-15'::date, '10:00'::time, '14:00'::time, 'admin')$$, 'and the new day has the new time');
select results_eq($$select source, status from public.daymark_scheduled_days where id = (select v from days where k = 'added')$$,
  $$values ('admin', 'scheduled')$$, 'an added day is on the roster');
select results_eq($$select start_time, end_time from public.daymark_scheduled_days
                    where placement_id = tests.placement((select m from ids)) and work_date = '2026-10-19' and status = 'scheduled'$$,
  $$values ('08:00'::time, '12:00'::time)$$, 're-timing keeps the date');
select is((select status from public.daymark_scheduled_days
           where placement_id = tests.placement((select m from ids)) and work_date = '2026-10-21'), 'cancelled', 'a removed day is cancelled');
select is((select count(*)::int from public.daymark_schedule_history h join public.daymark_scheduled_days d on d.id = h.scheduled_day_id
           where d.placement_id = tests.placement((select m from ids))), 4, 'every change is in the roster history');
select is((select count(*)::int from public.daymark_notifications where person_id = (select m from ids) and kind = 'schedule'), 4,
  'the intern is told about each change');

select tests.as_person(tests.supervisor());
select throws_ok($$select public.staff_add_day(tests.placement((select x from ids)), '2026-10-16', '09:00', '13:00')$$,
  '42501', 'Only the intern''s supervisor or an admin can do that.', 'a supervisor edits only their own interns');
reset role;
select tests.as_person((select s2 from ids));
select throws_ok($$select public.staff_add_day(tests.placement((select x from ids)), '2026-10-14', '09:00', '13:00')$$,
  'P0001', 'Wed 14 Oct is full. An extra spot needs supervisor and admin approval.', 'a full day needs an extra spot');
select lives_ok($$select public.staff_add_day(tests.placement((select x from ids)), '2026-10-14', '09:00', '13:00', true)$$,
  'allowing the extra spot adds it');
select tests.as_person((select m from ids));
select throws_ok($$select public.staff_cancel_day(tests.sday((select m from ids), '2026-10-26'))$$,
  '42501', null, 'an intern cannot edit their own roster directly');
reset role;

-- Full erase keeps other people's audit rows, shown as "Deleted user" -------------------------
select tests.as_person((select admin2 from ids));
select public.update_record('daymark_profiles', (select m from ids)::text, '{"display_name": "Max Moore"}');
reset role;
select tests.as_person((select admin from ids));
select lives_ok($$select public.delete_record('daymark_profiles', (select admin2 from ids)::text)$$, 'an admin deletes another admin');
reset role;
select results_eq($$select actor_id, actor_name from public.daymark_audit_log
                    where action = 'update_record' and row_id = (select m from ids)::text$$,
  $$values (null::uuid, 'Deleted user')$$, 'their edit of someone else''s record stays, by "Deleted user"');
select is((select count(*)::int from public.daymark_audit_log
           where actor_id = (select admin2 from ids) or row_id = (select admin2 from ids)::text
              or after::text ilike '%Ada Leaving%' or before::text ilike '%Ada Leaving%'), 0, 'nothing names or points to them');
select ok(exists (select 1 from public.daymark_audit_log where action = 'delete_person' and row_id is null
                  and actor_id = (select admin from ids) and actor_name = 'Pat Admin'), 'the deletion note names only who deleted');
select tests.as_person((select admin from ids));
select throws_ok($$select public.delete_record('daymark_profiles', tests.supervisor()::text)$$, '22023',
  'This person supervises a placement. Give it another supervisor first.', 'a supervisor with interns can''t be deleted yet');
reset role;

select * from finish();
rollback;

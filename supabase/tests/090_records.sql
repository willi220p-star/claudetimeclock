begin;
select plan(45);

-- Add an intern with their placement, the Records tab (edit/delete one record), deleting a
-- person, storage clean-up and the admin read scope (26 Sep requests).
select tests.without_seed();
select tests.at('2026-10-01 10:00+09:30');
create temp table ids as
select tests.create_person('rc.admin@test.dev', false, false, true, 'Records Admin') as admin,
       tests.supervisor() as sup,
       tests.create_intern('rc.a@test.dev') as a,
       tests.create_intern('rc.b@test.dev') as b,
       tests.create_intern('rc.c@test.dev') as c;
grant select on ids to authenticated;

-- create_intern ---------------------------------------------------------------------------
create temp table made (person jsonb);
grant select, insert on made to authenticated;
select tests.as_person((select sup from ids));
select throws_ok($$select public.create_intern('Nope', 'rc.nope@test.dev', 'Temporary-pass-1', false, false, '{}', false)$$,
  '42501', 'Only an active admin can do that.', 'a supervisor cannot add an intern');
reset role;

select tests.as_person((select admin from ids));
insert into made select public.create_intern('Priya Rai', 'rc.new@test.dev', 'Temporary-pass-1', false, false,
  jsonb_build_object('supervisor_id', (select sup from ids), 'university', 'CDU', 'course', 'BBus',
    'start_date', '2026-10-05', 'planned_end_date', '2026-10-30', 'target_minutes', 12000,
    'pattern', '[{"weekday": 1, "start": "09:00", "end": "17:00"}, {"weekday": 3, "start": "10:00", "end": "14:00"}]'::jsonb),
  false);
select throws_ok($$select public.create_intern('No Uni', 'rc.nouni@test.dev', 'Temporary-pass-1', false, false,
  jsonb_build_object('supervisor_id', (select sup from ids), 'university', '', 'course', 'BBus',
    'start_date', '2026-10-05', 'planned_end_date', '2026-10-30', 'target_minutes', 12000,
    'pattern', '[{"weekday": 1, "start": "09:00", "end": "17:00"}]'::jsonb), false)$$,
  '22023', 'Enter the university and the course.', 'a bad placement is refused');
reset role;

select ok((select (x.is_intern and not x.is_supervisor and x.must_change_password) from public.daymark_profiles x
           where x.id = ((select person from made) ->> 'id')::uuid), 'the person is an intern who sets their own password');
select is((select p.id from public.daymark_placements p where p.intern_id = ((select person from made) ->> 'id')::uuid),
  ((select person from made) ->> 'placement_id')::uuid, 'the placement is created with them');
select is((select count(*)::int from public.daymark_scheduled_days d
           where d.placement_id = ((select person from made) ->> 'placement_id')::uuid and d.status = 'scheduled'), 8,
  'the roster is generated: 4 Mondays and 4 Wednesdays');
select is((select d.planned_minutes from public.daymark_scheduled_days d
           where d.placement_id = ((select person from made) ->> 'placement_id')::uuid and d.work_date = '2026-10-07'), 240,
  'with each day''s own hours');
select is((select count(*)::int from public.daymark_profiles x where x.contact_email = 'rc.nouni@test.dev'), 0,
  'a refused placement leaves no person behind');

-- update_record ---------------------------------------------------------------------------
insert into public.daymark_work_logs (placement_id, work_date, summary)
values (tests.placement((select a from ids)), '2026-09-28', 'Filed invoices.');

select tests.as_person((select sup from ids));
select throws_ok($$select public.update_record('daymark_work_logs',
  (select id::text from public.daymark_work_logs where placement_id = tests.placement((select a from ids))), '{"summary": "x"}')$$,
  '42501', 'Only an active admin can do that.', 'a supervisor cannot edit records');
reset role;

select tests.as_person((select admin from ids));
select is((public.update_record('daymark_work_logs',
  (select id::text from public.daymark_work_logs where placement_id = tests.placement((select a from ids))),
  '{"summary": "Filed and checked invoices."}')) ->> 'summary', 'Filed and checked invoices.', 'an admin edits a work log');
select throws_ok($$select public.update_record('daymark_work_logs',
  (select id::text from public.daymark_work_logs where placement_id = tests.placement((select a from ids))), '{"work_date": "2026-09-29"}')$$,
  '42501', 'That field can''t be edited here.', 'only the listed fields');
select throws_ok($$select public.update_record('daymark_work_logs',
  (select id::text from public.daymark_work_logs where placement_id = tests.placement((select a from ids))), '{"summary": "  "}')$$,
  '22023', 'Fill in every required field.', 'a required field cannot be blanked');
select throws_ok($$select public.update_record('daymark_audit_log', '1', '{"action": "x"}')$$,
  '42501', 'Records in this table can''t be edited here.', 'the audit log cannot be edited');
select throws_ok($$select public.update_record('daymark_work_logs', gen_random_uuid()::text, '{"summary": "Gone"}')$$,
  'P0002', 'That record is already gone.', 'a missing row says so');
select is((public.update_record('daymark_scheduled_days', tests.sday((select a from ids), '2026-09-29')::text,
  '{"start_time": "10:00"}')) ->> 'planned_minutes', '390', 'a roster day''s hours follow its edited start');
select is((public.update_record('daymark_profiles', (select a from ids)::text, '{"display_name": "Anna Lee"}')) ->> 'display_name',
  'Anna Lee', 'a name can be corrected');
reset role;
select ok(exists (select 1 from public.daymark_audit_log l where l.action = 'update_record' and l.table_name = 'daymark_work_logs'
  and l.before ->> 'summary' = 'Filed invoices.' and l.after ->> 'summary' = 'Filed and checked invoices.'),
  'each edit is audited with before and after');

-- delete_record ---------------------------------------------------------------------------
select tests.shift((select a from ids), '2026-09-30 09:00', '2026-09-30 17:00');
select is((tests.day((select a from ids), '2026-09-30')).worked > 0, true, 'a worked day before the delete');

select tests.as_person((select sup from ids));
select throws_ok($$select public.delete_record('daymark_punches',
  (select id::text from public.daymark_punches where user_id = (select a from ids) and event_type = 'shift_out'))$$,
  '42501', 'Only an active admin can do that.', 'a supervisor cannot delete records');
reset role;

select tests.as_person((select admin from ids));
select lives_ok($$select public.delete_record('daymark_punches',
  (select id::text from public.daymark_punches where user_id = (select a from ids) and event_type = 'shift_out'))$$,
  'an admin deletes a punch');
select throws_ok($$select public.delete_record('daymark_audit_log', '1')$$,
  '42501', 'Records in this table can''t be deleted.', 'the audit log is never deleted');
select throws_ok($$select public.delete_record('daymark_consent_records', '1')$$,
  '42501', 'Records in this table can''t be deleted.', 'consent records are never deleted');
select throws_ok($$select public.delete_record('daymark_day_results', '1')$$,
  '42501', 'Records in this table can''t be deleted.', 'derived tables are rebuilt, not deleted');
reset role;
select is(coalesce((tests.day((select a from ids), '2026-09-30')).worked, 0), 0, 'the day''s hours are rebuilt without it');
select ok(exists (select 1 from public.daymark_audit_log l where l.action = 'delete_record' and l.table_name = 'daymark_punches'
  and l.before ->> 'event_type' = 'shift_out'), 'the deleted row is kept in the audit log');

-- A punch that a fix replaces can't go first.
insert into public.daymark_punches (user_id, event_type, source, occurred_at, replaces_punch_id)
select (select a from ids), 'shift_in', 'punch_fix', '2026-09-30 09:10+09:30', x.id
from public.daymark_punches x where x.user_id = (select a from ids) and x.occurred_at = '2026-09-30 09:00+09:30';
select tests.as_person((select admin from ids));
select throws_ok($$select public.delete_record('daymark_punches',
  (select id::text from public.daymark_punches where user_id = (select a from ids) and occurred_at = '2026-09-30 09:00+09:30'))$$,
  '22023', 'A punch fix replaces this punch. Delete the fix first.', 'a replaced punch keeps its fix');

select is(jsonb_array_length((public.delete_record('daymark_scheduled_days', tests.sday((select a from ids), '2026-10-02')::text)) -> 'files'), 0,
  'a roster day is deleted');
reset role;
select is(tests.sday((select a from ids), '2026-10-02'), null, 'and is gone from the roster');

-- delete_person ---------------------------------------------------------------------------
select tests.consent_all((select b from ids));
select tests.clock((select b from ids), 'shift_in', '2026-10-01 09:00+09:30');
select tests.at('2026-10-01 10:00+09:30');

select tests.as_person((select admin from ids));
select throws_ok($$select public.delete_record('daymark_profiles', (select admin from ids)::text)$$,
  '22023', 'You can''t delete yourself. Ask another admin.', 'an admin cannot delete themselves');
select throws_ok($$select public.delete_record('daymark_profiles', (select sup from ids)::text)$$,
  '22023', 'This person supervises a placement. Give it another supervisor first.', 'a supervisor with interns stays');
create temp table gone (result jsonb);
insert into gone select public.delete_record('daymark_profiles', (select b from ids)::text);
reset role;

select is(jsonb_array_length((select result from gone) -> 'files'), 1, 'their selfie is returned for the browser to remove');
select is((select count(*)::int from public.daymark_profiles where id = (select b from ids)), 0, 'the profile is gone');
select is((select count(*)::int from auth.users where id = (select b from ids)), 0, 'so is the login');
select is((select count(*)::int from public.daymark_punches where user_id = (select b from ids)), 0, 'and their punches');
select is((select count(*)::int from public.daymark_placements where intern_id = (select b from ids)), 0, 'and their placement');
select is((select count(*)::int from public.daymark_consent_records c
           where c.person_id is null and c.recorded_by = (select b from ids)), 3, 'consent records stay, unlinked');
select ok(exists (select 1 from public.daymark_audit_log l where l.action = 'delete_person' and l.row_id = (select b from ids)::text
  and l.before ->> 'display_name' = 'rc.b'), 'the deletion is audited');

-- Storage clean-up ------------------------------------------------------------------------
insert into public.daymark_notifications (person_id, kind, title, body, read_at)
values ((select a from ids), 'test', 'Old', 'Read long ago', '2026-08-01 10:00+09:30'),
       ((select a from ids), 'test', 'New', 'Unread', null);
select tests.consent_all((select c from ids));
select tests.clock((select c from ids), 'shift_in', '2026-10-01 09:05+09:30');
select tests.at('2026-11-15 10:00+09:30');

select tests.as_person((select admin from ids));
select is((public.cleanup_preview(30)) -> 'notifications', '1'::jsonb, 'one read notification is over 30 days old');
select is((public.cleanup_run('notifications', 30)) -> 'rows', '1'::jsonb, 'it is deleted');
select is((public.cleanup_preview(30)) -> 'selfies', '1'::jsonb, 'one selfie is over 30 days old');
select is(jsonb_array_length((public.cleanup_run('selfies', 30)) -> 'files'), 1, 'its file is returned');
select throws_ok($$select public.cleanup_run('audit', 30)$$, '22023', 'Unknown clean-up.', 'only the known clean-ups');
select is((select count(*)::int from public.daymark_notifications where person_id = (select a from ids) and kind = 'test'), 1,
  'admins read every notification, and the unread one stays');
reset role;
select is((select count(*)::int from public.daymark_punches where user_id = (select c from ids) and photo_deleted_at is not null), 1,
  'the punch stays, marked photo removed');

select tests.as_person((select sup from ids));
select throws_ok($$select * from public.storage_usage()$$, '42501', 'Only an active admin can do that.', 'storage usage is admin-only');
reset role;

select tests.as_anon();
select throws_ok($$select public.delete_record('daymark_punches', '1')$$, '42501', null, 'anon cannot delete');
reset role;

select * from finish();
rollback;

begin;
select plan(35);

-- Phase 7: settings (§10) and publishing a new collection notice (security review §2.4).
create temp table ids as
select tests.create_person('set.admin@test.dev', false, false, true) as admin,
       tests.create_person('set.sup@test.dev', false, true, false) as sup,
       tests.create_person('set.int@test.dev') as intern,
       tests.create_person('set.gone@test.dev') as gone;
grant select on ids to authenticated;
create temp table res (k text primary key, v jsonb);
grant all on res to authenticated;
update public.daymark_profiles set active = false where id = (select gone from ids);
select tests.at('2026-10-01 10:00+09:30');
select tests.consent_all(intern) from ids;

-- §6 only an admin changes settings or publishes a notice
select tests.as_person((select intern from ids));
select throws_ok($$select public.update_settings('{"grace_minutes":10}')$$, '42501', null, 'an intern cannot change settings');
select throws_ok($$select public.publish_notice('9.0', 'T', repeat('x', 60))$$, '42501', null, 'an intern cannot publish a notice');
reset role;
select tests.as_person((select sup from ids));
select throws_ok($$select public.update_settings('{"grace_minutes":10}')$$, '42501', null, 'a supervisor cannot change settings');
select throws_ok($$select public.publish_notice('9.0', 'T', repeat('x', 60))$$, '42501', null, 'a supervisor cannot publish a notice');
reset role;

-- Validation, per column
select tests.as_person((select admin from ids));
select throws_ok($$select public.update_settings('{}')$$, '22023', 'Change at least one setting.', 'an empty change is rejected');
select throws_ok($$select public.update_settings('{"fortnight_anchor":"2026-09-29"}')$$,
  '22023', 'The fortnight anchor must be a Monday.', 'the fortnight anchor is a Monday');
select throws_ok($$select public.update_settings('{"fortnight_anchor":"soon"}')$$,
  '22023', 'The fortnight anchor must be a Monday.', 'the fortnight anchor is a date');
select throws_ok($$select public.update_settings('{"grace_minutes":61}')$$,
  '22023', 'Set the grace period to a whole number from 0 to 60 minutes.', 'minutes stay sensible');
select throws_ok($$select public.update_settings('{"grace_minutes":7.5}')$$,
  '22023', 'Set the grace period to a whole number from 0 to 60 minutes.', 'minutes are whole');
select throws_ok($$select public.update_settings('{"grace_minutes":"10"}')$$,
  '22023', 'Set the grace period to a whole number from 0 to 60 minutes.', 'minutes are numbers');
select throws_ok($$select public.update_settings('{"escalation_hours":0}')$$,
  '22023', 'Set escalation to a whole number from 1 to 336 hours.', 'hours are positive');
select throws_ok($$select public.update_settings('{"max_day_minutes":480}')$$,
  '22023', 'Set the longest counted day to a whole number from 600 to 720 minutes.',
  'the longest counted day never drops below a 10-hour pattern day (R5.2.1)');
select throws_ok($$select public.update_settings('{"break_minutes":45}')$$,
  '22023', 'The break rule (30 minutes off days over 5 hours) is fixed by the schedule rules.',
  'the break rule stays in step with planned minutes (R5.2.4)');
select throws_ok($$select public.update_settings('{"retention_days":5}')$$,
  '22023', 'Medical certificates can''t be kept longer than the other records (5 days).',
  'certificates are never kept longer than everything else');
select throws_ok($$select public.update_settings('{"colour":"blue"}')$$,
  '22023', 'There''s no setting called "colour".', 'unknown settings are rejected');
select throws_ok($$select public.update_settings('{"id":2}')$$,
  '22023', 'There''s no setting called "id".', 'the singleton id cannot change');
select throws_ok($$select public.update_settings('{"notice_version":"9.9"}')$$,
  '22023', 'That notice version doesn''t exist. Publish it first.', 'the notice version must exist');
reset role;
select is((select grace_minutes from public.daymark_settings), 15, 'nothing changed after the failures');

-- A valid partial update changes only what was sent, audited with before and after
select tests.as_person((select admin from ids));
insert into res select 'upd', public.update_settings('{"fortnight_anchor":"2026-10-05","grace_minutes":10}');
reset role;
select is((select array[v ->> 'fortnight_anchor', v ->> 'grace_minutes', v ->> 'escalation_hours'] from res where k = 'upd'),
  array['2026-10-05', '10', '72'], 'the sent settings change and the rest stay');
select is((select updated_at from public.daymark_settings), '2026-10-01 10:00+09:30'::timestamptz, 'updated_at uses the business clock');
select is((select jsonb_build_array(before, after) from public.daymark_audit_log where action = 'update_settings'),
  '[{"fortnight_anchor":"2026-09-28","grace_minutes":15},{"fortnight_anchor":"2026-10-05","grace_minutes":10}]'::jsonb,
  'the audit holds the changed settings before and after');

-- publish_notice validation
select tests.as_person((select admin from ids));
select throws_ok($$select public.publish_notice('1.0', 'How DGK Clock handles your information', repeat('x', 60))$$,
  '23505', 'Version 1.0 already exists. Use a new version number.', 'a version is published once');
select throws_ok($$select public.publish_notice('v 2!', 'T', repeat('x', 60))$$,
  '22023', 'Use a version like 1.1: letters, numbers, dots and dashes, up to 20 characters.', 'the version format is checked');
select throws_ok($$select public.publish_notice('1.1', ' ', repeat('x', 60))$$,
  '22023', 'Give the notice a title up to 120 characters.', 'a notice needs a title');
select throws_ok($$select public.publish_notice('1.1', 'T', 'Too short.')$$,
  '22023', 'Write the full notice, from 50 to 20,000 characters.', 'a notice needs its full text');
reset role;

-- Publishing forces everyone to re-acknowledge before clocking (private.has_consent)
select ok(private.has_consent((select intern from ids), 'location'), 'the intern has location consent under v1.0');
select tests.as_person((select admin from ids));
insert into res select 'pub', public.publish_notice(' 1.1 ', 'How DGK Clock handles your information',
  'We now also keep your weekly check-in comments. Everything else is the same as version 1.0.');
reset role;
select is((select v - 'published_at' from res where k = 'pub'),
  jsonb_build_object('version', '1.1', 'title', 'How DGK Clock handles your information',
    'sha256', (select sha256 from public.daymark_notices where version = '1.1'),
    'notified', (select count(*) from public.daymark_profiles where is_intern and active)),
  'publishing returns the new version, its hash and how many interns were told');
select is((select notice_version from public.daymark_settings), '1.1', 'the new notice is current');
select ok(not private.has_consent((select intern from ids), 'location'), 'consent needs the new notice acknowledged');
select is((select title || ' ' || body || ' ' || link from public.daymark_notifications
           where person_id = (select intern from ids) and kind = 'notice'),
  'We''ve updated how DGK Clock handles your information Please read it before your next clock-in. /clock',
  'every active intern is told');
select ok(not exists (select 1 from public.daymark_notifications
                      where kind = 'notice' and person_id in ((select gone from ids), (select sup from ids), (select admin from ids))),
  'inactive interns, supervisors and admins are not');
select is((select jsonb_build_array(before, after - 'sha256') from public.daymark_audit_log where action = 'publish_notice'),
  '[{"notice_version":"1.0"},{"notice_version":"1.1","title":"How DGK Clock handles your information"}]'::jsonb,
  'publishing is audited with before and after');
select tests.as_person((select intern from ids));
select public.record_consent('collection_notice', 'acknowledged');
reset role;
select ok(private.has_consent((select intern from ids), 'location'), 're-acknowledging restores consent');

-- anon can run none of it
select ok(not has_function_privilege('anon', 'public.update_settings(jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.publish_notice(text, text, text)', 'execute')
      and not has_function_privilege('anon', 'private.update_settings(jsonb)', 'execute')
      and not has_function_privilege('anon', 'private.publish_notice(text, text, text)', 'execute'),
  'anon cannot execute the settings RPCs');
select tests.as_anon();
select throws_ok($$select public.update_settings('{"grace_minutes":10}')$$, '42501', null, 'anon cannot change settings');
reset role;

select * from finish();
rollback;

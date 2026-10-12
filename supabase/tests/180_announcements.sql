begin;
select plan(17);

-- Announcements with read receipts (Dilip, 12 Oct; D41).
create temp table ids as
select tests.create_person('ann.admin@test.dev', false, false, true) as admin,
       tests.create_intern('ann.a@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as a,
       tests.create_intern('ann.b@test.dev', null, '{1,2,3,4,5}', '2026-10-12') as b,
       tests.create_person('ann.sup2@test.dev', false, true, false) as sup2;
grant select on ids to authenticated;
select tests.without_seed();
-- B belongs to the second supervisor.
update public.daymark_placements set supervisor_id = (select sup2 from ids) where intern_id = (select b from ids);
create temp table ann (id uuid);
grant all on ann to authenticated;

-- Who may post what.
select tests.as_person((select a from ids));
select throws_ok($$select public.post_announcement('Hi', 'Body', 'my_interns', false)$$, '42501', null, 'an intern can''t post');
reset role;
select tests.as_person(tests.supervisor());
select throws_ok($$select public.post_announcement('Hi', 'Body', 'everyone', false)$$, '42501', null,
  'a supervisor can''t post to everyone');
select throws_ok($$select public.post_announcement('', 'Body', 'my_interns', false)$$, '22023', null, 'a title is needed');
insert into ann select public.post_announcement('Office closed Friday', 'Public holiday.', 'my_interns', true);
reset role;
select is((select count(*)::int from public.daymark_notifications where kind = 'announcement' and person_id = (select a from ids)), 1,
  'the supervisor''s intern is told');
select is((select count(*)::int from public.daymark_notifications where kind = 'announcement' and person_id = (select b from ids)), 0,
  'another supervisor''s intern is not');

-- The intern reads, then acknowledges.
select tests.as_person((select a from ids));
select is((select count(*)::int from public.my_announcements()), 1, 'the intern sees it');
select public.mark_announcement((select id from ann), false);
select ok((select read_at is not null and acked_at is null from public.my_announcements()), 'read, not yet acknowledged');
select public.mark_announcement((select id from ann), true);
select ok((select acked_at is not null from public.my_announcements()), 'acknowledged');
reset role;
select tests.as_person((select b from ids));
select is((select count(*)::int from public.my_announcements()), 0, 'B doesn''t see it');
select throws_ok(format('select public.mark_announcement(%L, true)', (select id from ann)), '42501', null, 'and can''t mark it');
reset role;

-- The poster sees reads; others can't.
select tests.as_person(tests.supervisor());
select is((select read || '/' || acked || '/' || recipients from public.posted_announcements()), '1/1/1', 'counts for the poster');
reset role;
select tests.as_person((select sup2 from ids));
select throws_ok(format('select * from public.announcement_reads(%L)', (select id from ann)), '42501', null,
  'another supervisor can''t see the reads');
reset role;

-- Admin posts to interns: both interns, not the supervisor; a reminder reaches only who hasn't acknowledged.
select tests.as_person((select admin from ids));
delete from ann;
insert into ann select public.post_announcement('New dress code', 'Smart casual.', 'interns', true);
reset role;
-- Seeded interns are told too, so only these people are checked by name.
select is((select count(*)::int from public.daymark_notifications where title = 'New dress code'
  and person_id in ((select a from ids), (select b from ids))), 2, 'both interns are told');
select tests.as_person((select a from ids));
select public.mark_announcement((select id from ann), true);
reset role;
select tests.as_person((select admin from ids));
select cmp_ok(public.nudge_announcement((select id from ann)), '>=', 1, 'a reminder goes out');
select is((select string_agg(display_name, ',') from public.announcement_reads((select id from ann))
  where acked_at is not null), (select display_name from public.daymark_profiles where id = (select a from ids)),
  'the read list shows who acknowledged');
reset role;
select is((select count(*)::int from public.daymark_notifications where title = 'Reminder: New dress code'
  and person_id in ((select a from ids), (select b from ids))), 1, 'only the one who hasn''t acknowledged is reminded');
select tests.as_person((select admin from ids));
reset role;
select ok(private.push_worthy('announcement'), 'announcements are pushed');

select * from finish();
rollback;

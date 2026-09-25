begin;
select plan(14);
select tests.without_seed();

insert into public.daymark_sites (id, name, address, latitude, longitude)
values ('00000000-0000-0000-0000-00000000c050', 'KPI site', 'Test', -12.4785082, 130.9854825);
create temp table ids as
select tests.create_person('kpi.admin@test.dev', false, false, true) as admin,
       tests.create_intern('kpi1@test.dev', '00000000-0000-0000-0000-00000000c050', '{1,2,3,4,5}', '2026-10-05', '2026-12-18') as i;
grant select on ids to authenticated;
select tests.consent_all(i) from ids;

-- Mon 5 Oct on time, Tue 6 Oct 20 min late (full length), Wed 7 Oct no-show; logs for Mon and Tue.
select tests.clock((select i from ids), 'shift_in', '2026-10-05 08:58+09:30');
select tests.clock((select i from ids), 'shift_out', '2026-10-05 16:58+09:30');
select tests.at('2026-10-06 07:30+09:30');
insert into public.daymark_work_logs (placement_id, work_date, summary)
values (private.current_placement((select i from ids)), '2026-10-05', 'Onboarding and first client brief.');
select tests.clock((select i from ids), 'shift_in', '2026-10-06 09:20+09:30');
select tests.clock((select i from ids), 'shift_out', '2026-10-06 17:20+09:30');
insert into public.daymark_work_logs (placement_id, work_date, summary)
values (private.current_placement((select i from ids)), '2026-10-06', 'Lead list clean-up in the CRM.');
select tests.at('2026-10-07 19:10+09:30');
select private.job_day_close();
select tests.at('2026-10-08 10:00+09:30');
select private.job_reconcile();

select tests.as_person((select i from ids));
create temp table ki as select public.kpi_intern() as j;
reset role;
select is((select (j ->> 'attendance_pct')::int from ki), 67, 'attendance: 2 of 3 scheduled days attended');
select is((select (j ->> 'on_time_pct')::int from ki), 50, 'on time: 1 of 2 attended days');
select is((select (j ->> 'work_log_streak')::int from ki), 2, 'work-log streak counts consecutive logged shift days');
select is((select (j #>> '{this_week,counted}')::int from ki), 900, 'this week counted');
select is((select (j #>> '{this_week,scheduled}')::int from ki), 2250, 'this week scheduled (Mon–Fri)');
select is((select (j ->> 'owed')::int from ki), 450, 'the no-show is owed');
select is((select (j ->> 'pending_requests')::int from ki), 0, 'no pending requests');

select tests.as_person(tests.supervisor());
create temp table ks as select public.kpi_supervisor() as j;
reset role;
select ok((select j ? 'approvals_waiting' and j ? 'attendance_pct' and j ? 'work_log_pct' from ks), 'the supervisor bundle has its fields');
select is((select (j ->> 'work_log_pct')::int from ks), 100, 'every shift day has a log');

select tests.as_person((select i from ids));
select throws_ok($$select public.kpi_admin()$$, '42501', null, 'admin KPIs are admin only');
select throws_ok($$select public.kpi_supervisor()$$, '42501', null, 'interns cannot read supervisor KPIs');
reset role;
select tests.as_person((select admin from ids));
create temp table ka as select public.kpi_admin() as j;
reset role;
select is((select (j ->> 'active')::int from ka), (select count(*)::int from public.daymark_placements where status in ('active', 'extended')),
  'active placements');
select ok((select jsonb_array_length(j -> 'heatmap') = 10 from ka), 'the heatmap covers the fortnight''s weekdays');
select ok((select j ? 'pct_on_pace' and j ? 'turnaround' and j ? 'outcomes' and j ? 'interns_per_supervisor' from ka),
  'the admin bundle has its fields');

select * from finish();
rollback;

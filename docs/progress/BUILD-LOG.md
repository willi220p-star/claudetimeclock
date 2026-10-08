# DGK Clock build log

Resume here. Continue from the first unchecked item. Each entry lists the commit SHA, the commands run and their results, and any decisions.

- Branch: `claude/quirky-lovelace-ktg6f8`
- Repo: `willi220p-star/claudetimeclock`

## Checklist

### Phase 0 — Bootstrap
- [x] 0.1 Import presence-tracker@b7f9ab5 (dc77dce)
- [x] 0.2 Build prompt, security review, ponytail rules in AGENTS.md, CONTEXT.md, ADRs 0001–0003, program spec, Phase 1 spec and plan, this log

### Phase 1 — Foundation & security (plan: docs/superpowers/plans/2026-09-25-dgk-clock-phase1-foundation.md)
- [x] 1.1 Harness
- [x] 1.2 Darwin time (TS)
- [x] 1.3 Minutes and periods (TS)
- [x] 1.4 Time, settings, sites (SQL)
- [x] 1.5 Roles and audit (SQL)
- [x] 1.6 Accounts (SQL)
- [x] 1.7 Consent (SQL)
- [x] 1.8 Punch rules (SQL)
- [x] 1.9 RLS and anon sweep (SQL)
- [x] 1.10 Roles and routing (TS)
- [x] 1.11 Sign-in and passwords (UI)
- [x] 1.12 Consent screen (UI)
- [x] 1.13 Clock desk on new RPCs (UI)
- [x] 1.14 Admin desk on new RPCs (UI)
- [x] 1.15 Brand tokens and fonts
- [x] 1.16 Shared components
- [x] 1.17 PWA and CSP
- [x] 1.18 Seed
- [x] 1.19 Gates, review, docs — all gates green on the cloud box (see "Docker gates" below)

### Phase 2 — Placements & schedule (plan written at phase start)
- [x] 2.core cohorts, placements (62a758c), CSV import (546a053)
- [x] 2.ui admin placement screens + wizard, cohorts, import (be22b63)
- [x] 2.x remaining SQL was already merged; UI in be22b63. Deferred D15: Sites/Closures/Settings/Audit stay placeholders.

### Phase 3 — Hours engine
- [x] 3.x hours engine SQL, jobs, work logs (merged earlier; 716 pgTAP on last recorded run)

### Phase 4 — Intern experience
- [x] 4.x intern Today/Schedule/Requests/Progress/Me, catch-up, work-log gate, notifications. e2e path 1 written (a413f1b). Month calendar and forecast chart deferred (D15).

### Phase 5 — Requests & approvals
- [x] 5.x request SQL already merged. UI + e2e paths 2–4 written (be22b63, e9f95fc), run green on the cloud box.

### Phase 6 — Supervisor
- [x] 6.x supervisor Today, Approvals, Interns, intern detail, uni report Confirm. Check-ins / Monday summary cut (D14). Flags tab deferred (D15).

### Phase 7 — Admin & KPIs
- [x] 7.x admin Overview, Placements, People, Cohorts, Import, Requests. Sites/Closures/Settings/Reports/Audit are D15 placeholders.

### Phase 8 — Completion & retention
- [x] 8.a lifecycle SQL, uni report approval, exit feedback, reminders, due_for_deletion (bb9b214); retention-purge Edge Function (5d34960)
- [x] 8.x lifecycle SQL + Edge Function already merged. Uni report UI + e2e path 5 (no PDF, D13). Draft PR #1. Do not merge.

## Assumptions
- A-D1: Code imported into claudetimeclock; basePath `/claudetimeclock`.
- A-D2: Branch `claude/quirky-lovelace-ktg6f8` instead of `feat/placement-system` (session requirement).
- A-D3: Auto-close counts 0 until a punch fix is approved (Dilip, overrides R5.5.1).
- A-D4: No office code / kiosk (Dilip).
- A-D5: No MFA now (Dilip).
- A-D6: Full consent pack (Dilip).
- A-D7: Clock window stays 19:00:00 inclusive (build prompt edge test).
- A-D10: Site and NT closure days in a migration, not only in seed (real data needed in production).
- A-D11: Passwords 12–72 characters (security review).
- A-D13: No uni report or certificate PDFs (Dilip). e2e path 5 becomes "supervisor approves the uni report" without a download.
- A-D12: No admin delete of people; deletion only via retention purge.
- A-0: The spec bundle zip was not supplied; CONTEXT.md, ADRs and specs were authored from the build prompt.
- A-1: Supabase CLI installed globally, not added to package.json (§5.5 unchanged).

## Log

### 0.1 Import — dc77dce
`tar` copy of presence-tracker@b7f9ab5, `npm ci` → found 0 vulnerabilities.

### 0.2 Bootstrap docs
Docker daemon started manually (`dockerd`), `supabase init`, config: site_url 127.0.0.1:41731, signups off, min password 12, studio/analytics off. `supabase start` OK (Postgres 17.6; pg_cron 1.6.4, pg_net 0.20.4, pgtap 1.3.3, dblink available).

### Phase 1 SQL — eaea478..2d513ff
Harness (eaea478), Darwin TS (eedad09), minutes/periods (4f0f9c5), time/settings/sites (89bdfe9), roles/audit (fffabb9), accounts (04d88e2), consent (ccd1cf6), punch rules (8247cd1), default privileges + RLS sweep (2d513ff), types (7b73b1f).
`npm test` → 25 passed. `supabase db reset && supabase test db` → Files=7, all PASS.

### Fast-track (Dilip, mid-session): multiple agents
- Agent UI-1 (worktree): Phase 1 UI tasks 1.10–1.17.
- Agent P3 (worktree, own stack dgk-p3): hours engine, migrations 202609250200xx, tests 020–029.
- Agent P5 (worktree, own stack dgk-p5): requests, migrations 202609250400xx, tests 040–049 (catch-up planner deferred until P3 merges).
- Main: Phase 2 core + import, Phase 8 lifecycle SQL + Edge Function.

### Phase 2 core — 62a758c, 546a053
`supabase db reset && supabase test db` → Files=11, Tests=182, PASS (incl. dblink capacity race).
Assumptions: A-2.1 a closure day added later cancels leave days too (not owed). A-2.2 shift_in blocked after planned end (review rule 4) and before start. A-2.3 CSV import creates unknown cohorts by name.

### Phase 8 lifecycle SQL — bb9b214; Edge Function — 5d34960
`supabase test db` → Files=12, Tests=204, PASS. Day-0 reminder is sent at completion/withdrawal (the 02:00 job would miss day 0).

### Merges
- Phase 1 UI (agent) → 2c490e7; gates: lint clean, typecheck clean, Vitest 98 passed, static build 10 routes.
- e2e harness (agent, cherry-picked) → a916363, 7693803; Playwright pinned 1.56.1 (matches /opt/pw-browsers chromium-1194); smoke 6 passed. e2e clock needs `supabase_admin` for `alter database` (local only).
- Selfie freshness now real-time based (a2b084e) so the e2e clock works.
- Phase 7 admin config RPCs (agent) → 6418d47; `supabase test db` Files=17, Tests=349 PASS.
- Leave days can be cancelled by closures (fix found by the P7 agent) → Files=18, Tests=352 PASS.

### Open items
- After P3 merges: allow clock-out on a closure day added the same day (redefine the P3 version of clock_block_reason).
- Release checklist: raising retention_days needs a new notice version (the notice promises 30 days).

### Database complete (main session, after the agents stopped at the usage limit)
- Merged hours engine (P3) + requests (P5); integration fixes (overtime payload key, test helper clash) → 69a7e01. 658 PASS.
- Preview verdict, supervisor-confirmation path, escalation job → 8829b78.
- Catch-up planner (§8.7) → 9cd037d.
- Retention purge SQL + certificate expiry + pg_cron→pg_net wiring via Vault → f1bd563.
- Clock-out allowed on a same-day closure → ff7c76b.
- Seed: ten weeks replayed through the real rules → ae92b3b (+ fixes). Local auth: email provider back on (public sign-ups still off) → 8151b0a.
- Tests independent of the seed; cache = compute on seed data → 3b4ed8f.
- KPI bundles + flagged events → f1f118f. `supabase test db`: Files=37, Tests=716, PASS.
- e2e golden path 1 (clock in/out, phone) → a413f1b: 1 passed.
- README + release checklist → 816abad, 84c6f26.
- Draft PR: https://github.com/willi220p-star/claudetimeclock/pull/1

Decisions: D14 (Dilip) no check-ins / Monday summary screens. Open question: an extra day adds to both expected and counted, so it closes the schedule gap but not the owed balance (R5.6 as written); overtime is the only thing that pays owed down.

### Final screen agents — recovered on this branch
The six worktrees under `.claude/worktrees/` and the `wip-*` remotes were gone. Screens and golden paths 2–5 were already on `claude/quirky-lovelace-ktg6f8` (`be22b63` plus follow-up fixes through `2cd242a`). `supabase/config.toml` was not staged.

### Screens + golden paths 2–5 — be22b63, e9f95fc, d0ca857, 756eed0, 2cd242a
Intern: Today/Clock, week Schedule (Next/Previous week), Requests, Progress (text forecast, no chart), Me, catch-up Option B, notifications.
Supervisor: Today board, Approvals + approve sheet (`approve`/`decline`), Interns, intern detail (Schedule/Hours/Requests/Work logs/Selfies — no Flags tab), uni report Confirm.
Admin: Overview, People, Placements wizard, Cohorts, Import, Requests. Sites/Closures/Settings/Audit/Reports stay D15 placeholders.
e2e: `swap.spec.ts`, `extra-spot.spec.ts`, `catch-up.spec.ts`, `uni-report.spec.ts` (Fatima / intern5, no PDF). Path 1 remains `clock.spec.ts`.

### Gates on this box (2026-09-25)
- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm test` — 13 files, 103 passed
- `GITHUB_PAGES=true npm run build` — 31 static routes
- brand grep `#[0-9a-fA-F]{6}` in `src/**/*.tsx` — only `src/components/dgk-logo.tsx`
- `supabase db reset` — **FAIL** `LegacyDbSetupError` (Docker overlay / Auth never binds :9999 on this VM)
- `npm run test:db` — not re-run here. Last healthy recorded run: Files=37, Tests=716 PASS
- `npx playwright test` — not re-run here (needs Auth on :54321). Last recorded: smoke 6 + path 1. Paths 2–5 written, not executed on this box.

**Dilip:** on your laptop, with Docker healthy: `supabase start && supabase db reset && npm run test:db` then `npx playwright test`. Do not point this app at the hosted project.

### Whole-branch review (this turn)
- `decide_request` uses `approve`/`decline`. Selfie freshness uses `issued_real_at`, not `clock_now`.
- `[auth] enable_signup=false` and `[auth.email] enable_signup=true` (email login stays on).
- No `service_role` / `sb_secret_` in `src/`.
- Deferred D4/D5/D13/D14/D15 not built. Admin cannot delete people (D12).
- Supervisor intern "Flags" column is hours flags on the day table, not the deferred Flags tab (`flagged_events`).
- `docs/progress/perf.md` and phase screenshots were not captured here (Auth down; 200-placement fixture not present).
- Draft PR #1 stays draft. **Do not merge.**

---

## 22. Final report

### What was built

**Phase 1 — Foundation & security**
- Darwin clock, integer minutes, sites/settings/closures, role flags + last-admin guard.
- Email sign-in, 12–72 passwords, consent pack, punch rules (geofence, selfie challenge, server time).
- RLS + default-revoke, brand tokens, PWA/CSP, local seed of test people.

**Phase 2 — Placements & schedule**
- Cohorts, placements, pattern versions, set-based generation, capacity 3/4/5 with advisory locks + dblink race test.
- CSV import with dry-run. Admin placement wizard, people, cohorts, import.
- Sites/Closures stay Studio placeholders (D15). RPCs `save_site` / `set_site_active` / `save_closure_day` / `remove_closure_day` are ready.

**Phase 3 — Hours engine**
- Shifts, `compute_day` cache, progress, forecast, risk, periods.
- Auto-close at 0 min until punch-fix (D3), day-close, reconcile. Work-log gate.

**Phase 4 — Intern experience**
- Clock desk (path 1), week schedule, requests, progress text, Me, notifications, catch-up sheet.
- Month calendar and forecast chart deferred (D15).

**Phase 5 — Requests & approvals**
- All 7 types + attendance confirmation. Preview before submit. Extra-spot through admin.
- Punch-fix limits, leave certificates / "sighted in person", catch-up planner.
- e2e paths 2–4 written.

**Phase 6 — Supervisor**
- Today board, approvals inbox, intern list + detail, uni report Confirm.
- Check-ins / Monday summary cut (D14). Flags tab deferred (D15).

**Phase 7 — Admin & KPIs**
- Overview KPIs, people (no delete), placements, requests, cohorts, import.
- Settings/Audit/Reports placeholders (D15). KPI RPCs and `audit_search` / `run_job` ready in the database.

**Phase 8 — Completion & retention**
- Extend / complete / withdraw, uni report approval (no PDF, D13), exit feedback.
- Reminders days 0/14/25. `purge_intern` + `retention-purge` Edge Function + nightly cron.

### Migrations (36)

`20260924040000_daymark` · `20260924041100_daymark_service_role_grants` · `20260924120000_create_staff_login` · `20260924160000_dgk_clock_site` · `20260924180000_reset_and_regus_radius` · `20260924200000_office_table_and_email_reset` · `20260925000100_time_settings_sites` · `20260925000200_roles_audit` · `20260925000300_accounts` · `20260925000400_consent` · `20260925000500_punch_rules` · `20260925000600_default_privileges` · `20260925010000_placements_schedule` · `20260925011000_requests_contract` · `20260925012000_import` · `20260925013000_e2e_clock` · `20260925013100_selfie_real_time` · `20260925014000_leave_kind_on_cancel` · `20260925020000_shifts_day_results` · `20260925020100_periods` · `20260925020200_progress` · `20260925020300_work_logs_clock_rules` · `20260925020400_jobs` · `20260925021000_closure_clock_out` · `20260925030000_today` · `20260925040000_request_validation` · `20260925041000_request_decisions` · `20260925042000_leave_certificates` · `20260925043000_request_preview_attendance_escalation` · `20260925044000_catch_up` · `20260925050000_kpis` · `20260925060000_admin_sites_closures` · `20260925061000_admin_settings_notices` · `20260925062000_admin_people_audit` · `20260925070000_lifecycle` · `20260925071000_retention_purge`

**Edge Function:** `supabase/functions/retention-purge` (cron secret header; Storage API + Auth Admin API + `purge_intern`).

**Cron (`pg_cron`, UTC; Darwin = UTC+9:30)**
| Job | Darwin | UTC |
|---|---|---|
| `daymark-auto-close` | 19:05 | `35 9 * * *` |
| `daymark-day-close` | 19:10 | `40 9 * * *` |
| `daymark-escalate` | hourly | `0 * * * *` |
| `daymark-reconcile` | 02:00 | `30 16 * * *` |
| `daymark-retention-reminders` | 02:01 | `31 16 * * *` |
| `daymark-clock-guard` | 02:02 | `32 16 * * *` |
| `daymark-retention-purge` | 02:03 | `33 16 * * *` |

Monday summary cron was not added (D14). GitHub Actions is not used for jobs.

### Test totals
| Gate | Result |
|---|---|
| Vitest | **103** passed (13 files) on this box |
| pgTAP | **716** passed (37 files), after `supabase db reset` on the cloud box |
| Playwright | **11** passed, 5 skipped (golden paths 1–5 run once, on the phone project; smoke on both) |
| lint / typecheck / `GITHUB_PAGES=true` build | clean; 31 static routes |
| Brand grep | only `DgkLogo` |

### Perf table (§8.13)
`docs/progress/perf.md` was not written. The 200-placement × 1 year fixture is not in the repo. Last recorded pgTAP suite (716) includes the hours/KPI tests against the 10-week seed. Capture `EXPLAIN (ANALYZE, BUFFERS)` on a healthy laptop if Dilip wants the budgets signed off:

| Operation | Budget | Actual |
|---|---|---|
| Clock in/out | p95 < 150 ms | not measured this turn |
| Intern dashboard RPC | p95 < 150 ms | not measured |
| Supervisor dashboard RPC | p95 < 250 ms | not measured |
| Admin dashboard RPC | p95 < 400 ms | not measured |
| Approve request | p95 < 150 ms | not measured |
| Catch-up options | p95 < 200 ms | not measured |
| Nightly jobs | < 5 s | not measured |

### Screenshots index
None under `docs/progress/screens/` this turn. Login on this VM shows "We couldn't reach DGK Clock" because Auth never binds. Dilip: `npm run dev` on port 41731 after `supabase start`, then photograph `/clock`, `/supervisor`, `/admin` at 390 px and 1280 px.

### Assumptions
- A1 GitHub Pages static export + Supabase (ADR 0001). basePath `/claudetimeclock`.
- A2 Jobs via `pg_cron` + `pg_net`.
- A3 Pace "days late" = calendar days between planned end and forecast.
- A4 Closure added after scheduling cancels the day and is not owed (also cancels leave days — A-2.1).
- A5 Clocking after target reached is blocked until confirm / extend / withdraw.
- A6 CSV first password is a temporary batch password; change forced at first sign-in.
- A7 Deletion only via `retention-purge` (D12: no admin delete).
- A8 One session, draft PR, no deploy.
- A9 Playwright allowed; axe-core not added.
- A10 Light theme only.
- A-D2 Branch is `claude/quirky-lovelace-ktg6f8`, not `feat/placement-system`.
- A-D3 Auto-close = 0 min until punch-fix approved (overrides R5.5.1).
- A-D4 No office code / kiosk.
- A-D5 No MFA now.
- A-D6 Full consent pack.
- A-D7 Clock window 19:00:00 inclusive.
- A-D10 Site + NT closures in a migration; seed is test people only.
- A-D11 Passwords 12–72.
- A-D13 No PDFs. Path 5 = supervisor approves the uni report.
- A-2.2 Shift-in blocked after planned end and before start.
- A-2.3 CSV import creates unknown cohorts by name.

### Open questions for Dilip
1. Extra day adds to expected *and* counted, so it closes the schedule gap but not the owed balance (R5.6). Overtime is what pays owed down. Confirm that is what you want.
2. MFA for staff (D5) — later, when you say "add".
3. CAPTCHA on sign-in/reset — later (needs an app widget first; turning it on in the dashboard now would block every login).
4. Move hosting if you want real security headers (GitHub Pages can only do a meta CSP).
5. Collection notice v1.0 has no email/phone. Publish v1.1 with your contact details before real interns (release checklist).
6. Hosted region: confirm Oceania (Sydney) before go-live.

### Manual test script (laptop, local seed)
Every seed password is in the README. Do this after `supabase start && supabase db reset && npm run dev`.

1. Phone width. Sign in as Aisha (`intern1@dgk.test`). Accept consent. Clock in too far away — you should see how far. Move to the office, clock in with the selfie, then clock out later the same day.
2. Still Aisha. Schedule → next week Friday → Swap → Move to Thursday → reason → Submit. Sign out.
3. Sign in as Priya (`sup1@dgk.test`). Approvals → Aisha's Swap → Approve. Sign back in as Aisha: Friday says Moved, Thursday is Scheduled.
4. Sign in as Ben (`intern2@dgk.test`). Schedule → a Full Wednesday → request extra spot → Submit.
5. Priya approves Ben's extra day. Then Dilip (`admin@dgk.test`) Approves it again on Admin → Requests. Ben's Wednesday becomes Scheduled.
6. Ben: Catch up → Option B → Send requests. Requests list shows Extra day rows waiting on supervisor.
7. Sign in as Tom (`sup2@dgk.test`). Interns → Fatima → Approve uni report → Confirm. No download button.
8. Fatima (`intern5@dgk.test`) → Me: uni report approved by Tom. Still no PDF.
9. Admin → People: set a password (write-only). There is no Delete. Sites/Closures/Settings/Audit say "coming in a later update".
10. Sign in as a supervisor, open Today, confirm the extra-spot marker after step 5. Sign out everywhere.

### Docker gates (cloud box, after the Cursor turn)
- `supabase db reset && npm run test:db` — Files=37, Tests=716, PASS.
- `npx playwright test` — first run: all 5 golden paths failed on selectors that matched two elements, and path 1 waited for "Day done", which never shows while only the database clock is frozen (the card's "today" is the browser's real date). Fixed in the specs, no rule weakened: pick the request by its date and chip ("Waiting for supervisor"), and check the server-stamped "clocked out at 4:55 pm" toast. Now 11 passed, 5 skipped.
- Balance card said "Owed 5h 45m · 5h 45m"; the repeat is gone.
- lint, typecheck, Vitest 103, `GITHUB_PAGES=true` build, brand grep: clean.

### Release
Draft PR: https://github.com/willi220p-star/claudetimeclock/pull/1  
Checklist for Dilip: `docs/RELEASE-CHECKLIST.md`. **Do not merge. Do not deploy GitHub Pages. Do not touch hosted Supabase `lnagrfdbmwtlymhumepc`.**

**STOP.**

### Deferred features built (Dilip, 2026-09-25 night)
Four agents in parallel, merged on `claude/quirky-lovelace-ktg6f8`:
- Check-ins, Monday summary (Mon 08:00 Darwin cron), late alert at clock-in, left-early alert at day close, supervisor Flags tab and check-ins KPI — migration `20260925080000_checkins_alerts.sql`, pgTAP `080_checkins_alerts.sql` (44 tests). Applied to the preview project only.
- Admin Sites, Closures, Settings (notice publishing, run a job) and Audit screens.
- Intern month calendar, forecast chart (recharts), visa fortnight card, medical certificate upload (consent → upload → attach; supervisor view + sighted), live notifications (Realtime), idle sign-out, sign out all devices. Plain Sign out is now this device only.
- Uni hours report and completion certificate PDFs (@react-pdf/renderer, lazy); CSP adds `'wasm-unsafe-eval'` and `connect-src data:`. Missing weeks (closure weeks) are listed with zeros.
Gates: lint, typecheck, Vitest 142, pgTAP 38 files / 760, Playwright 11 passed / 5 skipped, static build, brand grep.

### Records, roster and add-intern (Dilip, 2026-09-26)
Dilip's answers: admins edit and delete, supervisors view only; the audit log and consent records are never deleted; the add-intern form asks for the full placement; supervisors see their own interns, week view first.
- "Uni report" is now "Intern report" everywhere (UI, PDF title and file name `Intern-report-…pdf`, notifications). SQL function names stay.
- Visa self-check (fortnight card) removed with `fortnightLabel` and `loadFortnightHours`.
- Add person: ticking Intern asks for supervisor, university, course, start/end dates, days with start/finish times and target hours ("Use roster" fills the roster total). `create_intern` adds the login, placement and roster in one transaction; full days still need "Allow extra spots".
- Roster (`/admin/roster`, `/supervisor/roster`): Week (default), Month (tap a day) and a two-week day-by-day List.
- Records (`/admin/records`, `/supervisor/records`): every table with counts, search, record preview; admins edit whitelisted fields (`update_record`) and delete (`delete_record`, `delete_person`), audited, with hours rebuilt and stored files removed. Storage card: usage per bucket and clean-ups (read notifications, used clock-in codes, old selfies → `photo_deleted_at`, files nothing uses).
- Deleting a person keeps their consent records (person link set to null) and the audit log. Admins can now delete stored files and read all notifications and clock-in codes.
- Phone: staff tab strip scrolls the current tab into view; new screens checked at 390 px.
- Migration `20260926010000_records_roster.sql`, pgTAP `090_records.sql` (45), e2e `records-roster.spec.ts`.
Gates: lint, typecheck, Vitest 151, pgTAP 39 files / 805, Playwright 13 passed / 7 skipped, static build, brand grep.

### Clock always on; audit log keeps the actor's name (Dilip, 2026-09-26)
Dilip's answers: lift the weekday/office-hours/closure block entirely (weekends + time window + closures); keep GPS+selfie and the placement's start/end dates; a day/time outside the roster still counts 0 hours until approved (unchanged, needed no code); store the actor's name on the audit row forever, even after that person is deleted.
- `private.clock_block_reason` no longer blocks on weekday, the site's clocking window or a closure day (R5.1.2 lifted, D16). Kept: inactive login, no/ended placement, target reached, the placement's own start/planned-end dates, in/out sequence, the previous day's work-log gate (R5.1.6), the office headcount cap for an unscheduled shift (R5.1.8), and the 60-second rate limit.
- `daymark_audit_log` gained `actor_name text`, filled by `private.audit()` at write time. No backfill: the audit log is append-only (its trigger raises on any update, no exceptions), so existing rows keep it null and fall back to `audit_search`'s live profile join, same as before. `audit_search` and the Records tab's Audit log both prefer the stored name (D17).
- Removed the now-dead `weekend`/`closure`/`window` block-reason branches from the ClockCard's `blockFix`.
- Flagged, not changed: the collection notice still says clocking never happens outside Mon–Fri 7am–7pm, which is no longer true — publishing new wording needs a new notice version and interns re-consenting, a call for Dilip (see program-design spec, Deferred).
- Migration `20260926020000_clock_always_on.sql`. Updated pgTAP: `005_punch_rules.sql` (weekday/weekend/closure now `lives_ok`), `027_closure_clock_out.sql` (a closure blocks nothing, not even re-entry), `030_today.sql` (a still-valid `not_started` block code in place of `weekend`).
Gates: lint, typecheck, Vitest 151, pgTAP 39 files / 805, Playwright 13 passed / 7 skipped, static build, brand grep.

### Profile, Home, banners, roster edits, full delete (Dilip, 2026-09-29)
Dilip's answers: delete means everything about the person, and the consent notice must say so; skip "report anytime" (item 9); roster changes by date range and single day; Home in the screenshot's layout, DGK colours.
- Always-on fixes: auto-close 12 hours after clock-in (hourly job, was 7:05 pm), overnight shifts pair across midnight on their start day, punch fixes at any hour. The Home status and the client now break a same-instant tie (auto clock-out stamped at the clock-in) the same way as the clock rules; the seed's Chloe showed a false "Clock in before you clock out".
- Home: greeting with the latest clock selfie as the avatar, "Clocked in since" with a green dot, and "Your roster" dots for today plus six days (`rollingWeek`).
- Me: profile card with photo, name (self-edit, `update_my_name`, audited), email (read-only), supervisor and Change password. Staff get Change password in the footer.
- Banners (`daymark_banners`, `save_banner`, `end_banner`, `current_banners`): admin → everyone, supervisor → own interns; sticky or moving text (still under reduced motion); per-device hide. Managed from Admin → Settings and the supervisor Today screen.
- People: "Supervisor: X" / "Supervises: A, B" per row, and Delete account.
- Full delete (`erase_person`, D18) for People, Records and the 30-day purge; collection notice v1.1 published by the migration (interns re-acknowledge before their next clock-in). The Edge Function no longer deletes the Auth user itself.
- Roster edits (D20): `staff_add_day`, `staff_move_day`, `staff_cancel_day`, `set_pattern_range`; `set_pattern` opened to the intern's supervisor. Roster rows open a Move / Change times / Remove sheet, "+" adds a day, "Change days" sets a date range. The admin placement screen shows the pattern history.
- Migration `20260929010000_profile_banner_roster.sql`; pgTAP `100_profile_banner_roster.sql` (44) plus updates to 004, 025, 027, 044, 062, 071, 090; e2e `home-banner-roster.spec.ts`.
Gates: lint, typecheck, Vitest 153, pgTAP 40 files / 850, Playwright 16 passed / 10 skipped, static build, brand grep.

### Breaks, Timesheets, staff time edits, catch-up picker, navigation tree (Dilip, 2026-10-05)
Dilip's answers: Break shows 10 am–2 pm and Finish is always there, both in a popup like his reference (drawn office map, no third-party map); breaks are unpaid and topped up to the intern's assigned break (set when adding the intern, default 30) on days over 5 h; staff edits count straight away and only admin/supervisor change times or rosters; catch-up days go to the supervisor; capacity normal 4, max 5; bottom tabs + sub-tabs; location and selfie required to clock (no supervisor route) and Privacy on the Me tab.
- Clock sheet (`src/app/clock/clock-sheet.tsx`): drawn office map from one location read, live selfie inset, Start · Break · Finish, one big button; the gesture challenge and selfie follow as before. A break is a clock-out/clock-in marked `is_break` (D21). Home shows Start break and Clock out side by side in the break window, "On a break since", and "Clocked out at … · Xh today" with Clock in again (the old "Day done" card hid the button, item 20).
- Assigned break (`placements.break_minutes`, D22): in Add intern, the placement wizard and the placement screen. `compute_day` tops the gaps up to it on days over 5 h; roster `planned_minutes` is no longer a generated column — a trigger fills it from the placement's break, and a changed break re-plans today and later.
- No 60-second rule; Finish needs that day's work log (inline in the clock sheet), breaks never do (D23).
- Timesheets (`/admin/timesheets`, `/supervisor/timesheets`): week totals, then each day's sessions per intern with breaks, counted time, flags and "Edited by …"; tap a time to change it or add a missing session (`staff_edit_times`, D24). Replaced punches stay in the table, hidden.
- Catch-up picker (D25): `catch_up_slots` / `submit_catch_up_days` replace the A/B plan; per-day Full day / Morning / Afternoon / Custom, Quick fill, "Back on track by"; Schedule has "Add my roster to my phone calendar" (.ics built in the browser).
- Consent required (D26): `request_supervisor_confirmation` dropped; consent screen and Home say both are needed; Privacy moved to Me with a confirm before withdrawing. Collection notice v1.2 published by the migration (interns re-acknowledge).
- Navigation tree (D27): admin Home / People / Time / Reports / Settings, supervisor Today / Time / Approvals / Interns; bottom tabs and sub-tab pills on phones, grouped sidebar on desktop. The office board shows "On a break".
- Capacity: Regus Palmerston set to normal 4, max 5 on the preview database (a data change, like Admin → Sites; the local test office stays 3/4).
- Seed: work logs are written before the clock-out. Tests: `tests.clock` writes the day's log before a Finish unless `p_log => false`; 013 and 061 now clear the seed (its dates move with today).
- Migration `20261005010000_breaks_timesheets_catchup.sql`; pgTAP `110_breaks_staff_edits.sql` (30), rewritten `047_catch_up.sql`, updates to 004, 005, 013, 020, 021, 024, 046, 050, 061, 062, 080; e2e `clock.spec.ts` (break + log before Finish), `catch-up.spec.ts`, new `timesheets-nav.spec.ts`.
Gates: lint, typecheck, Vitest 166, pgTAP 41 files / 883, Playwright 20 passed / 12 skipped, `GITHUB_PAGES=true` build, brand grep.
Preview: Regus Palmerston set to 4/5 (audited). Applying the migration timed out twice waiting for approval of its `drop` statements, so the PR (https://github.com/willi220p-star/claudetimeclock/pull/9) waits: apply the migration to preview first, then merge.

### Day type, any-order clocking, staff breaks, absences, bulk decisions, deleting notifications, detailed profile, clickable dashboards, Progress charts (Dilip, 2026-10-08)
Dilip's answers: a work-based 5 h day counts as a full day only once a supervisor or admin approves it; typed-in times are requests that count after approval; breaks keep the office distance check; an absent day's hours are owed.
- Home: required Full day / Work-based choice above Clock in (`choose_day_kind`, `daymark_day_kinds`, D28); `start_clock` refuses a first clock-in without it. `compute_day`: work-based days take no break; approved, `counted` is at least the rostered day.
- Clock sheet: every segment is selectable (D29). Not clocked in → Break/Finish ask when you arrived; on a break → Finish asks when it ended (`report_missed_time`: a `supervisor`-source punch, unverified until the attendance request — now labelled "Typed-in time" — is approved; supervisor and admins notified). Home on a break also offers Clock out.
- Timesheets: Add break (`staff_add_break`, D30), break labels in the edit sheet, chips for Absent, Typed in · waiting, Work-based · status.
- Roster day sheet: Mark absent with a reason (`staff_mark_absent`, D31), past rostered days open too; Absent shows on the roster, the intern's Schedule and their profile.
- Bulk approve/decline on Supervisor → Approvals and Admin → Requests, plus a Work-based days panel (D32). Removed the unused `approvals-list.tsx`.
- Notifications: select, Delete selected, Delete all (`delete_my_notifications`, D33).
- Migration `20261008010000_flexible_clock_absent.sql`; pgTAP `120_flexible_clock_absent.sql` (28), `tests.clock` picks Full day before a first clock-in, 005 picks it explicitly; Vitest `segment-plan.test.ts`, `bulk-decide.test.ts`; e2e `clock.spec.ts` now picks Full day, forgets to end the break, types its end at Finish, then the supervisor bulk-approves and deletes notifications.
- Intern profile (supervisor and admin): summary tiles (days worked, absent, swapped, late, weeks the required hours were met, this week, total vs target) and a Timesheet tab (default) with each day's clock-in, breaks, clock-out, sessions and total, chips (Late, Edited, Typed in · waiting, Work-based), filters All / Worked / Absent / Swapped / Late and a date range (`src/lib/profile-stats.ts`).
- Selfies load again: links were signed for 60 s at page load and expired before the tab opened. Now signed when shown, re-signed once on error, else "Photo removed" (`SelfieImage`, `signSelfies`); Timesheets thumbnails use it too.
- Dashboards: every KPI card on Supervisor Today and Admin Overview links to the list behind it; Interns takes `?filter=at_risk`, Placements `?status=` / `?pace=` with Clear filters.
- Progress charts (recharts, colours from tokens, a text summary and "Show the numbers" table for each): intern (this week per day and per shift, weekly vs rostered, forecast, attendance breakdown), new Supervisor Interns → Progress (fortnight hours vs roster, attendance/on-time, owed ranking) and Admin Reports → Progress (progress to target, office bookings vs capacity, requests by status and age) (`src/lib/chart-data.ts`, `BarChart`).
- Built in parallel by three workers in separate worktrees, merged here; e2e `profile-dashboard-progress.spec.ts`.

### Installable app and offline clock-in (Dilip, 2026-10-08) — PR A of the offline/push plan
Design and plan: `docs/superpowers/specs/2026-10-08-offline-push-design.md`, `docs/superpowers/plans/2026-10-08-offline-push.md`. Dilip's answers: offline clocks are queued and need supervisor approval (flagged Offline), the phone picks the gesture; face matching skipped (security review §3).
- Service worker (D34): hand-written (`scripts/sw-template.js` → `out/sw.js` via `scripts/sw.mjs` after `next build`), Pages build only; app files precached, pages network-first with the saved copy offline, Supabase never cached; "New version ready · Reload". Me → "Install DGK Clock". Serwist was skipped: its Next integration needs @swc/core and esbuild for one file.
- Offline clock-in (D35): `src/lib/offline-queue.ts` (IndexedDB, `applyQueue`, gestures), `src/lib/offline-sync.ts` (sends in order on open, on `online` and every minute; refused clocks are reported). The clock sheet switches to offline mode with no signal or when a save drops mid-way; work logs and typed times queue too. Home works offline from the cached status, profile and consent; the day type can be picked offline.
- Server: `submit_offline_punch` (idempotent `offline_id`, own selfie required, ≤ 2 days old, day kind set from the first clock-in), shared `request_punch_confirmation` / `save_day_kind`, attendance confirmations within 7 days, notice v1.3. Approve sheet shows the reason and the selfie; Timesheets and the profile show "Offline · waiting".
- Tests: pgTAP `130_offline_clock.sql` (20) plus 004/062 moved to test notice 9.1; Vitest `offline-queue.test.ts`, `offline-sync.test.ts`; e2e `offline-clock.spec.ts`; the served `out/` was checked in Chromium (worker active, 266 files saved, `/clock/` opens offline).

### Push reminders (Dilip, 2026-10-08) — PR B of the offline/push plan
Dilip's answers: reminders for not clocked in, break running long, forgot to clock out, and staff pushes for new requests; no pushes 9 pm–7 am.
- Migration `20261010010000_push_reminders.sql`: `daymark_push_subscriptions` (own rows, cascade on erase), `save_push_subscription` / `delete_push_subscription`, `daymark_push_outbox` filled by a trigger on notifications for push-worthy kinds when the person has a phone, `push_send_after` (quiet hours), `job_reminders` (every 5 min, once per person/kind/day via `daymark_reminders_sent`), `call_send_push` (every minute, only when something is due; Vault `project_url` + `cron_secret`), `push_due` for the Edge Function.
- Edge Function `send-push` (`npm:web-push`): sends due rows, drops phones that answer 404/410, retries others up to 3 times. Pure helpers tested under Vitest (`supabase/functions/send-push/push.test.ts`).
- Service worker shows the push and opens its link on tap. "Reminders on this phone" on Me and Notifications (iPhone asks to install first). VAPID public key in the Pages build env; private key and subject are Edge Function secrets (D36).
- Tests: pgTAP `140_push_reminders.sql` (21); Vitest `push-toggle.test.ts`, `push.test.ts`.

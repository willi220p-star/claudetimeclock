# DGK Clock build log

Resume here. Continue from the first unchecked item. Each entry lists the commit SHA, the commands run and their results, and any decisions.

- Branch: `claude/quirky-lovelace-ktg6f8`
- Repo: `willi220p-star/claudetimeclock`

## Checklist

### Phase 0 — Bootstrap
- [x] 0.1 Import presence-tracker@b7f9ab5 (dc77dce)
- [x] 0.2 Build prompt, security review, ponytail rules in AGENTS.md, CONTEXT.md, ADRs 0001–0003, program spec, Phase 1 spec and plan, this log

### Phase 1 — Foundation & security (plan: docs/superpowers/plans/2026-09-25-dgk-clock-phase1-foundation.md)
- [ ] 1.1 Harness
- [ ] 1.2 Darwin time (TS)
- [ ] 1.3 Minutes and periods (TS)
- [ ] 1.4 Time, settings, sites (SQL)
- [ ] 1.5 Roles and audit (SQL)
- [ ] 1.6 Accounts (SQL)
- [ ] 1.7 Consent (SQL)
- [ ] 1.8 Punch rules (SQL)
- [ ] 1.9 RLS and anon sweep (SQL)
- [ ] 1.10 Roles and routing (TS)
- [ ] 1.11 Sign-in and passwords (UI)
- [ ] 1.12 Consent screen (UI)
- [ ] 1.13 Clock desk on new RPCs (UI)
- [ ] 1.14 Admin desk on new RPCs (UI)
- [ ] 1.15 Brand tokens and fonts
- [ ] 1.16 Shared components
- [ ] 1.17 PWA and CSP
- [ ] 1.18 Seed
- [ ] 1.19 Gates, review, docs, tag

### Phase 2 — Placements & schedule (plan written at phase start)
- [ ] 2.x cohorts, placements, pattern versions/days, generate_days, assert_capacity + constraint trigger, R5.2.5, CSV import dry-run, admin placement screens + wizard, must_change_password flow, segregation of duties

### Phase 3 — Hours engine
- [ ] 3.x shifts, compute_day + day_results cache, progress, forecast, risk, periods SQL, auto-close (D3) / day-close / reconcile jobs (pg_cron), overtime auto-requests, work logs table + R5.1.6, perf fixture

### Phase 4 — Intern experience
- [ ] 4.x notifications + Realtime, Today/ClockCard, Schedule, Progress, work-log gate UI, who's in (x/3), read-only banner, privacy page, idle sign-out, fortnight summary. e2e path 1

### Phase 5 — Requests & approvals
- [ ] 5.x 7 request types, validate/preview, state machine, extra spot, escalation job, leave docs bucket, punch fix (+limits), catch-up planner, supervisor confirmation path. e2e paths 2–4

### Phase 6 — Supervisor
- [ ] 6.x today board, approvals inbox + sheet, at risk, intern detail, check-ins, Monday summary job + page, flagged events view

### Phase 7 — Admin & KPIs
- [ ] 7.x overview KPIs, heatmap, placements table, people/sites/closures/settings/audit, run_job, perf.md

### Phase 8 — Completion & retention
- [ ] 8.x lifecycle actions, read-only mode, uni report + certificate PDFs, exit feedback, reminders 0/14/25, retention-purge + purge_intern + cron, 7-day certificate purge. e2e path 5. Whole-branch review, draft PR

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
- A-D12: No admin delete of people; deletion only via retention purge.
- A-0: The spec bundle zip was not supplied; CONTEXT.md, ADRs and specs were authored from the build prompt.
- A-1: Supabase CLI installed globally, not added to package.json (§5.5 unchanged).

## Log

### 0.1 Import — dc77dce
`tar` copy of presence-tracker@b7f9ab5, `npm ci` → found 0 vulnerabilities.

### 0.2 Bootstrap docs
Docker daemon started manually (`dockerd`), `supabase init`, config: site_url 127.0.0.1:41731, signups off, min password 12, studio/analytics off. `supabase start` OK (Postgres 17.6; pg_cron 1.6.4, pg_net 0.20.4, pgtap 1.3.3, dblink available).

# Phase 1 plan: foundation and security

Every task follows the same loop: write the failing test, run it and see it fail, write the minimum code, run it and see it pass, commit (`type(scope): … R-number`), then log it in BUILD-LOG.

- [ ] **1.1 Harness.** Add devDependencies `vitest jsdom @testing-library/react @testing-library/dom @testing-library/jest-dom @types/node@^22`. Add `vitest.config.mts` (jsdom, `@` alias, esbuild automatic JSX) and scripts `test`, `test:db` (`supabase test db`) and `typecheck` (`next typegen && tsc --noEmit`). Add `supabase/tests/000_setup.sql` with helpers `tests.create_person`, `tests.as_person`, `tests.as_anon`, `tests.reset_role`, `tests.at` (sets `daymark.test_now`). Smoke: one Vitest and one pgTAP assertion.
- [ ] **1.2 Darwin time (TS).** `src/lib/darwin.ts`: `darwinDateKey`, `formatDay` ("Tue 14 Oct"), `formatTime` ("9:00 am"), `formatTimeOfDay("09:00:00")`, `relativeOrDate`. Tests cover a UTC-evening instant that is already tomorrow in Darwin.
- [ ] **1.3 Minutes and periods (TS).** `src/lib/minutes.ts` (`formatMinutes`, `plannedMinutes` R5.2.4) and `src/lib/periods.ts` (`mondayOf`, `fortnightIndex` with a real floor, `fortnightStart`, `weekNo`, `totalWeeks` R5.7).
- [ ] **1.4 Time, settings, sites (SQL).** pgTAP `001` then migration `…0100`. Tests: `clock_now` honours `daymark.test_now` for postgres; `darwin_today` flips at 14:30 UTC; settings singleton; the Regus site row; 21 closure days; RLS readable by authenticated, not anon.
- [ ] **1.5 Roles and audit (SQL).** pgTAP `002` then migration `…0200`. Tests: flags backfilled; `role` gone; `is_admin()`; the last active admin can't be demoted, deactivated or deleted; a second admin can; audit rows can't be updated or deleted; authenticated can't write the audit log or update profiles directly.
- [ ] **1.6 Accounts (SQL).** pgTAP `003` then migration `…0300`. Tests: leak functions and the secrets table are gone; `create_person` is admin only, validates email and a 12–72 password, sets `must_change_password`; `set_person_password` is admin only and never stores the password (no column holds it); the person's own password change clears the flag; `set_person_access` is audited.
- [ ] **1.7 Consent (SQL).** pgTAP `004` then migration `…0400`. Tests: notice v1.0 with its SHA-256; `record_consent` appends only; `has_consent` follows the latest decision and needs the current notice acknowledged; withdrawal flips it; no update or delete.
- [ ] **1.8 Punch rules (SQL).** pgTAP `005` then migration `…0500`. Edge cases:
  - 06:59:59 is rejected and 19:00:00 is allowed
  - 199.9 m is accepted and 200.1 m is rejected
  - accuracy 151 is rejected
  - a closure day and a Saturday are rejected
  - a second `shift_in` is rejected
  - `shift_out` without an open shift is rejected
  - a break type is rejected
  - no consent → rejected; an expired, used or someone else's challenge → rejected
  - a missing selfie object or one created too late → rejected
  - within 60 s → rejected
  - `occurred_at` is the server time, not `client_reported_at`
  - flags are set
  - a direct insert is denied
  - a system `auto_close` punch without a photo is accepted from definer context
- [ ] **1.9 RLS and anon sweep (SQL).** pgTAP `006`: anon can't select any `daymark_%` table or execute any `public` function except a whitelist; intern A can't read intern B's profile or punches.
- [ ] **1.10 Roles and routing (TS).** `src/lib/roles.ts` (`rolesOf`, `homeFor`) with tests. Update `daymark.ts` types and remove geocoding and login-domain helpers. Rewrite `browser-session.ts` and `desk-gate.tsx` for flags. Delete `profile.ts`, `supabase/server.ts`, `supabase/update-session.ts` and `functions/create-staff`.
- [ ] **1.11 Sign-in and passwords (UI).** Email sign-in, a neutral reset message, the `/set-password` page, and a `/supervisor` placeholder.
- [ ] **1.12 Consent screen (UI).** `/consent` reads the notice from the DB, has an acknowledgement checkbox, and separate location and selfie choices. Intern pages redirect there until the notice is acknowledged.
- [ ] **1.13 Clock desk on the new RPCs (UI).** `start_clock` → camera with the gesture → upload `<uid>/<challenge>.jpg` → `clock_punch`. Location is read on tap. Break UI removed.
- [ ] **1.14 Admin desk on the new RPCs (UI).** People by email, role checkboxes, write-only password, deactivate.
- [ ] **1.15 Brand tokens and fonts.** `globals.css` tokens (§15), Inter, pill buttons, focus ring.
- [ ] **1.16 Shared components.** Build and test `DgkLogo`, `StatusChip`, `MetricCard`, `PageHeader`, `EmptyState`, `ProgressRing`, `PaceChip`, `MinutesText`, `DayStatusBadge`, `EffectPreview`, `RoleSwitcher`, `NotificationBell`. Use them in the header.
- [ ] **1.17 PWA and CSP.** `app/manifest.ts`, `scripts/icons.mjs` (sharp, dev), and the meta CSP in the layout. `basePath` becomes `/claudetimeclock`.
- [ ] **1.18 Seed.** `supabase/seed.sql` with local people (admin@dgk.test and others). Password `Password-1234` for local only.
- [ ] **1.19 Gates, review and docs.** All §17 gates, the reviewer subagent, README, CONTEXT, `docs/releases/phase-1.md`, tag `phase-1-done`, push.

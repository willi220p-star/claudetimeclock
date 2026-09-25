# DGK Clock

DGK Clock is the intern placement system for DGK Business Consultancy. Interns on university placement clock in at the office (Regus, Level 1, 1 Palmerston Circuit, Palmerston City NT 0830), and the app turns their shifts into hours that a supervisor approves and a university can trust.

It runs as a phone-friendly web app at <https://willi220p-star.github.io/claudetimeclock/>. Every date and time is Darwin time.

## Who uses it

A person signs in with their email and password. They hold one or more roles:

- **Intern**: a university student on placement. The only role that clocks in.
- **Supervisor**: looks after their own interns and approves their requests.
- **Admin**: Dilip. Can do anything and gets escalations. There is always at least one active admin.

A person with several roles lands on their highest role's home (admin, then supervisor, then intern). The header has a role switcher that lists only the roles they hold.

There are no public sign-ups. The admin creates every login.

## What each role can do

### Interns (`/clock`)
- Read the collection notice and choose, separately, whether to allow location and a selfie. Saying no is fine: your supervisor confirms you're at the office instead.
- Clock in and out on your phone. Location is read once, on the tap. You take a live selfie while showing the gesture the app asks for ("Give a thumbs up"). It only works within 200 m of the office, Mon–Fri 7:00 am–7:00 pm, and not on a closure day.
- Write a short work log for each day. You need yesterday's log before your next clock-in.
- See who's in today as **x/3**, your week, your owed or ahead balance, your pace and "Week 6 of 13".
- Ask for a change: swap a day, change times, add an extra day, take leave, fix a punch, or change your usual days. Every request shows its effect before you send it.
- If you owe hours, pick a catch-up plan: longer days (A) or extra days (B).
- After your placement ends you can still view your records for 30 days, and give exit feedback.

### Supervisors (`/supervisor`)
- See today's board: who's in, who's late, and the extra-spot marker.
- Clear approvals with one tap. Each one shows its effect and the office count after approval. Overtime can be approved in part.
- See which interns are at risk, and why.
- Open an intern to see their schedule, hours, requests, work logs and selfies.
- Confirm attendance for interns who said no to location or selfie.
- Extend a placement, confirm completion, withdraw it, and approve the uni report once hours are final.
- You can never approve your own request.

### Admin (`/admin`)
- See the overview: "% on pace" first, then the at-risk list, escalated requests, desk use and who's finishing soon.
- Create placements with the wizard, or import a CSV with a dry run first.
- Manage people by email: role checkboxes, a write-only "Set password" field and deactivate. People aren't deleted by hand; the retention purge does that.
- Manage cohorts, sites, closure days, settings and the collection notice.
- Decide any request, including escalated ones and extra spots.
- Read the audit log.

## Rules at a glance
- The office holds **3** interns a day. A 4th (an **extra spot**) needs the supervisor and then the admin. A 5th is impossible.
- Hours count by length, not by window. A shift over 5 hours loses a 30-minute break unless there was a 30-minute gap.
- A shift with no clock-out by 7:00 pm is auto-closed at its own clock-in time, so it counts **0** until a punch fix is approved.
- A request waiting more than 72 hours goes to the admin. Nothing is ever approved automatically.
- Everything about an intern is permanently deleted 30 days after their placement ends. Uploaded medical certificates go 7 days after the leave decision.
- There are no uni report or certificate PDFs. The supervisor approves the report in the app.

## Architecture
- **Static site on GitHub Pages.** Next.js builds a static export under `/claudetimeclock`. There's no server at runtime: no server actions, route handlers or dynamic segments. Detail pages use query strings (`/admin/placement?id=…`).
- **All rules live in Postgres.** Constraints, triggers, row-level security on every table, views and functions. The browser only displays and submits, and the database checks everything again.
- **Private definer, public invoker.** Privileged logic sits in `private` `SECURITY DEFINER` functions with `set search_path = ''`. The app calls thin `public` `SECURITY INVOKER` wrappers. Execute is revoked from `public` and `anon`, then granted to `authenticated`. Punches, requests and consent are written through RPCs only, and the audit log is append-only.
- **Scheduled jobs in `pg_cron`.** Auto-close (7:05 pm), day close (7:10 pm), escalation (hourly) and the nightly run (2:00 am: reconcile, retention reminders, clock guard, purge). Cron runs in UTC; the times here are Darwin time.
- **`retention-purge` Edge Function.** `pg_cron` calls it through `pg_net` with an `x-cron-secret` header. It removes Storage objects through the Storage API, deletes the rows with `purge_intern` in one transaction, then removes the Auth user.
- **Darwin time, server clock.** Every date is an `Australia/Darwin` date (UTC+9:30, no daylight saving). Rules read time from `private.clock_now()`, never from the phone. Minutes are whole numbers everywhere.

The decisions behind this are in `docs/adr/`.

## Local development

You need Node 22, Docker (running) and the Supabase CLI (`npm i -g supabase`).

```bash
npm ci
supabase start        # local Postgres, Auth, Storage and Realtime in Docker
supabase db reset     # rebuilds the whole schema from migrations and loads supabase/seed.sql
supabase status       # prints the local API URL and keys
```

Create `.env.local` with the values from `supabase status`:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<the publishable key from supabase status>
```

`.env.example` points at the live project. Don't use it for local work.

```bash
npm run dev           # http://127.0.0.1:41731
```

Handy local tips:
- Password reset emails land in the local mail catcher at <http://127.0.0.1:54324>.
- Camera and location work on `127.0.0.1` without HTTPS. To pretend you're at the office, open Chrome DevTools → Sensors → Location and set `-12.4785082`, `130.9854825`.
- To pretend it's a certain Darwin time, use the local test clock. It's for your laptop only. Never set it on the live database.

  ```bash
  psql postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres \
    -c "alter database postgres set daymark.e2e_clock = 'on'" \
    -c "alter database postgres set daymark.test_now = '2026-10-06T08:55:00+09:30'" \
    -c "notify pgrst, 'reload schema'"
  ```

  Give it a few seconds. To go back to the real time:

  ```bash
  psql postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres \
    -c "alter database postgres reset daymark.test_now" \
    -c "alter database postgres reset daymark.e2e_clock" \
    -c "notify pgrst, 'reload schema'"
  ```

  `e2e/fixtures.ts` does the same thing for the Playwright tests. If the test clock is ever left on, every admin gets a "The test clock is switched on" notification from the nightly check.

## Tests and gates

Run these before every merge. They're the gates from build prompt §17.

```bash
npm run lint
npm run typecheck                        # next typegen && tsc --noEmit
npm test                                 # Vitest
supabase db reset && npm run test:db     # pgTAP, supabase/tests/*.sql
npx playwright test                      # e2e on a 390 px phone and a 1280 px desktop
GITHUB_PAGES=true npm run build          # the static export GitHub Pages serves
grep -rn "#[0-9a-fA-F]\{6\}" src --include=*.tsx   # brand check: only the logo SVG may match
```

For Playwright, run `npx playwright install chromium` once on a new machine. `e2e/README.md` explains the helpers and the local test clock.

## Seed accounts (local only)

`supabase db reset` loads these people. Every password is `Password-1234`. They exist only on your local stack, never on the live project.

| Email | Roles |
|---|---|
| `admin@dgk.test` | Admin |
| `sup1@dgk.test`, `sup2@dgk.test` | Supervisor |
| `dual@dgk.test` | Supervisor and intern |
| `intern1@dgk.test` … `intern7@dgk.test` | Intern |

## Where the docs are

| File | What it's for |
|---|---|
| `docs/BUILD-PROMPT.md` | The binding spec: rules R5.x, algorithms, requests, data model, screens, KPIs |
| `docs/superpowers/specs/2026-09-25-dgk-clock-program-design.md` | Decisions D1–D13 that override the build prompt for this repo |
| `docs/SECURITY-REVIEW.md` | Consent, privacy and security review |
| `CONTEXT.md` | Glossary. Use these words in code and copy |
| `docs/adr/` | Architecture decisions |
| `docs/progress/BUILD-LOG.md` | Build progress, commands run and assumptions |
| `docs/releases/phase-1.md` … `phase-8.md` | Release notes and manual steps per phase |
| `docs/RELEASE-CHECKLIST.md` | Going live, step by step |
| `docs/MANUAL-TEST.md` | A 10-step check you can do on your phone |
| `e2e/README.md` | The Playwright harness |
| `AGENTS.md` | Rules for coding agents working in this repo |

Pushes to `main` publish the site through `.github/workflows/pages.yml`.

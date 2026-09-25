# End-to-end tests (Playwright)

Build prompt §16 and gate §17 (`npx playwright test`). Chromium only, two projects:
`mobile` (390×844, touch, 3× DPR, phone user agent) and `desktop` (1280×800). Both run in
`Australia/Darwin`, `en-AU`, with geolocation and camera granted, the office as the GPS position,
and Chromium's fake camera.

## Run

```bash
supabase start                      # local stack on 54321/54322
# .env.local: NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 and the local publishable key
E2E_RESET=1 npx playwright test     # supabase db reset (migrations + seed), then every spec
npx playwright test e2e/smoke.spec.ts --project=mobile
npm run e2e                         # same as npx playwright test
npx playwright show-trace e2e/test-results/<test>/trace.zip   # after a failure
```

Playwright starts `npm run dev` on port 41731, or reuses one that is already running. Tests run one at a
time because they share one database and a database-wide test clock. Don't run them while
`supabase test db` runs on the same stack. On a new machine, `npx playwright install chromium` once; where
browsers are pre-installed under `PLAYWRIGHT_BROWSERS_PATH`, the config falls back to the newest Chromium there.

## Helpers (`e2e/fixtures.ts`)

| Helper | What it does |
|---|---|
| `test`, `expect` | Playwright's, plus a `consoleErrors` fixture (console errors and uncaught page errors). |
| `SEED` | Seed logins: `admin@dgk.test`, `sup1@`/`sup2@`, `dual@`, `intern1@`…`intern7@dgk.test`, password `Password-1234`. |
| `OFFICE` | The seeded site's coordinates, the default GPS position. |
| `signIn(page, email, password?)` | Fills Email and Password on `/`, taps Sign in, waits until the URL leaves `/`. |
| `moveTo(page, metresNorth)` | Moves the stubbed GPS north of the office (1° latitude ≈ 111,194.93 m). `0` puts it back. |
| `setOfficeClock(isoDarwin)` | Sets `daymark.e2e_clock = 'on'` and `daymark.test_now` on the database, so `private.clock_now()` returns that instant. A time without an offset is Darwin time. |
| `clearOfficeClock()` | Resets both settings. Global setup and teardown call it too. |
| `resetDatabase()` | `supabase db reset`. Global setup runs it when `E2E_RESET=1`. |

The clock helpers connect as the local superuser `supabase_admin` (override with `E2E_ADMIN_DB_URL`),
because Postgres lets only a superuser put an unregistered setting on a database. Database settings
reach only new sessions, so each call also makes PostgREST drop its pooled connections
(`notify pgrst, 'reload schema'`) and waits until they have gone.

## Specs

| File | Covers | Status |
|---|---|---|
| `smoke.spec.ts` | Sign-in page (logo, Email, no console errors); fake camera; stubbed GPS and `moveTo` | Runs |
| `clock.spec.ts` | 1. Intern clocks in and out | Runs (mobile) |
| `swap.spec.ts` | 2. Swap → supervisor approves → schedule updates | Runs (mobile) |
| `extra-spot.spec.ts` | 3. Extra spot through the admin | Runs (mobile) |
| `catch-up.spec.ts` | 4. Catch-up option B submitted | Runs (mobile) |
| `uni-report.spec.ts` | 5. Supervisor approves the uni report (no PDF, D13) | Runs (mobile) |

Each stub lists its steps as comments. Golden paths change the seed, so give the `mobile` and
`desktop` runs different seed accounts (or reset between them).

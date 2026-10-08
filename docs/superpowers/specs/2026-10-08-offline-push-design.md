# Design: installable app with offline clock-in, then push reminders (Dilip, 2026-10-08)

## Context
Dilip asked for two upgrades taken from open-source projects:
- **Phones lose signal.** Darwin mobile signal drops, and today a clock-in fails with "You're offline — clocking needs a connection".
- **Interns forget to clock.** Interns forget to clock in, end breaks and clock out (that's why typed-in times exist).
- **Face matching dropped.** He chose to skip it, because the security review says "no face recognition, ever".

Ideas come from these repos:
- **Serwist Next.js template** (startwiseph/next-pwa): installable app and offline shell.
- **PowerSync + Supabase** (pattern only): offline queue and sync.
- **ISnackable/duty-roster** (pattern only): web push reminders.

Dilip's answers:
- **Offline clock-in:**
  - It is queued and needs supervisor approval, like typed-in times.
  - It is flagged "Offline".
  - The phone picks the gesture.
- **Reminders:**
  - not clocked in
  - break running long
  - forgot to clock out
  - staff: new requests
- **Quiet hours:** no pushes 9 pm–7 am Darwin.
- **Libraries allowed:** Serwist and web-push (MIT). Anything else is hand-built. Human/face is not needed.
- **Order:** PR A (app + offline), then PR B (push). Each is its own migration, tests, docs and preview deploy.
- **Process:** Superpowers-style. Step 0 of each PR writes `docs/superpowers/specs/2026-10-08-offline-push-design.md` and `docs/superpowers/plans/2026-10-08-offline-push.md`, taken from this plan.

This overrides BUILD-PROMPT §11.5 ("manifest and icons only, no service worker") and the offline banner. It is recorded as decisions D34–D36 in the program design spec.

## PR A — Installable app + offline clock-in

### A1. Service worker (Serwist)
- **Build:** add `serwist` and `@serwist/cli`. After `next build` (static export to `out/`), run `serwist inject-manifest` over `out/` with `src/sw.ts` → `out/sw.js`. This doesn't depend on the bundler, so Next 16's Turbopack is untouched.
- **Fallback:** if the CLI can't target `out/` cleanly, hand-write the service worker, plus a 20-line script that lists `out/**` for the precache. Marked with a `ponytail:` comment.
- **Caching:**
  - Precache the app shell (HTML, JS, CSS, fonts, icons).
  - Navigation falls back to the cached page for that route.
  - **Never cache** Supabase REST, auth or storage. They are network-only, so no personal data sits in the cache.
- **Registration:** a small client component in `src/app/layout.tsx` registers the worker only when `NEXT_PUBLIC_BASE_PATH` is set (the Pages build). Scope is `/claudetimeclock/`. Dev and e2e run without it.
- **Updates:** when a new worker is waiting, a toast says "New version ready, Reload".
- **Manifest:** `src/app/manifest.ts` gets an updated comment (D34). The manifest itself stays.

### A2. Install prompt (Me tab)
- **Where:** an "Install DGK Clock" card on `src/app/clock/me/*`.
- **Android:** a button driven by `beforeinstallprompt`.
- **iPhone:** "Share → Add to Home Screen" steps (needed later for push).
- **Hidden** when the app already runs installed (`display-mode: standalone`).

### A3. Offline clock-in (client)
- **`src/lib/offline-queue.ts`:**
  - A tiny IndexedDB wrapper; no dependency.
  - Each queued clock stores `{ id (uuid), action, occurredAt (phone time ISO), lat, lng, accuracy, gesture, photo Blob, dayKind }`.
  - Pure helpers, tested in Vitest with an in-memory store:
    - `applyQueue(status, queue)` gives Home's state.
    - `nextGesture()` picks the phone's gesture. The gesture list moves into `src/lib/daymark.ts`, shared with the server's list.
- **Clock sheet (`src/app/clock/clock-sheet.tsx`):**
  - When `navigator.onLine` is false, or `start_clock` fails with a network error, it switches to offline mode.
  - It shows the phone-picked gesture and takes the selfie (`captureJpeg`).
  - It reads GPS with the existing `readLocation`. The map and the distance still show.
  - It saves to the queue. Toast: "Saved on this phone. It sends when you're back online; your supervisor confirms it."
  - The Finish work log is saved to the queue too.
  - Any-order prompts (typed arrival / break end) work offline the same way and are queued.
- **Home (`src/app/clock/clock-desk.tsx`):**
  - The last `clock_status` and today's day kind are cached in localStorage per user, read-only, so the state survives offline.
  - The state comes from `applyQueue(cachedStatus, queue)`.
  - The offline banner changes to: "You're offline — you can still clock; it sends when you're back."
  - Shows "2 clocks waiting to send".
  - The day-kind choice works offline; it's queued with the first clock-in.
- **Sync (`src/lib/offline-sync.ts`):** runs on `online`, on app open and every 60 s while items are waiting. Items go in order. For each one:
  1. Upload the photo to `daymark-photos/{uid}/offline-{id}.jpg`. This fits the existing owner-prefix storage policy.
  2. Call `rpc('submit_offline_punch', …)`.
  3. Delete it from the queue on success, or on a definite refusal. A refusal is shown as a toast and goes into the in-app notifications.
  4. If sending fails, keep it and retry.

### A4. Offline clock-in (server), migration `20261009010000_offline_clock.sql`
- **New column:** `daymark_punches.offline_id uuid unique`, for idempotency.
- **Shared helper:** `private.file_unverified_punch(...)` factors out the insert, request and notify steps of `report_missed_time` (in `20261008010000_flexible_clock_absent.sql`). `report_missed_time` is then redefined to use it, so the behaviour is shared at the root.
- **`private.submit_offline_punch(offline_id, action, occurred_at, latitude, longitude, accuracy_m, gesture, day_kind)`:**
  - **Checks:**
    - The caller is an intern with a live placement, and `require_clocking_consent` passes.
    - `occurred_at` is not in the future (2 minutes of clock skew allowed) and is no older than 48 h.
  - **Selfie:** the object `{me}/offline-{offline_id}.jpg` must exist and be owned by the caller.
  - **Repeat send:** if `offline_id` already exists, return the existing punch.
  - **Day kind:** for the first `shift_in` of that Darwin day, upsert the day kind for that work date if it's missing (reusing `choose_day_kind` logic, parameterised by date).
  - **Insert:**
    - Source `supervisor` and verification `offline`, so it counts 0 until confirmed. That's the same unverified rule as typed-in times, so `rebuild_shifts` and `compute_day` don't change.
    - Columns: `is_break` follows the action, plus lat/lng/accuracy, `photo_path`, `client_reported_at = occurred_at`, and `offline_id`.
    - `punch_rule_error` still runs sequence and date rules. It already skips the geofence for non-device sources. Distance is computed and stored in the request text.
  - **Attendance request**, reason: "Offline clock-in at 9:02 am (phone time), 35 m from Regus Palmerston, gesture 'thumbs up'. Sent 9:41 am."
  - **Notify** the supervisor and admins (the existing `notify` / `notify_admins`).
- **Wrapper and grants:** a public invoker wrapper; revoke from anon, grant to authenticated.
- **Approval:** the existing `decide_request` and bulk approve confirm it.
  - The ApproveSheet (`src/components/approve-sheet.tsx`) shows the selfie with `SelfieImage` and the gesture for attendance requests that have a photo.
  - Timesheets and the profile show an "Offline · waiting" chip, extending the typed-in chip check to `verification_method = 'offline'`.

### A5. Privacy
- **Notice v1.3**, published by the migration; interns re-acknowledge, as with v1.1/v1.2. It says:
  - the app is cached on the phone, and no personal data is in the cache
  - offline clocks keep the selfie and location on the phone until sent, then delete them
  - offline clocks need supervisor confirmation
- **Security review:** `docs/SECURITY-REVIEW.md` gets a short addendum covering the service worker scope, network-only API caching, and on-device queue data.

### A tests
- **pgTAP `130_offline_clock.sql`:**
  - an offline punch counts 0 until approved, then counts
  - sending again returns the same punch
  - a future time and anything older than 48 h are refused
  - a missing selfie or someone else's selfie is refused
  - the sequence still holds
  - the day kind is set
  - supervisor and admin are notified
  - `report_missed_time` still passes test 120
- **Vitest:** `applyQueue`, the queue ordering and retry rules, and gesture picking.
- **Playwright `e2e/offline-clock.spec.ts`** (mobile):
  1. `context.setOffline(true)`, clock in.
  2. Check the "waiting to send" banner.
  3. Go back online; it syncs.
  4. The supervisor sees "Offline" in Approvals and approves.
  5. The day counts.
- **Service worker check:** build with `GITHUB_PAGES=true`, serve `out/` under `/claudetimeclock/` (`npx serve`), and use Playwright to check the worker registers and a reload works offline.

## PR B — Push reminders

### B1. Keys and delivery (web-push)
- **VAPID keys:**
  - generated once with `npx web-push generate-vapid-keys`
  - the public key goes in `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, added to `.github/workflows/pages.yml` env like the Supabase vars
  - the private key and subject go in as Edge Function secrets on preview, never in the client
- **Migration `20261010010000_push_reminders.sql`:**
  - **`daymark_push_subscriptions`:** `person_id → profiles on delete cascade`, plus `endpoint unique`, `p256dh`, `auth`, `user_agent`, `created_at` and `last_ok_at`.
    - RLS lets people read their own rows.
    - RPCs `save_push_subscription` / `delete_push_subscription` act on the caller only.
    - `erase_person` removes them through the cascade.
  - **`daymark_push_outbox`:** `notification_id`, `person_id`, `send_after`, `sent_at`, `attempts` and `error`.
    - An AFTER INSERT trigger on `daymark_notifications` adds a row for push-worthy kinds, but only if the person has a subscription.
    - `send_after` is pushed to 07:00 Darwin when the notification lands between 21:00 and 07:00.
  - **`private.call_send_push()`:** the same Vault `project_url` / `cron_secret` pattern as `private.call_retention_purge` (`20260925071000_retention_purge.sql`). pg_cron runs it every minute.
- **Edge Function `supabase/functions/send-push/index.ts`:**
  - Deno with `npm:web-push`; auth is the `x-cron-secret` header, like `retention-purge`.
  - It reads due outbox rows with the service role and sends the title, body and link to each of the person's subscriptions.
  - A 404/410 deletes that subscription.
  - It marks rows sent and retries up to 3 times.

### B2. Reminders (`private.job_reminders()`, pg_cron every 5 minutes)
- **Dedupe table:** `daymark_reminders_sent(person_id, kind, work_date)`. Each reminder fires at most once per person, kind and day.
- **Not clocked in:** a scheduled roster day (not leave or absent), now ≥ start + 10 min, and no punch today. "You're rostered from 9:00 am. Clock in when you arrive." Links to `/clock`.
- **Break running long:** state is break and the break has run ≥ the placement's `break_minutes`. "Your 30-minute break is up. Tap End break."
- **Forgot to clock out:** state is in and now ≥ rostered end + 15 min. "Still clocked in? Clock out or tap Finish."
- **How they're sent:** all three go through `private.notify`, so they also appear in the in-app notifications. They are pushed through the outbox.
- **Staff pushes:** existing notify kinds for new requests, typed-in or offline times, work-based days and escalations are marked push-worthy. There's one list in the migration.
- **Time source:** uses `private.clock_now()`, so pgTAP can drive it with `tests.at()`.

### B3. Client
- **Service worker `src/sw.ts`:**
  - a `push` handler that shows the notification with the DGK icon
  - a `notificationclick` handler that focuses or opens the link inside the scope
- **Me tab "Reminders on this phone" toggle:**
  - asks permission, subscribes with the VAPID public key and saves the subscription
  - turning it off unsubscribes and deletes it
- **iPhone:** when the app isn't installed, the toggle shows "Install DGK Clock first (Share → Add to Home Screen)". iOS only allows web push for installed apps.
- **Staff:** the same toggle sits in the staff footer menu.

### B tests
- **pgTAP `140_push_reminders.sql`:**
  - each reminder fires once at the right time and not on leave or absent days
  - quiet hours push `send_after` to 07:00
  - only subscribed people get outbox rows
  - subscription RLS and the own-rows-only RPCs
  - the cascade on erase
- **Deno unit test:** for the send-push payload and 410 handling (a small pure function).
- **Vitest:** the Me toggle states (unsupported / not installed / off / on), with mocked `PushManager`.
- **Manual on a real phone:**
  - **Android:** install, allow notifications, then trigger a reminder with `tests.at`-style SQL on preview.
  - **iPhone:** install from the home screen, then repeat.

## Files (main)
- **New:**
  - `src/sw.ts`
  - `src/lib/offline-queue.ts`
  - `src/lib/offline-sync.ts`
  - `src/components/install-card.tsx`
  - `src/components/push-toggle.tsx`
  - `supabase/functions/send-push/index.ts`
  - migrations `20261009010000_offline_clock.sql` and `20261010010000_push_reminders.sql`
  - pgTAP 130/140
  - e2e `offline-clock.spec.ts`
- **Changed:**
  - `package.json` (scripts: `build` → `next build && serwist …` for Pages)
  - `src/app/layout.tsx`
  - `src/app/manifest.ts`
  - `src/app/clock/clock-sheet.tsx`, `clock-desk.tsx`, `me/*`
  - `src/components/approve-sheet.tsx`, `timesheets.tsx`
  - `src/app/supervisor/intern/intern-screen.tsx` (chip)
  - `src/lib/daymark.ts` (gestures)
  - `.github/workflows/pages.yml` (VAPID public key)
- **Docs:**
  - spec D34 (service worker + install), D35 (offline clock-in), D36 (push reminders)
  - BUILD-LOG
  - SECURITY-REVIEW addendum
  - notice v1.3

## Verification (each PR)
- **Checks:** `npm run lint`, `npm run typecheck`, `npx vitest run`, `npx supabase db reset && npx supabase test db`, `E2E_RESET=1 npx playwright test`, `GITHUB_PAGES=true npm run build` plus the served-`out/` service worker check, and the brand grep.
- **Preview:**
  - apply each migration to preview `mdamqteiccvohjwredzp` in small parts
  - PR B: deploy `send-push` with the MCP `deploy_edge_function` and set the VAPID secrets
  - check the Vault `project_url` / `cron_secret` exist
  - live `lnagrfdbmwtlymhumepc` untouched
- **Ship:** PR → merge → Pages deploy check → sync the branch. Then a real-phone check: install, go offline, clock in, come back online, approve; then reminders on Android and iPhone.

## Risks / notes
- **Device time:** offline punches use the phone's time, and that's why they need approval. The request shows the phone time, the send time and the distance, so the supervisor can judge.
- **iPhone push:** needs iOS 16.4+ and an installed app. Interns on older phones still get in-app notifications.
- **Notice v1.3:** means every intern re-acknowledges before their next clock-in.

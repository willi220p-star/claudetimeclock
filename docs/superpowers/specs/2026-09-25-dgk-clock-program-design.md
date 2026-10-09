# DGK Clock program design (placement system)

`docs/BUILD-PROMPT.md` is the binding spec: rules R5.x, algorithms §8, requests §9, data model §10, UX §11, KPIs §12. This file records only what **adapts** it for this repository, and the security overlay from `docs/SECURITY-REVIEW.md`. Where the two differ, this file wins because Dilip chose these answers on 2026-09-25.

## Repository and delivery
- Code lives in `willi220p-star/claudetimeclock`, imported from `presence-tracker@b7f9ab5`. GitHub Pages `basePath` is `/claudetimeclock`.
- Branch `claude/quirky-lovelace-ktg6f8` (the session's designated branch) replaces `feat/placement-system`. Tags `phase-N-done`. Draft PR to `main` at the end.
- The DGK spec bundle (`DGK-Clock_Superpowers_v2.zip`) was not supplied. `CONTEXT.md`, the ADRs and every phase spec and plan were written from the build prompt.
- Supabase CLI is installed globally (`npm i -g supabase`), not as a project dependency, so §5.5 stays intact.

## Decisions that change build-prompt behaviour
| # | Topic | Build prompt | Adopted |
|---|---|---|---|
| D3 | Auto-close (R5.5.1) | Clock-out at scheduled end, hours count | Clock-out = clock-in (0 min), flagged `auto_closed`; counts only after a punch fix is approved |
| D4 | Office code / kiosk | — | Not built |
| D5 | MFA (aal2) | — | Not now; open question and release checklist item |
| D6 | Consent | — | Full consent pack: collection notice v1.0, append-only consent records, `has_consent` gate, supervisor-confirmation path, `verification_method` on reports. The supervisor-confirmation path was removed on 2026-10-05 (D26) |
| D7 | Clock window end | 19:00:00 inclusive | Kept (review said 18:59), then superseded by D16 (2026-09-26): no window at all |
| D8 | Offboarding | Read-only for 30 days | Kept; Auth user removed by `retention-purge` |
| D9 | Hosting | GitHub Pages | Kept with meta CSP; host move, CAPTCHA, Sydney region, backups, Pro plan go to the release checklist |
| D10 | Seed data in migrations | Site and closure days in `seed.sql` | The Regus site and NT closure days 2026–2027 are real data, so they go in a migration. `seed.sql` holds only test people and history |
| D11 | Passwords | 8–72 characters | 12–72 characters (review §4.1), matching `minimum_password_length = 12` |
| D13 | Uni report and certificate PDFs (§13) | Built client-side with @react-pdf/renderer | Built (reversed by Dilip, 2026-09-25): both PDFs generate in the browser via a lazy-loaded @react-pdf/renderer; CSP adds 'wasm-unsafe-eval' and connect-src data: |
| D14 | Check-ins and Monday summary (§11.3) | Built | Built (reversed by Dilip, 2026-09-25): `save_checkin`, `checkins_due`, `monday_summary`, Monday 08:00 job; late alert at clock-in, left-early alert at day close |
| D15 | Faster finish (Dilip) | Full screens | Built (reversed by Dilip, 2026-09-25): admin Sites/Closures/Settings/Audit screens, intern month calendar, forecast chart, supervisor Flags tab. Only `/admin/reports` stays a placeholder |
| D12 | Deleting people | Admin could delete a login | Reversed twice by Dilip: on 2026-09-26 admins could delete people but the audit log and consent records stayed; on 2026-09-29 it became a full wipe (D18) |
| D16 | Clock-in/out window (R5.1.2) | Mon–Fri, site hours, no closure days | Reversed (Dilip, 2026-09-26): clocking is always on — no weekday, office-hours or closure-day block. GPS + selfie, the placement's own start/end dates, the office headcount cap for unscheduled shifts (R5.1.8) and the previous day's work-log gate (R5.1.6) are unchanged. A day/time outside the intern's roster still counts 0 hours until a supervisor or admin approves it as extra time or overtime |
| D17 | Audit log actor | Actor id only, joined live to the current profile | The actor's display name is stored on the row at the time of the action (`daymark_audit_log.actor_name`), so it's never lost when that person is later deleted |
| D18 | Deleting a person (full wipe) | — | `private.erase_person`, shared by the admin delete (People or Records) and the 30-day purge: the login, profile, every row hanging off it, their consent records and the audit rows about them are deleted. Their actions on other people's records stay, with the actor shown as "Deleted user". One nameless note records that a deletion happened (who deleted, counts, no id, no hash). Collection notice v1.1 says so |
| D19 | Announcement banners | — | Admins post to everyone, a supervisor to their own interns; sticky or moving text, optional end time, one live banner per author, each viewer can hide it on their device |
| D20 | Roster changes | Requests only | Admin, or the intern's supervisor, can add, move, re-time or remove a single day, or set a weekly pattern for a date range (the usual days come back after it). Hand-edited days survive a pattern change. Auto-close now happens 12 hours after clock-in (hourly job); shifts that cross midnight belong to the day they started; punch fixes accept any time of day |
| D21 | Breaks (Dilip, 2026-10-05) | No break punches (R5.1.4) | Start · Break · Finish on one clock screen (drawn office map, live selfie, one big button). A break is a clock-out and clock-in marked `is_break`, each with GPS + selfie; it starts between 10 am and 2 pm, Finish is always available |
| D22 | Break deduction (R5.4.2) | 30 min on days over 5 h unless a 30-min gap | On days over 5 h the gaps between sessions are the unpaid break, topped up to the intern's assigned break (`placements.break_minutes`, set when adding the intern, default 30). Roster planned minutes use the same break |
| D23 | Clocking frequency and work log | 60-second rate limit; log before the next day's clock-in | Clock in and out as often as needed (no rate limit; the single-use challenge stops double taps). Finish needs that day's work log first; breaks never do. The next-day check stays for days that ended without Finish |
| D24 | Staff time edits | Interns request punch fixes | Admin, or the intern's supervisor, edits clock times directly on Timesheets (`staff_edit_times`, reason required, originals kept, audited, intern notified). The edit is the approval: that day's time beyond the roster counts straight away |
| D25 | Catch-up (§8.7) | Option A longer days / option B extra days | The intern picks free office days (spots under normal capacity) and times; each becomes an extra-day request the supervisor approves. Quick fill, a "back on track by" date and a roster calendar file (.ics) help students plan |
| D26 | Consent required to clock | Location and selfie optional (supervisor confirms instead) | Both are required to clock; the supervisor-confirmation route is gone. Privacy (withdraw) moved to the Me tab. Collection notice v1.2 says so and covers break selfies |
| D27 | Staff navigation | One flat list of pages | A tree: main tabs (admin: Home, People, Time, Reports, Settings; supervisor: Today, Time, Approvals, Interns) with sub-tabs. Phones: bottom tabs + sub-tab pills; desktop: grouped sidebar. New Time → Timesheets page |
| D28 | Day type (Dilip, 2026-10-08) | Every day is a rostered day with a break | Before the first clock-in each day the intern picks **Full day** (9–5 with the assigned break) or **Work-based** (about 5 h, no break, finish the tasks). A work-based day goes to the supervisor; approved, it counts as the full rostered day; until then (or declined) the hours worked count |
| D29 | Clock order | Start, Break and Finish only in sequence | Any segment can be picked. Skipping a step asks for the missed time first ("What time did you get here?", "When did your break end?"); it is saved as a supervisor-confirmed punch plus a typed-in time request, counts only once approved, and the supervisor and admins are told. The live clock still needs GPS (office distance kept) and a selfie |
| D30 | Staff break edits | Staff edit clock-in/out only | Staff add a break inside a clocked session (`staff_add_break`) or change a break's start/end on Timesheets; it counts straight away, audited, intern told |
| D31 | Absent days | No-shows only | Staff mark a rostered day absent with a reason (`staff_mark_absent`): leave of kind `absent`, its hours stay owed, the intern sees it on Schedule and is told. Swap = move the day on the roster |
| D32 | Bulk decisions | One request at a time | Approvals (supervisor) and Requests (admin) have checkboxes, Select all, Approve N / Decline N (one note); each goes through `decide_request` / `decide_day_kind` in turn and failures are listed |
| D33 | Deleting notifications | Notifications kept | Anyone can delete their own notifications, selected or all; removed from the database (`delete_my_notifications`) |
| D34 | Installable app (Dilip, 2026-10-08) | Manifest and icons only, no service worker (§11.5) | A small hand-written service worker (`scripts/sw-template.js`, built into `out/sw.js` by `scripts/sw.mjs`) saves the app's own files so DGK Clock opens with no signal; Supabase data, sign-in and selfies are never cached. Me has "Install DGK Clock" (Android prompt, iPhone Share → Add to Home Screen). A new version waits for "Reload" |
| D35 | Offline clock-in | "You're offline — clocking needs a connection" | With no signal the phone keeps the clock (its own time, GPS, a selfie with a phone-picked gesture, plus any work log or typed time) in IndexedDB and sends it when back online (`submit_offline_punch`). It is a punch waiting for the supervisor, flagged Offline, and counts once confirmed. Clocks older than 2 days are refused. Typed-in and offline clocks can be confirmed within 7 days (was same day). Collection notice v1.3 |
| D36 | Push reminders | In-app notifications only | Web Push to phones that turn on "Reminders on this phone" (Me for interns, Notifications for everyone). Interns: not clocked in 10 min after the rostered start, break past the assigned length, still clocked in 15 min after the rostered finish (once each per day, `job_reminders` every 5 min). Staff: new requests, typed-in/offline clocks, work-based days, escalations, schedule and time changes. Nothing pushes 9 pm–7 am Darwin (held to 7 am). Sent by the `send-push` Edge Function (web-push, our own VAPID keys); every push is also an in-app notification. iPhone needs the installed app (iOS 16.4+) |
| D37 | Notification settings | Fixed push list and reminder times | Admin → Settings → Notifications ticks which types go to phones (`daymark_settings.push_kinds`, `save_push_kinds`). An unticked reminder isn't sent; any other unticked type stays in-app only. Reminders are now: shift starts in 30 minutes (not clocked in), break is up at the intern's own break length, time to clock out at the rostered finish. Admin sets each active intern's break (0–120 min, `set_break_minutes`) or one length for every active/extended placement (`set_break_for_all`); planned hours re-plan from today |
| D38 | Dark mode and bigger text | Light theme only (§15), fixed 16px text | Appearance card (Me for interns, Notifications for everyone): theme Match phone / Light / Dark and text size Normal / Large / Larger, kept on that phone only (localStorage), applied before first paint by a head script. Dark uses the same semantic tokens (`.dark` in globals.css); sizes are rem so one root size scales the app |

## Security overlay (review §5, mapped to daymark names)
- Clocking goes through `public.start_clock(event_type)` → a `daymark_clock_challenges` row (90 s, single use, random gesture) → selfie uploaded to `daymark-photos/<intern>/<challenge>.jpg` → `public.clock_punch(...)`. The function checks the challenge, that the object exists, is owned by the caller and was created within 3 minutes of issue, and that `accuracy_m ≤ 150`. It stamps `occurred_at := private.clock_now()` and keeps the client time only as `client_reported_at`.
- ~~One punch per intern per 60 s.~~ Removed 5 Oct (D23): the single-use 90-second challenge stops double taps.
- Flags: `suspicious_accuracy` (≤ 3 m), `low_accuracy` (> 50 m), `repeat_coords` (same 5-decimal point on an earlier day), `desktop_ua`, `new_device`.
- No third-party geocoding. `place_name` comes from the site row.
- Location is read once, on the tap, never with `watchPosition`.
- Segregation of duties: nobody decides their own request. An intern's supervisor can't be themselves.
- Punch fix: a reason of at least 20 characters and at most 2 per rolling fortnight (admin override, audited).
- The audit log is append-only: no API write grants, and a trigger raises on update or delete.
- Signed URLs last 60 s. No `dangerouslySetInnerHTML`. CSV cells starting with `= + - @` are escaped. PDFs are built from data.
- Client idle sign-out after 30 min, and a "Sign out everywhere" option.
- ~~Interns see a fortnight hours summary (R5.7.2 fortnights).~~ Removed 26 Sep (Dilip): no visa self-check card.
- Uni report entries show the verification method and approver.

## Phase map
As in build prompt §19, plus:
- **Phase 1:** challenges, consent tables and the consent screen, because clock-in is gated on consent from Phase 1.
- **Phase 5:** supervisor confirmation and punch-fix limits.
- **Phase 6:** flagged-events view.
- **Phase 8:** 7-day certificate purge.

## Deferred — add when Dilip asks
Built on 2026-09-25 at Dilip's request: the admin Sites, Closures, Settings and Audit screens; the intern month calendar, forecast chart and fortnight card; the supervisor Flags tab; weekly check-ins and the Monday summary; the uni report and certificate PDFs; medical certificate upload; late and left-early alerts; live notifications; idle sign-out; sign out all devices.

Still deferred:

| Feature | Decision | Database | What adding it takes |
|---|---|---|---|
| Admin **Reports** screen | D15 | ready: KPI bundles, weekly/fortnight views | report list + exports in `/admin/reports` |
| **MFA** (TOTP, aal2) for staff | D5 | not started | enrolment flow + restrictive RLS policies |
| **Office code** kiosk | D4 | not started | kiosk role, HMAC code, check in `clock_punch` |
| **CAPTCHA** on sign-in/reset | release checklist | dashboard setting | Turnstile widget + CSP entry |
| Report ID + data hash stored (`uni_reports`) | security review | not started | a table and an insert when a PDF is generated |
| Intern report download before approval (item 9) | Dilip, 2026-09-29: skipped | — | a draft watermark on the existing PDF |
| Punch fix or staff time edit for an overnight shift | D20, D24 | not started | an out-date on the punch-fix / staff-edit payload |
| Real street map on the clock screen | D21 (Dilip chose the drawn map) | — | a map library + tile host in the CSP, and a notice change (location sent to the tile server) |

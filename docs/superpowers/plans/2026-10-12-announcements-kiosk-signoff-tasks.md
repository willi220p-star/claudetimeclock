# Announcements, kiosk, weekly sign-off and tasks: implementation plan

> **For agentic workers:** use superpowers:executing-plans to implement this task by task. Steps use checkboxes (`- [ ]`) for tracking.

**Goal:** Four features taken from the competitor research (Tanda, Gusto, Rippling, eBillity), chosen and specified by Dilip on 12 Oct.

**Architecture:** As today. Each feature is one migration with private SECURITY DEFINER functions, public invoker wrappers and pgTAP tests, plus a few client screens in the existing desks. Each feature ships as its own PR to the Sydney project `mdamqteiccvohjwredzp`.

**Tech stack:** Next.js 16 static export, Supabase (Postgres, RLS, pg_cron, Edge Function `send-push`). Nothing new to install.

**Research:** "DGK Clock competitor research" doc (12 Oct). Decisions: D41–D44 in the program design spec.

## Global constraints

- AGENTS.md (ponytail): the smallest complete change, reuse before adding, and a test for every non-trivial branch.
- Time zone is Darwin. Use `private.clock_now()` everywhere, so tests can set the time.
- Audit every staff change (`private.audit`). The audit log is append-only.
- Never store or show PINs or passwords. Store a PIN only as a bcrypt hash (`extensions.crypt`).
- Notifications go through `private.notify`, so they appear in the app and as push notifications according to the ticked kinds.
- No new dependencies.

## Review focus

1. **Announcements:** a supervisor's notice must reach only their own interns, never others. This needs a test.
2. **Kiosk PIN guessing:** lock out after 5 wrong PINs for 15 minutes. A wrong PIN must not reveal whether the name exists. This needs a test.
3. **Kiosk device:** a kiosk can only clock in. It can't read anyone's records. This needs an RLS test.
4. **Sign-off:** an edit to a signed week must reopen it, and an export only counts signed weeks. This needs a test.
5. **Tasks:** an intern sees and ticks only their own tasks. A supervisor sees only their interns' tasks. This needs a test.

---

## Feature 1: Announcements with read receipts (D41). PR 1

**Dilip's answers:**
- **Who can post:** an admin posts to everyone or to interns. A supervisor posts only to their own interns.
- **Must-acknowledge:** the notice is pinned on the intern's Home with a push notification until they tap "I've read this".
- **Tracking:** staff see who has read it and can re-send the push. Clocking is never blocked.

**Files:**
- `supabase/migrations/20261015010000_announcements.sql`
- `supabase/tests/180_announcements.sql`
- `src/components/announcements.tsx`: the intern card and the staff list with reads.
- The Admin/Supervisor "Announcements" page and the nav entry.

**Database:**
- `daymark_announcements`: `id`, `title` (1–80 characters), `body` (1–2,000), `audience` (`everyone` / `interns` / `my_interns`), `must_ack`, `created_by`, `created_at`, `archived_at`.
- `daymark_announcement_reads`: `announcement_id`, `person_id`, `read_at`, `acked_at`. The primary key is the pair.
- `private.announcement_recipients(a)`: everyone active; interns active; or the supervisor's active interns.
- **RPCs:**
  - `post_announcement(title, body, audience, must_ack)`. Rules: a supervisor may only use `my_interns`, and only an admin may use the other audiences. It notifies each recipient with kind `announcement`, which is push-worthy and ticked by default.
  - `mark_announcement(id, ack boolean)`: recipients only.
  - `announcement_reads(id)`: the poster or an admin. Returns name, read_at and acked_at for each recipient.
  - `nudge_announcement(id)`: re-notifies everyone who hasn't acknowledged yet.
  - `archive_announcement(id)`.
- **RLS:** recipients read their own announcements, and the poster and admins read all.

**Tasks:**
- [ ] **pgTAP 180:**
  - an admin posts to everyone and every active person is notified;
  - a supervisor posts `my_interns` and only their interns are notified, while another supervisor's intern isn't;
  - a supervisor can't post `everyone`;
  - an intern can't post;
  - the read and ack timestamps are set;
  - the reads list is visible to the poster only;
  - a nudge reaches only those who haven't acknowledged.
- [ ] **Migration:** run until the tests pass. Add `announcement` to `push_kind_options` and to the default ticked kinds.
- [ ] **UI:**
  - The intern Home shows unread or must-acknowledge cards above the clock, with "I've read this".
  - The Notifications list opens the card.
  - A staff page `/admin/announcements` and `/supervisor/announcements` with a post form, a list with "4 of 6 read", a detail with reads, and "Remind the rest".
- [ ] **Checks:** Vitest for the audience label helper and e2e `announcements.spec.ts`. Then docs D41 and the BUILD-LOG, preview migration, PR, merge and deploy.

## Feature 2: Kiosk mode (D42). PR 2

**Dilip's answers:**
- The tablet sits at the office front desk, and any intern can use it.
- The tablet itself counts as the office, so there's no GPS. A live selfie with the gesture is still required.

**Design:**
- A kiosk is a sign-in account with `is_kiosk` and a `site_id`, created by an admin under People → Add kiosk. It has no other role.
- **Kiosk RPCs** (only an `is_kiosk` caller can use them):
  - `kiosk_people()` returns first names and initials of active interns on a live placement at its site. Nothing else.
  - `kiosk_start(person, pin, event)` checks the PIN hash. After 5 failures it locks that person for 15 minutes. It returns one error message whether the PIN is wrong or the person is locked. It then reuses `start_clock`'s challenge for that person and returns the gesture and a photo path.
  - `kiosk_punch(challenge, ...)` inserts the punch for that person with source `kiosk`, which counts like `device`. It requires the photo, uses the kiosk's site and skips GPS.
- **PIN:** `daymark_profiles.pin_hash`, set by the intern on Me with "Set kiosk PIN" (4–6 digits) or reset by an admin. PIN attempts are kept in `daymark_kiosk_attempts`.
- **Storage:** a policy lets a kiosk upload `{person}/{challenge}.jpg` only for an open challenge it issued.
- **Screen:** `/kiosk`. Shows the name grid, then a PIN pad, then Clock in / Break / Finish, then the camera with the gesture, then a "Done, Aisha clocked in at 9:02" screen. It returns to the grid after 10 seconds. It shows no records.

**Tasks:**
- [ ] **pgTAP 190:**
  - a kiosk sees names only, at its own site;
  - a wrong PIN, and the lock after 5;
  - the generic error;
  - a punch is recorded with source `kiosk` for the right person and needs the photo;
  - a kiosk can't select punches or profiles;
  - a non-kiosk can't call the kiosk RPCs.
- [ ] **Migration and storage policy.**
- [ ] **UI:**
  - `/kiosk` screen;
  - "Set kiosk PIN" on Me;
  - Add kiosk and Reset PIN in Admin → People;
  - a "Kiosk" chip on Timesheets.
- [ ] **Checks:** e2e `kiosk.spec.ts` with the fake camera. Then docs, preview, PR and deploy.

## Feature 3: Weekly sign-off, export and pay rates (D43). PR 3

**Dilip's answers:**
- A week runs Monday to Sunday. Sign-off is due Tuesday at 5 pm, with reminders.
- A week can't be signed while it has open items.
- A supervisor can change a signed week without asking permission. The change reopens the week, needs a reason and is audited.
- The export is a plain CSV.
- Paid placements record an hourly rate only.

**Database:**
- `daymark_week_signoffs(placement_id, week_start, signed_by, signed_at, minutes)`. `minutes` is the counted total frozen at signing.
- `daymark_placements.paid` (boolean) and `hourly_rate` (numeric, required when paid).
- **`sign_week(placement, week_start)`:**
  - Allowed for the placement's supervisor or an admin.
  - Refused while the week has a missing clock-out, a pending request touching the week, or an unconfirmed offline or typed time. The refusal lists what's open.
- **Reopening:** any staff time edit, punch fix approval or attendance decision on a date in a signed week deletes the sign-off. The change already carries a reason, and it notifies the signer that the week reopened. This is enforced by a trigger on `daymark_day_results` changes for signed weeks.
- **Reminders and export:**
  - `job_signoff_reminders` runs Monday at 9 am and Tuesday at 9 am: "3 weeks to sign".
  - An overdue entry shows on the admin Overview.
  - `signoff_export(from, to)` returns one row per intern per day: name, placement, date, counted minutes, breaks, signed, rate and amount.
  - The CSV is built on the client.

**Tasks:**
- [ ] **pgTAP 200:**
  - sign a clean week;
  - refused with open items, listing them;
  - a staff edit reopens it and notifies;
  - the export only includes signed weeks and the amount equals rate times hours;
  - an intern can't sign;
  - a supervisor signs only their own interns.
- [ ] **Migration.**
- [ ] **UI:**
  - On Timesheets, each week row gets "Sign week" or a "Signed by Priya, Tue 4:10 pm" chip, plus a list of open items with links.
  - "Export CSV" on Admin Timesheets, for a fortnight or a date range.
  - Paid and hourly rate fields on the placement wizard and placement screen.
- [ ] **Checks:** Vitest for the CSV builder and e2e. Then docs, preview, PR and deploy.

## Feature 4: Built-in tasks (D44). PR 4

**Dilip's answers:**
- Supervisors assign tasks with an optional due date, and interns can add their own.
- The intern and their supervisor both see all of that intern's tasks.
- Ticked tasks pre-fill the day's work log.

**Database:**
- `daymark_tasks`: `id`, `intern_id`, `title` (1–140 characters), `notes`, `due_date`, `created_by`, `done_at`, `created_at`.
- **RLS:** the intern, their supervisor and admins can read. The intern edits their own, and staff edit any task of their interns.
- **RPCs:** `add_task`, `set_task_done`, `delete_task`. A new assigned task notifies the intern with kind `task`, which is push-worthy.
- An overdue task shows on the supervisor's morning summary line.

**Tasks:**
- [ ] **pgTAP 210:** visibility (intern, own supervisor, not another supervisor), ticking a task, assigning one notifies, and an intern can't edit another intern's tasks.
- [ ] **Migration.**
- [ ] **UI:**
  - A Tasks card on intern Home with add and tick.
  - A Tasks section on the supervisor's intern page with add, assign and due date.
  - The work log sheet offers "Add today's ticked tasks".
- [ ] **Checks:** e2e, then docs, preview, PR and deploy.

## Order and sizes

| PR | Feature | Size |
|---|---|---|
| 1 | Announcements | Small |
| 2 | Kiosk | Medium |
| 3 | Sign-off, export and rates | Medium to large |
| 4 | Tasks | Medium |

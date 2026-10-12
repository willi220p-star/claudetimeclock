# Reminders fix, intern tabs and history, open-ended placements, tasks v2 and projects: implementation plan

> **For agentic workers:** use superpowers:executing-plans to implement this task by task. Steps use checkboxes (`- [ ]`) for tracking.

**Goal:** Dilip's requests of 12–13 Oct, with his answers to three question rounds.

**Architecture:** As today. Each feature has private SECURITY DEFINER functions, public invoker wrappers, pgTAP tests, and screens in the existing desks. There are five PRs to the Sydney project `mdamqteiccvohjwredzp`. Migrations avoid `delete from`, because the MCP apply hangs on it.

## Order

| PR | Feature | Size | Runs |
|---|---|---|---|
| A | Reminders stay on after sign-out (bug fix) | Small, client only | Wave 1, alone, ships first |
| B | Intern tabs: Tasks tab, Progress inside Me, Schedule → History with tap-to-fix | Small to medium, client only | Wave 2, parallel with C |
| C | Open-ended placements (end date optional) | Medium, database plus UI | Wave 2, parallel with B |
| D | Tasks v2: review, subtasks, comments, estimate and time spent, blocked, board view | Large | Wave 3, one database worker and one UI worker, contract first |
| E | Projects, labels, calendar view, workload view | Medium to large | Wave 4, after D |

---

## PR A: reminders stay on (D45)

**Bug:**
- **Cause:** `forgetPushSubscription()` runs on every sign-out, including the automatic idle sign-out after 30 minutes (`src/lib/idle.ts`). The phone's subscription is deleted, so a signed-out phone gets no reminders, and the Home banner asks again after the next sign-in.
- **Dilip's answer:** keep reminders on.

**Fix:**
- [ ] The idle sign-out no longer calls `forgetPushSubscription`.
- [ ] Sign out keeps reminders by default. A tick box, "Shared phone: also stop reminders here", calls `forgetPushSubscription` only when it is ticked.
- [ ] **Quiet re-link:** when `Notification.permission === "granted"` but there is no subscription (after a sign-out, a browser reset, or the push service dropping it), the app subscribes again silently and calls `save_push_subscription`.
    - It runs once per app open from the desk shell, for interns and staff.
    - The `save` already moves an endpoint to the signed-in person.
    - The banner and the toggle then show "on" without asking.
- [ ] Vitest for the decision helper: granted plus no subscription means re-link; default or denied means don't.
- [ ] Docs: D45 and the BUILD-LOG.

## PR B: intern tabs and shift history (D46)

**Dilip's answers:**
- Bottom tabs: **Today · Tasks · Schedule · Requests · Me**.
- Progress moves inside Me as a split tab: **Me | Progress**.
- Schedule gets a **History** tab showing every shift since the placement start, and tapping one opens a pre-filled fix request.

**Tasks:**
- [ ] **`desk-shell.tsx`:** intern tabs are Today, Tasks (`/clock/tasks`), Schedule, Requests, Me.
    - `/clock/progress` stays as a page, and its tab moves into Me.
    - Me gets a two-segment switch (Me | Progress). The segment is remembered in the URL hash.
- [ ] **`/clock/tasks`:** the existing `Tasks` card moves here, and Home keeps a small "3 tasks today" link card.
- [ ] **Schedule:** a segment switch, Roster | History.
    - **History** lists days newest first: date, day type, clock-in, breaks, clock-out, counted hours, and chips (Missing clock-out, Waiting, Offline, Kiosk, Typed-in, Absent, Leave). It loads by month, with a "Load earlier" button.
    - Tapping a day opens the existing request form as a `punch_fix` for that date, pre-filled with the day's in and out punch ids. The intern picks "Forgot to clock out", "Wrong time" or "Missed break" and writes a reason.
    - A day with a pending request shows "Fix requested", and a second fix can't be sent for it.
    - It reuses the timesheet data the intern already reads (`punch-day-table`, `loadDays`). No new database work, unless a read is missing. If one is, it's an `my_history(from, to)` read in PR C's migration.
- [ ] **Tests:** Vitest for history row building (chips, missing clock-out) and e2e: open History, tap a day, send a fix, and see it in Requests.

## PR C: open-ended placements (D47)

**Dilip's answers:**
- An end date is optional when adding or editing an intern. Leave it blank if unknown.
- With no end date, Progress shows hours done only, with no forecast.

**Database:**
- [ ] `daymark_placements.planned_end_date` and `original_end_date` become nullable. The dates check becomes `planned_end_date is null or planned_end_date >= start_date`.
- [ ] `target_minutes` becomes optional (nullable, or 0 meaning none).
- [ ] **Roster horizon:** `private.roster_horizon(pl)` is `coalesce(planned_end_date, darwin_today() + 84)`.
    - `generate_days`, pattern changes and capacity use it instead of `planned_end_date`.
    - A daily job, `private.job_roll_rosters()`, adds the next day for open-ended placements. It runs in `job_reminders` once per day, deduplicated.
- [ ] Every reader of `planned_end_date` is checked: about 17 migrations' functions. These include the forecast, pace, catch-up "back on track by", retention (the 30-day read-only period starts from the end date or the status change), reports, the certificate (only once ended), the 'target_reached' status, and the overview.
    - Null means: no forecast, no pace chip, no "ends in" text, and no target_reached unless there is a target.
    - Ending a placement sets the end date (`planned_end_date = today`) through the existing end or extend flow.
- [ ] **pgTAP 220:**
    - create a placement without an end date;
    - the roster has 12 weeks of days and rolls forward a day;
    - no forecast;
    - setting an end date later trims the future days;
    - erase and retention still work.

**UI:**
- [ ] Add person, the placement wizard, the placement screen and import: the end date is optional, labelled "End date (optional, leave blank if not known)".
- [ ] Intern Progress, supervisor and admin progress screens: "142 h done · 18 h this week", with no forecast chart when there is no end date. The target bar still shows if a target is set.
- [ ] Schedule shows "No end date" instead of the end date.

## PR D: tasks v2 (D48)

**Dilip's answers:**
- **Review:**
    - The reviewer is optional, with "None" as a choice.
    - Anyone who manages the intern (supervisor or admin), or another active intern for a peer review, can be picked.
    - The creator is filled in by default, unless the creator is the assignee.
    - With a reviewer, only the reviewer's **Approve** makes a copy Done. **Needs changes** sends it back to In progress with a comment, and the assignee gets a push.
- **Subtasks:**
    - Hidden until someone taps + or the subtask icon.
    - The assignee, creator and reviewer can add them.
    - All must be ticked before **Send for review** or Done.
    - The reviewer can comment on a single subtask.
- **Time:** two fields. **Estimate** (set by the creator) and **Time spent** (logged by the assignee).
- **Also wanted:** a comments thread, a board view, and a Blocked flag.

**Contract** (`docs/superpowers/specs/2026-10-13-tasks-v2-contract.md`, written first):
- `daymark_tasks`: adds `reviewer_id` (profiles, nullable) and `estimate_minutes` (int, 0–6,000, nullable).
- `daymark_task_items`:
    - adds `spent_minutes` (int ≥ 0, default 0), `blocked_reason` (text ≤ 300, nullable), `blocked_at`, `review_requested_at`, `reviewed_by` and `reviewed_at`;
    - `status` adds `in_review`.
- `daymark_task_subtasks(id, item_id → items on delete cascade, title 1–140, done_at, done_by, position, created_by, created_at)`. The creator's subtask list on `save_task` (`subtasks text[]`) is copied into every copy, repeat copies included.
- `daymark_task_comments(id, item_id → items on delete cascade, subtask_id → subtasks on delete set null, author_id → profiles on delete set null, body 1–1,000, kind 'comment'|'changes'|'approved', created_at)`.
- **Who takes part in a copy:** the assignee, the reviewer, the "working with" teammates, the creator and the staff who manage the assignee. Only they can read it and comment.
- **RPCs:**
    - `save_task(... + reviewer, estimate_minutes, subtasks)`.
    - `add_subtask(item, title)`, `set_subtask(id, done)`, `remove_subtask(id)`. Remove archives the subtask by setting `removed_at`; it is never deleted.
    - `log_task_time(item, minutes)`, which sets the total, and `set_task_blocked(item, reason | null)`. Blocking notifies the creator and the reviewer.
    - `set_task_status(item, status, note)`:
        - With a reviewer, `done` is refused for the assignee, and `in_review` is the way forward. It requires every subtask to be ticked and notifies the reviewer.
        - Without a reviewer, `done` requires every subtask to be ticked.
    - `review_task(item, approve boolean, comment)`: reviewer only, and only while the copy is `in_review`.
        - Approve sets `done`, `done_at` and an 'approved' comment.
        - Needs changes requires a comment, sets `in_progress` and a 'changes' comment, and pushes to the assignee.
    - `task_comments(item)` and `add_task_comment(item, body, subtask)`. A comment notifies the other participants (kind `task`, deduplicated to one per person per 10 minutes, so a busy thread doesn't spam).
    - `my_tasks` and `staff_tasks` add the reviewer name, estimate, spent, blocked, the subtask count and done count, the comment count, and `to_review` (copies the caller reviews).
    - `my_reviews()`: copies waiting for my review.
- **The 8 am summary** adds "2 tasks blocked" and "3 waiting for your review".
- **The 30-day rule:** subtasks and comments go with their copy by cascade.

**UI:**
- [ ] **Task form:** Reviewer (None, creator, or pick from `task_people`, which grows to staff plus interns), an estimate as hours and minutes, and "Subtasks" lines behind a + button.
- [ ] **Task detail sheet** (tap a task):
    - description, link, and the subtasks with ticks (shown when the subtask icon is tapped);
    - time spent ("Log time");
    - Blocked on and off with a reason;
    - the comments thread, with "Reply to subtask";
    - the status buttons: To do, In progress, Send for review, or Done when there's no reviewer;
    - for the reviewer, **Approve** or **Needs changes** with a comment.
- [ ] **Views:** List | Board on the Tasks tab and the staff Tasks pages. The Board has four columns (To do, In progress, In review, Done), and you change status by moving a card or with the menu (accessible). Blocked cards show a red chip.
- [ ] **"To review":** a section on the Tasks tab for reviewers, interns included.
- [ ] **Tests:** pgTAP 230 covers each rule above (review gate, subtasks gate, participants only, notifications, needs-changes path). Also Vitest for the board grouping and the time format, and e2e for assign with reviewer → send for review → needs changes → fix → approve.

## PR E: projects, labels, calendar and workload (D49)

**Dilip's answer:** projects, labels, a calendar view and a workload view.

**Database:**
- [ ] `daymark_projects(id, name 1–80, description ≤ 2,000, due_date, created_by, created_at, archived_at)`.
    - Staff create and edit projects: admins any, supervisors their own.
    - Interns see a project when they have a task in it.
- [ ] `daymark_tasks.project_id` (nullable).
- [ ] `project_list()` returns progress (done copies / all copies), the total estimate, total spent, overdue and blocked counts.
- [ ] `daymark_labels(id, name 1–30, colour from a fixed list of 8 tokens, archived_at)`. Staff manage labels, and `daymark_task_labels(task_id, label_id)` links them. The task form picks labels, and every task list filters by project and label.
- [ ] `task_workload(week_start)` is for staff only. Per intern (theirs, or everyone for an admin) it returns: open copies, estimated minutes due this week, rostered minutes this week, overdue, blocked and in review.
- [ ] pgTAP 240: project visibility, progress maths, label filter, workload maths and scoping.

**UI:**
- [ ] Staff **Projects** page, next to Tasks: list → project detail with a progress bar and its tasks (list or board).
- [ ] **Calendar** (List | Board | Calendar): a month grid of tasks by due date, coloured by priority. Interns also see their rostered days as dots.
- [ ] **Workload** tab on the staff Tasks page: one row per intern with bars for estimated hours against rostered hours this week. Red when estimated is over rostered.
- [ ] Labels admin is under Settings → Task labels.
- [ ] Tests: Vitest for calendar placement and workload colour, plus e2e for a project with 2 tasks reaching 1 of 2 done.

## Defaults chosen (say if any is wrong)

- **Subtasks and comments are per person's copy.** Each assignee has their own checklist and thread. The creator's starting subtasks are copied to everyone.
- **Projects:** only staff create them. Interns can't create projects, but they can add their own tasks to a project they're in.
- **Labels:** one shared list for the whole organisation, managed by staff.
- **Comment pushes:** at most one per person per task every 10 minutes.

## Verification (each PR)

- `npm run lint`, `npm run typecheck`, `npx vitest run`, `npx supabase db reset && npx supabase test db`, `E2E_RESET=1 npx playwright test` and `GITHUB_PAGES=true npm run build`.
- Apply to Sydney in small parts, then PR → merge → Pages deploy check → sync the branch.

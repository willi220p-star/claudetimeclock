# Built-in tasks: contract (D44)

This is the shared interface for the parallel workers. The database must match it exactly. The UI codes against it, using types hand-added in `src/lib/database.types.ts`, which the database worker regenerates at the end.

## Dilip's answers (12 Oct)

**Fields:**
- task name
- description
- due date and due time (optional)
- assigned to: one or more interns
- priority: high, medium or low
- status: to do, in progress or done
- a note when done, which pre-fills the work log
- an attachment link (a URL; no uploads)

**Who creates tasks:**
- Supervisors assign to their own interns, and admins to any active intern. Each assignee gets their own copy and ticks it themselves, so staff see "2 of 3 done".
- An intern adds tasks for themselves only. They can tag teammates as "working with". Those teammates see the task, but only its owner ticks it.

**Repeating:** weekly on chosen weekdays until an end date. A copy appears on each chosen day, with that day as its due date.

**After a month:**
- Done copies disappear from every list 30 days after they're ticked.
- The rows are deleted with the intern's other data (the 30-day retention purge, by cascade).
- Open copies never auto-delete. Overdue ones turn red and appear in the supervisor's 8 am summary.

**Reminder:** one push on the due day. It goes at 8 am, or 1 hour before the due time if one is set, while any task is still open.

## Database (migration `20261018010000_tasks.sql`, pgTAP `210_tasks.sql`)

**Table `daymark_tasks`** (the definition):

| Column | Type and rules |
|---|---|
| `id` | uuid pk |
| `title` | text, 1–140 characters |
| `description` | text, at most 2,000, nullable |
| `priority` | text: high, medium or low; default medium |
| `due_date` | date, nullable (used when the task doesn't repeat) |
| `due_time` | time, nullable |
| `link` | text, nullable, must start with `https://`, at most 500 |
| `repeat_days` | int[], nullable; ISO weekdays 1–7 |
| `repeat_until` | date, nullable; required when `repeat_days` is set |
| `created_by` | uuid, references profiles, on delete set null |
| `created_at` | timestamptz |
| `archived_at` | timestamptz, nullable (removing a task archives it and never deletes it) |

**Table `daymark_task_assignees(task_id, person_id)`:** primary key on the pair. `person_id` references profiles, on delete cascade.

**Table `daymark_task_collaborators(task_id, person_id)`:** the "working with" teammates on an intern's own task. Same shape as the assignees table.

**Table `daymark_task_items`** (each person's copy):

| Column | Type and rules |
|---|---|
| `id` | uuid pk |
| `task_id` | uuid, references tasks, on delete cascade |
| `person_id` | uuid, references profiles, on delete cascade |
| `due_date` | date, nullable |
| `status` | text: todo, in_progress or done; default todo |
| `done_at` | timestamptz, nullable |
| `done_note` | text, at most 500, nullable |
| `created_at` | timestamptz |

`daymark_task_items` has a unique index on `(task_id, person_id, coalesce(due_date, '1900-01-01'))`.

All four tables have RLS on and no grants to authenticated. Access goes through the functions below: a private SECURITY DEFINER function plus a public invoker wrapper, with execute granted to authenticated and revoked from anon.

| Function | Rules |
|---|---|
| `save_task(id uuid, title text, description text, priority text, due_date date, due_time time, link text, assignees uuid[], repeat_days int[], repeat_until date, collaborators uuid[]) returns uuid` | `id` null creates a task, otherwise it edits one. See the save_task rules below. Notifies each new assignee, other than the caller, with kind `task`. Audited. |
| `set_task_status(item uuid, status text, note text default null) returns void` | Only the item's person, or staff who may manage that person. `done` sets `done_at` and keeps the note; other statuses clear `done_at`. Note at most 500 characters. |
| `archive_task(id uuid) returns void` | Creator, admin, or a supervisor of every assignee. Sets `archived_at`. |
| `my_tasks() returns table(item_id uuid, task_id uuid, title text, description text, priority text, due_date date, due_time time, link text, status text, done_at timestamptz, done_note text, created_by_name text, own boolean, working_with text[], repeat_days int[])` | See the my_tasks rules below. |
| `staff_tasks(intern uuid default null) returns table(item_id uuid, task_id uuid, person_id uuid, person_name text, title text, description text, priority text, due_date date, due_time time, link text, status text, done_at timestamptz, done_note text, created_by_name text, repeat_days int[], repeat_until date)` | Copies of interns the caller manages: a supervisor's own interns, or everyone for an admin. Optionally just one intern. Same 30-day and archive rules as `my_tasks`. |
| `task_people() returns table(person_id uuid, display_name text)` | Who the caller can pick. Staff: interns they can assign (the supervisor's own, or all active interns for an admin). Intern: other active interns, for "working with". |

**`save_task` rules:**
- `title` 1–140, description at most 2,000, priority high, medium or low, and the link must be `https://…` or null. Otherwise 22023 with a plain message.
- **Repeat:** `repeat_days` must be a non-empty set within 1–7, and `repeat_until` is required and on or after today. Otherwise 22023.
- **Staff:** a supervisor may only assign their own active interns (the placement's `supervisor_id`), and an admin any active intern. Otherwise 42501. `assignees` must be non-empty (22023).
- **Interns:** `assignees` must be exactly the caller (42501 otherwise). `collaborators` must be active interns. Staff collaborators are ignored.
- **Edit:** the creator, an admin, or a supervisor of every current assignee (42501 otherwise). It updates the fields.
  - For a non-repeating task, open copies take the new `due_date`.
  - Removed assignees' open copies are archived. In practice those copies are deleted only if they aren't done, so there's no history loss. If that's hard without `delete from`, keep them and filter them by assignee in the lists instead.
  - New assignees get a copy.
- **Copies:** a non-repeating task creates one copy per assignee, with that `due_date`. A repeating task creates today's copy straight away if today is one of its days, and the daily job creates the rest.

**`my_tasks` rules:**
- Returns the caller's own copies.
- Also returns tasks where the caller is a collaborator. For those rows `own` is false, `item_id` is the owner's copy, and the status is read-only.
- Excludes archived tasks, and done copies whose `done_at` is more than 30 days ago.
- Order: open first, by due date (nulls last), then priority (high to low); done copies after, newest first.

**Jobs:** `private.job_tasks()` is added to `private.job_reminders()`, which runs every 5 minutes. It does two things:
1. **Repeat copies:** from 00:00 Darwin on a chosen weekday, it inserts that day's copy for each assignee while today is on or before `repeat_until` and the task isn't archived. It uses `on conflict do nothing`.
2. **Due reminder:** each person with open copies due today gets one notification with kind `task`, deduplicated through `daymark_reminders_sent` kind `task_due`.
   - Title: "Tasks due today".
   - Body: "3 tasks due today: <first title>, …".
   - Link: `/clock`.
   - When: the earliest of 08:00 and 1 hour before the earliest due time.

Add `task` to `push_kind_options`, the settings default and the existing settings row. Add `task_due` to the `daymark_reminders_sent` kind check.

**Morning summary:** the supervisor's 08:00 summary also counts overdue open copies (due before today) of their interns, as "2 tasks overdue". An admin gets everyone's. Copy `job_digest` from `20261013010000_evening_digest.sql` and add that part.

**Tests (pgTAP 210), at least:**
- create, edit and archive permissions for supervisor, admin and intern, including another supervisor being refused;
- a multi-assignee task creates one copy each, and staff see them;
- an intern sees only their own tasks plus ones they're working on, and can't tick a collaborator's copy;
- repeat copies on a chosen weekday, not on others and not after `repeat_until`;
- a done copy disappears from lists after 30 days, and an open overdue copy doesn't;
- the due-day reminder is sent once;
- the summary counts overdue tasks;
- the validation errors.

## UI (one worker, `src/components/tasks/*` plus wiring)

- **Intern Home:** a **Tasks** card listing `my_tasks`.
  - Each open task shows a priority chip, its due date and time (red when overdue), the link and "Working with …".
  - Status: To do, In progress, Done. Done asks for an optional note.
  - An **Add task** form for the intern's own tasks has the fields title, description, priority, due date, due time, link, repeat (weekday checkboxes and an until date) and a "Working with" multi-select (`task_people`).
  - The last 30 days of done tasks sit in a collapsed "Done" list.
- **Staff pages:** `/supervisor/tasks` and `/admin/tasks`. Add the nav entries next to Announcements, in the Today group and the admin Home group.
  - A form for creating and editing: the same fields plus an **Assign to** multi-select.
  - A list grouped by task, showing "2 of 3 done", who's left, priority, due date, and Edit and Archive buttons. It can be filtered to one intern.
- **Supervisor intern page** (`/supervisor/intern`): a **Tasks** section for that intern, using `staff_tasks(intern)`.
- **Work log:** the work log sheet (`src/components/work-log-sheet.tsx`) gets **Add today's done tasks**, which appends "• title: note" lines from today's done copies.
- **Settings → Notifications:** a "Tasks" row (kind `task`) under "Reminders to interns".
- Vitest for the non-trivial helpers: sorting, the overdue check, the repeat summary text ("Every Mon, Fri until 30 Nov") and the work-log lines.

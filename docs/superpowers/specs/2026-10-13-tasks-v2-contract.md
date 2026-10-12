# Tasks v2: contract (D48)

This is the shared interface for the parallel database and UI workers. It adds to the D44 contract (`2026-10-12-tasks-contract.md`), and everything not named here stays as it is. The approved mockups are the "DGK Clock tasks and projects mockups" canvas: Main, TaskDetail, Board and DesktopTasks.

## Dilip's answers (13 Oct)

**Review:**
- A reviewer is optional, and "None" is allowed.
- Who can be picked:
    - the creator, filled in by default unless the creator is the assignee;
    - a supervisor or admin who manages the assignee;
    - another active intern, for a peer review.
- With a reviewer, only the reviewer's **Approve** makes a copy Done.
- **Needs changes** requires a comment. It sends the copy back to In progress, and the assignee gets a push.

**Subtasks:**
- Hidden until someone taps + or the subtask icon.
- The assignee, the task's creator and the reviewer can add, tick and remove subtasks.
- Every live subtask must be ticked before **Send for review**, or before **Done** when there's no reviewer.
- The reviewer can comment on one subtask.

**Time:** an **Estimate** set by the creator, and **Time spent** logged by the assignee as a running total.

**Also:**
- a comments thread;
- a Blocked flag with a reason;
- a board view (To do · In progress · In review · Done) next to the list.

## Database (migration `2026101x_tasks_v2.sql`, pgTAP `230_tasks_v2.sql`)

**Columns:**
- `daymark_tasks`:
    - `reviewer_id uuid` references profiles, on delete set null, nullable;
    - `estimate_minutes int`, nullable, 1–6,000;
    - `subtask_titles text[]`, nullable: the starting checklist, at most 30 items of 1–140 characters each.
- `daymark_task_items`:
    - `status` adds `in_review`. The check becomes todo, in_progress, in_review or done.
    - `spent_minutes int not null default 0`, 0–60,000;
    - `blocked_reason text`, at most 300 characters, null when not blocked;
    - `blocked_at timestamptz`;
    - `review_requested_at timestamptz`;
    - `reviewed_by uuid` references profiles, on delete set null;
    - `reviewed_at timestamptz`.

**Tables** (RLS on, no grants to authenticated, never `delete from`):
- **`daymark_task_subtasks`:**
    - `id`;
    - `item_id`, referencing items with on delete cascade;
    - `title`, 1–140 characters;
    - `position int`;
    - `done_at`, and `done_by` on delete set null;
    - `created_by` on delete set null, `created_at`;
    - `removed_at`: removing a subtask archives it.
- **`daymark_task_comments`:**
    - `id`;
    - `item_id`, referencing items with on delete cascade;
    - `subtask_id`, referencing subtasks with on delete set null;
    - `author_id`, on delete set null, plus `author_name text` frozen at writing, as the audit log does;
    - `body`, 1–1,000 characters;
    - `kind`: comment, changes or approved;
    - `created_at`.
- **Copying the checklist:** an AFTER INSERT trigger on `daymark_task_items` copies `daymark_tasks.subtask_titles` into subtasks for the new copy. That covers one-off copies, repeat copies and new assignees, with no change to `task_copies`.

**Who takes part in a copy:** `private.task_participant(item uuid) returns boolean` is true for:
- the copy's person;
- the task's creator and reviewer;
- a current "working with" teammate;
- anyone for whom `manages_tasks_of(person)` is true.

Only participants read the subtasks and comments or add comments.

**Functions** (a private SECURITY DEFINER function plus a public invoker wrapper; execute revoked from anon and granted to authenticated):

| Function | Rules |
|---|---|
| `save_task(... existing 11 args ..., reviewer uuid, estimate_minutes int, subtasks text[]) returns uuid` | Drop the old 11-argument overloads (public and private) and re-create them with the 3 extra arguments at the end. **Reviewer:** null means none. Otherwise it must be an active person who either manages every assignee, or is an active intern who isn't an assignee. Anything else gives 42501, "That reviewer can't review this task." **Estimate:** 1–6,000 or null. **Subtasks:** at most 30, each 1–140 characters (22023). On edit, the new `subtask_titles` affect only copies made later. Existing copies keep their own checklists. |
| `set_task_status(item, status, note)` | Same callers as today. `in_review` needs a reviewer, the copy's own person as caller and every live subtask ticked. It sets `review_requested_at`, notifies the reviewer (kind `task`, "Task to review", link `/clock/tasks`) and logs an activity row if projects exist later. `done` is refused with 42501 when the task has a reviewer: "Send it for review. Your reviewer marks it done." Without a reviewer, it needs every live subtask ticked (22023, "Tick all subtasks first."). Moving to `todo` or `in_progress` from `in_review` is allowed for the person (to withdraw it). |
| `review_task(item uuid, approve boolean, comment text default null) returns void` | Reviewer only (42501), and only while the copy is `in_review` (22023). **Approve:** sets `done`, `done_at`, `reviewed_by` and `reviewed_at`, adds an `approved` comment (the comment is optional), and notifies the person: "Approved: <title>". **Needs changes:** requires a comment of 1–1,000 characters (22023). It sets `in_progress`, adds a `changes` comment and notifies the person: "Changes needed: <title>". |
| `add_subtask(item uuid, title text) returns uuid` | Allowed for the person, the creator and the reviewer. The new subtask goes last. A done copy is refused (22023). |
| `set_subtask(id uuid, done boolean) returns void` | Same callers. It sets or clears `done_at` and `done_by`. |
| `remove_subtask(id uuid) returns void` | Same callers. It sets `removed_at`. |
| `log_task_time(item uuid, minutes int) returns void` | The copy's person only. It sets `spent_minutes` to the given total, 0–60,000. |
| `set_task_blocked(item uuid, reason text) returns void` | The person, or staff who manage them. A reason of 1–300 characters blocks the copy and notifies the creator and the reviewer (other than the caller): "Blocked: <title>", with the reason as the body. Null unblocks it. |
| `task_thread(item uuid) returns jsonb` | Participants only. Returns `{subtasks:[{id,title,position,done_at,done_by_name}], comments:[{id,subtask_id,author_name,body,kind,created_at,mine}]}`, ordering subtasks by position and comments oldest first, with removed subtasks left out. |
| `add_task_comment(item uuid, body text, subtask uuid default null) returns uuid` | Participants only. The body is 1–1,000 characters. It notifies the other participants who are a person, creator or reviewer (kind `task`, "New comment: <title>"). A person isn't notified again for the same copy within 10 minutes. |

**List reads:** `my_tasks()` and `staff_tasks()` gain these columns, with the return types re-created by drop and create:
- `reviewer_id`, `reviewer_name`;
- `estimate_minutes`, `spent_minutes`;
- `blocked_reason`;
- `subtasks_total`, `subtasks_done`;
- `comments`, a count;
- `review_requested_at`.

`my_tasks()` also gains `to_review boolean`: true on rows where the caller is the reviewer and the copy is `in_review`. Those rows appear in `my_tasks` even when the caller isn't the person or a teammate, with `own` false.

**The 8 am summary** (`job_digest`) adds two counts for the supervisor's or admin's interns: "N blocked", for blocked open copies, and "N waiting for your review", for copies `in_review` where they are the reviewer.

**The 30-day rule:** unchanged. Subtasks and comments go with their copy.

**pgTAP 230 must cover:**
- each reviewer pick: allowed for the creator, the managing supervisor and a peer intern; refused for another supervisor;
- with a reviewer, `done` is refused;
- `in_review` is refused while a subtask is unticked, and allowed once all are ticked;
- review: approve leads to done; needs changes requires a comment and leads to in_progress plus a notification;
- the subtask and comment permissions, including a non-participant being refused;
- the template copied into new copies;
- log time is the person's only;
- blocked notifies and shows in the summary;
- comment notification dedupe;
- the `my_tasks` new columns and `to_review`.

## UI (`src/components/tasks/*` plus wiring)

- **Task form:**
    - **Reviewer** select: None, then people from `task_people()` grouped as Staff and Interns. It defaults to the creator when staff create a task for someone else.
    - **Estimate:** hours and minutes.
    - **Subtasks:** collapsed behind "+ Add subtasks", one line per item.
- **Task detail sheet:** a bottom sheet on phones, a right-hand side panel at 1024 px and wider. Follow the TaskDetail and DesktopTasks mockups:
    - status pill, title and description;
    - a 2-column facts grid: due, priority, project (later), reviewer, estimate, time spent with **Log**;
    - subtasks with a + button, ticks, and a comment count per subtask;
    - comments with "on <subtask>" context;
    - a sticky footer with the comment box plus **Blocked** and the main action. The main action is **Send for review**, or **Mark done** when there's no reviewer. It is disabled with a reason line until all subtasks are ticked. A reviewer instead sees **Needs changes** and **Approve**.
- **List rows:** follow the Main mockup. A status ring, the title, then a meta line: due (red when overdue), project, "2 of 4 subtasks", Blocked, "In review · Priya". A priority chip on the right.
- **Board:**
    - Four columns on wide screens.
    - On phones, columns swipe with scroll-snap, with a column-dot indicator.
    - A card's menu offers "Move to…", the accessible way to move it. Drag and drop is optional (pointer only) and must never be the only way.
- **Tests:** Vitest for board grouping, the status action logic (which button shows for which role and state) and the minutes format. e2e for assign with reviewer → tick subtasks → send for review → needs changes → fix → approve → done.

# Projects, milestones, labels, calendar and workload: contract (D49)

This is the shared interface for the parallel database and UI workers. Dilip's answers are in the plan (`docs/superpowers/plans/2026-10-13-reminders-nav-openended-tasks-v2.md`, PR E). The mockups are Projects, Project and DesktopProject in the "DGK Clock tasks and projects mockups" canvas.

## Database (migration `20261021010000_projects.sql`, pgTAP `240_projects.sql`)

Never `delete from` and never `drop`, because the remote apply refuses both. Rename the old function to `*_d48` and revoke its access instead. Every new table has RLS on, no grants to authenticated, and all to service_role. Every RPC is a private SECURITY DEFINER function plus a public invoker wrapper, with execute revoked from public and anon and granted to authenticated.

### Tables

**`daymark_projects`**

| Column | Type and rules |
|---|---|
| `id` | uuid pk |
| `name` | 1–80 characters |
| `client_name` | ≤ 120 characters |
| `contact_name` | ≤ 80 characters |
| `contact_email` | ≤ 200 characters, must contain `@` |
| `contact_phone` | ≤ 30 characters |
| `start_date`, `due_date` | dates; `due_date` must be on or after `start_date` |
| `status` | `planning`, `active`, `on_hold` or `completed`; default `planning` |
| `description` | ≤ 2,000 characters |
| `links` | `text[]`, at most 5, each starting `https://` and ≤ 500 characters (checked in `save_project`) |
| `lead_id` | uuid, profiles, on delete set null |
| `approved_at`, `approved_by` | both null while the project waits for approval |
| `created_by`, `created_at`, `archived_at` | |

**Other tables**
- **`daymark_project_members`:** `project_id`, `person_id` (on delete cascade) and `removed_at`. The primary key is the pair.
- **`daymark_milestones`:** `id`, `project_id`, `name` (1–80), `due_date`, `position`, `archived_at`.
- **`daymark_tasks`:** add `project_id` (projects, on delete set null) and `milestone_id` (milestones, on delete set null). `save_task` checks that the milestone belongs to the project.
- **`daymark_project_activity`:** `id`, `project_id`, `actor_id` (on delete set null), `actor_name`, `kind`, `text` (≤ 200), `created_at`. Kinds:
    - `task_added`, `task_done`, `review_approved`, `changes_asked`;
    - `status_changed`;
    - `member_added`;
    - `milestone_added`, `milestone_done`;
    - `project_created`, `project_approved`.
- **`daymark_labels`:** `id`, `name` (1–30, unique where not archived), `colour` (`blue`, `teal`, `green`, `orange`, `red`, `purple`, `pink` or `grey`), `archived_at`.
- **`daymark_task_labels`:** `task_id` and `label_id`; the primary key is the pair.

### Who sees a project: `private.project_visible(project uuid)`
It is true for:
- an admin;
- the lead, the creator, or a current member;
- anyone with a live task copy in the project;
- a supervisor (via `manages_tasks_of`) of any of the lead, members or assignees.

A project waiting for approval is visible only to its creator and to staff who could approve it: admins, and supervisors of the creator.

### Functions

| Function | Rules |
|---|---|
| `save_project(id uuid, name text, client_name text, contact_name text, contact_email text, contact_phone text, start_date date, due_date date, status text, description text, links text[], lead uuid, members uuid[]) returns uuid` | **Create:** anyone active may create. Staff projects are approved at once (`approved_at` = now, `approved_by` = me). An intern's project waits, and a notification goes to their supervisor and the admins (kind `request`, "Project to approve: <name>", link `/supervisor/tasks?tab=projects`). **Edit:** the lead, the creator (while not yet approved) or staff who can see it. A member not yet in the list is added, and one left out gets `removed_at`. The lead must be an active person. It writes activity rows: created, status changed, member added. Validation errors are 22023 with a plain message. |
| `approve_project(id uuid, approve boolean, note text default null) returns void` | Admin, or a supervisor of the creator. **Approve** sets `approved_*`, writes activity and notifies the creator. **Decline** archives the project, notifies the creator with the note and writes no activity. |
| `archive_project(id uuid) returns void` | The lead, the creator or staff who can see it. |
| `save_milestone(id uuid, project uuid, name text, due_date date) returns uuid` | The lead or staff who can see the project. Writes `milestone_added` on create. |
| `archive_milestone(id uuid) returns void` | Same callers. |
| `my_projects() returns table(id uuid, name text, client_name text, status text, start_date date, due_date date, lead_name text, waiting boolean, tasks_total int, tasks_done int, estimate_minutes int, spent_minutes int, overdue int, blocked int, in_review int, next_milestone text, next_milestone_due date)` | Visible, unarchived projects. Ordered with waiting projects first, then active, planning, on hold and completed, then by due date (nulls last) and name. The counts are over live copies of unarchived tasks. `estimate_minutes` is the sum over copies of the task estimate. |
| `project_detail(id uuid) returns jsonb` | `{project:{…all columns, lead_name, created_by_name}, members:[{id,name}], milestones:[{id,name,due_date,tasks_total,tasks_done,done:boolean}]}`. A milestone is done when it has at least one task and all of them are done. Refused with 42501 when the project isn't visible. |
| `project_activity(id uuid, before timestamptz default null) returns table(id uuid, actor_name text, kind text, text text, created_at timestamptz)` | Visible only. The 30 newest before `before`, within the last 90 days. |
| `project_lookup(q text default null) returns table(id uuid, name text, client_name text)` | Approved, unarchived, visible projects whose name or client contains `q` (case-insensitive). At most 20, ordered by name. |
| `project_people(project uuid default null) returns table(person_id uuid, display_name text)` | The active people the caller may add as lead or members. Staff can add any active intern and any active staff member. An intern can add active interns. |
| `save_task(… existing 14 args …, project uuid default null, milestone uuid default null)` | Rename the 14-argument version to `save_task_d48` and re-create with 16 arguments. The project must be approved, unarchived and visible to the caller (42501, "Pick a project you're part of."). The milestone must belong to it (22023). An edit with project null keeps the existing project and milestone. To clear them, pass `project = '00000000-0000-0000-0000-000000000000'`. Writes `task_added` activity when the task gets a project. |
| `set_task_status` / `review_task` | Redefine with the same signatures. They also write `task_done` / `review_approved` / `changes_asked` activity when the task has a project, plus `milestone_done` when the last task of a milestone finishes. |
| `my_tasks()` / `staff_tasks()` | Rename to `*_d48`. Re-create with the existing columns plus `project_id uuid`, `project_name text`, `milestone_id uuid`, `milestone_name text` and `labels text[]` (label names) after the current last column. |
| `save_label(id uuid, name text, colour text) returns uuid` / `archive_label(id uuid)` | Staff only. |
| `labels() returns table(id uuid, name text, colour text)` | Live labels. Any signed-in person may call it. |
| `set_task_labels(task uuid, labels uuid[]) returns void` | Callers allowed by `require_task_manager`, or the person themselves for their own intern task. It rewrites the links by deleting no rows: use `daymark_task_labels.removed_at` (add the column) and re-insert with `on conflict do update set removed_at = null`. |
| `task_workload(week_start date) returns table(person_id uuid, person_name text, open_tasks int, estimate_due_minutes int, rostered_minutes int, overdue int, blocked int, in_review int)` | Staff only. Covers the caller's interns, or all active interns for an admin. `estimate_due_minutes` sums the estimates of open copies due in that Monday–Sunday week. `rostered_minutes` sums `planned_minutes` of the week's scheduled days. |

**pgTAP 240 must cover:**
- visibility: another team's intern can't see the project or look it up, and a supervisor sees their interns' projects;
- the intern approval flow: waiting, then approve or decline;
- the progress maths;
- milestone done-ness;
- activity rows for each kind;
- `save_task` refusing a project the caller can't see, and refusing a milestone from another project;
- labels and `set_task_labels`;
- the workload maths and scoping;
- the archive rules.

## UI

- **Intern Projects tab** (`/clock/projects`):
    - Cards per the Projects mockup: name, client and lead, a status chip, the progress bar "7 of 12 tasks done", due date, hours, overdue count and the next milestone. A dashed card for "Waiting for approval".
    - A search box and a **+ Project** form, as a sheet with all fields: lead and members from `project_people`, links as up to 5 rows.
- **Project page** (`/clock/projects/view?id=…`, static export-friendly):
    - A back link, the title, status chip and dates.
    - Segments: **Overview** (progress, hours, overdue and in review, milestones list with + for the lead and staff, client card with call and email links, team avatars), **Tasks** (List | Board reusing `src/components/tasks/task-parts.tsx`, with "+ Task" pre-filling the project) and **Activity** (newest first, "Load earlier").
    - Edit and Archive for those allowed.
- **Staff:**
    - A **Projects** page at `/admin/projects` and `/supervisor/projects`, with nav entries next to Tasks. It uses the same list plus an "Approve projects" section with Approve and Decline (decline asks for a note).
    - The project page is the same component.
- **Task form:**
    - An optional **Project** combobox using `project_lookup`, with type-ahead and "No project".
    - A **Milestone** select that appears once a project is picked.
    - **Labels:** chips from `labels()`, toggled.
- **Calendar view:** List | Board | Calendar on My work and the staff Tasks pages.
    - A month grid on desktop. On phones it's an agenda list grouped by day; a 7-column grid at 390 px is too cramped.
    - Tasks are placed by due date with a priority dot. Interns also see their rostered days marked.
    - Month back and forward buttons.
- **Workload:** a tab on the staff Tasks pages. One row per intern with a bar of estimated against rostered hours this week, red when the estimate is over the rostered hours, plus overdue, blocked and in-review counts. It has a week picker.
- **Settings → Task labels:** list, add, rename, recolour and archive. Admins only.
- **Tests:**
    - Vitest: progress maths, calendar placement (month grid days and agenda grouping), workload colour, the links validator.
    - e2e: an intern adds a project → the supervisor approves → the intern files a task under it → it's done → the project shows "1 of 1 tasks done" and the activity shows it.

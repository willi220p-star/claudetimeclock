"use client";

import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, ListTodo, Plus } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskForm } from "@/components/tasks/task-form";
import {
  PRIORITY_LABEL,
  dueText,
  groupTasks,
  isOverdue,
  matchesTaskFilter,
  repeatSummary,
  sortTasks,
  TASK_FILTERS,
  type MyTask,
  type Priority,
  type StaffTask,
  type TaskFilter,
  type TaskGroup,
  type TaskItem,
  type TaskStatus,
  type Viewer,
} from "@/components/tasks/task-helpers";
import { TaskBoard, TaskRow, useWide, ViewSwitch, type View } from "@/components/tasks/task-parts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { darwinDateKey } from "@/lib/darwin";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";

const card = "flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card";
const group = "overflow-hidden rounded-xl bg-card shadow-card divide-y divide-border";
// With the side panel open at 1024px+, keep the list clear of it (26rem) where the page's side gutter isn't enough.
const besidePanel = "lg:pr-[max(0px,calc(26rem_-_(100vw_-_100%)_/_2))]";

export async function loadMyTasks() {
  const { data, error } = await createClient().rpc("my_tasks");
  if (error) throw error;
  return (data ?? []) as MyTask[];
}

async function loadMe() {
  const { data } = await createClient().auth.getClaims();
  return data?.claims?.sub ?? null;
}

async function loadMine() {
  const [rows, me] = await Promise.all([loadMyTasks(), loadMe()]);
  return { rows, me };
}

async function loadStaffTasks(intern?: string) {
  const [{ data, error }, me] = await Promise.all([
    createClient().rpc("staff_tasks", intern ? { intern } : {}),
    loadMe(),
  ]);
  if (error) throw error;
  return { rows: (data ?? []) as StaffTask[], me };
}
const loadAllStaffTasks = () => loadStaffTasks();

/** Board "Move to…" and the like: one status change, with the database's reason on refusal. */
async function setTaskStatus(item: string, status: TaskStatus) {
  const { error } = await createClient().rpc("set_task_status", { item, status });
  if (error) toast.error(errorText(error, "That didn't save. Try again."));
  return !error;
}

/** Board moves and the open detail, shared by My work, the staff desk and the intern tab. */
function useTaskView(reload: () => void) {
  const wide = useWide();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function move(row: TaskItem, status: TaskStatus) {
    setBusy(true);
    const ok = await setTaskStatus(row.item_id, status);
    setBusy(false);
    if (ok) reload();
  }
  function detail(rows: TaskItem[], viewerOf: (row: TaskItem) => Viewer) {
    const row = rows.find((item) => item.item_id === openId);
    return row ? (
      <TaskDetail key={row.item_id} row={row} viewer={viewerOf(row)} wide={wide} onClose={() => setOpenId(null)} onChanged={reload} />
    ) : null;
  }
  return { open: (row: TaskItem) => setOpenId(row.item_id), opened: openId !== null, busy, move, detail };
}

function Section({ title, tone, children }: { title: string; tone?: "bad"; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className={cn("mx-1 text-[15px] font-semibold", tone === "bad" ? "text-bad" : "text-muted-foreground")}>{title}</h2>
      <ul className={group}>{children}</ul>
    </section>
  );
}

/** Home's small link to My work (D46): how many open tasks, and how many are due today or overdue. */
export function TasksLinkCard() {
  const [state] = useLoad(loadMyTasks);
  const rows = state.status === "ready" ? state.data : [];
  const now = new Date();
  const open = rows.filter((row) => row.status !== "done").length;
  const today = rows.filter((row) => matchesTaskFilter(row, "today", now)).length;
  const overdue = rows.filter((row) => matchesTaskFilter(row, "overdue", now)).length;
  const review = rows.filter((row) => row.to_review).length;
  return (
    <Link href="/clock/tasks" className="flex min-h-14 items-center gap-3 rounded-xl bg-card px-4 py-3 shadow-card">
      <ListTodo aria-hidden className="size-5 shrink-0 text-primary" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">
          {state.status !== "ready" ? "My work" : open === 0 ? "No tasks to do" : `${open} ${open === 1 ? "task" : "tasks"} to do`}
        </span>
        {today > 0 || overdue > 0 || review > 0 ? (
          <span className="text-sm text-muted-foreground">
            {[
              today > 0 ? `${today} due today` : null,
              overdue > 0 ? `${overdue} overdue` : null,
              review > 0 ? `${review} to review` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : null}
      </span>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/** My work (D44, D46, D48): their tasks, the ones they work on with others and the ones waiting for their review. */
export function TasksCard({ filters = false }: { filters?: boolean }) {
  const [state, reload] = useLoad(loadMine);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [view, setView] = useState<View>("list");
  const tasks = useTaskView(reload);
  const me = state.status === "ready" ? state.data.me : null;
  const rows = state.status === "ready" ? sortTasks(state.data.rows) : [];
  const now = new Date();
  const today = darwinDateKey(now);
  const shown = rows.filter((row) => matchesTaskFilter(row, filter, now));
  const mine = shown.filter((row) => !row.to_review);
  const open = mine.filter((row) => row.status !== "done");
  const overdue = open.filter((row) => isOverdue(row, now));
  const dueToday = open.filter((row) => !isOverdue(row, now) && row.due_date === today);
  const later = open.filter((row) => !isOverdue(row, now) && row.due_date !== today);
  const review = shown.filter((row) => row.to_review);
  const done = filter === "all" ? mine.filter((row) => row.status === "done") : [];
  const viewerOf = (row: TaskItem): Viewer => ({ person: Boolean(row.own), reviewer: Boolean(me) && row.reviewer_id === me, manager: false });
  const rowsOf = (list: MyTask[]) => list.map((row) => <TaskRow key={row.item_id} row={row} onOpen={() => tasks.open(row)} />);

  return (
    <section aria-label="Tasks" className={cn("flex flex-col gap-4", tasks.opened ? besidePanel : null)}>
      {filters ? (
        <div role="group" aria-label="Show tasks" className="-mx-1 flex gap-2 overflow-x-auto px-1">
          {TASK_FILTERS.map((item) => {
            const count = item.value === "all" ? null : rows.filter((row) => matchesTaskFilter(row, item.value, now)).length;
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={filter === item.value}
                onClick={() => setFilter(item.value)}
                className={cn(
                  "min-h-11 shrink-0 rounded-full px-4 text-[15px] font-medium whitespace-nowrap transition-colors",
                  filter === item.value ? "bg-foreground text-background" : "border border-border bg-card hover:bg-muted",
                  filter !== item.value && item.value === "overdue" && count ? "text-bad" : null,
                )}
              >
                {item.label}
                {count ? <span className="ml-1.5 tabular-nums">{count}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <ViewSwitch view={view} setView={setView} />
        {adding ? null : (
          <Button type="button" className="ml-auto" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add task
          </Button>
        )}
      </div>
      {adding ? (
        <div className={card}>
          <TaskForm
            mode="intern"
            onSaved={() => {
              setAdding(false);
              reload();
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : null}
      {state.status !== "ready" ? (
        <LoadBlock state={state} reload={reload}>
          {() => null}
        </LoadBlock>
      ) : view === "board" ? (
        <TaskBoard rows={shown} viewerOf={viewerOf} busy={tasks.busy} onOpen={tasks.open} onMove={(row, status) => void tasks.move(row, status)} />
      ) : (
        <>
          {open.length === 0 && review.length === 0 ? (
            <EmptyState>{filter === "all" ? "Nothing to do right now." : "No tasks match."}</EmptyState>
          ) : null}
          {overdue.length > 0 ? (
            <Section title="Overdue" tone="bad">
              {rowsOf(overdue)}
            </Section>
          ) : null}
          {dueToday.length > 0 ? <Section title="Today">{rowsOf(dueToday)}</Section> : null}
          {later.length > 0 ? <Section title={overdue.length || dueToday.length ? "Later" : "To do"}>{rowsOf(later)}</Section> : null}
          {review.length > 0 ? <Section title="Waiting for your review">{rowsOf(review)}</Section> : null}
          {done.length > 0 ? (
            <details className="flex flex-col gap-1.5">
              <summary className="mx-1 min-h-11 cursor-pointer content-center font-medium text-primary">Done ({done.length})</summary>
              <ul className={group}>{rowsOf(done)}</ul>
            </details>
          ) : null}
        </>
      )}
      {tasks.detail(rows, viewerOf)}
    </section>
  );
}

/** `/supervisor/tasks` and `/admin/tasks` (D44, D48): assign, see "2 of 3 done", review, edit and archive. */
export function TasksDesk({ isAdmin }: { isAdmin: boolean }) {
  const [state, reload] = useLoad(loadAllStaffTasks);
  const [intern, setIntern] = useState("");
  const [view, setView] = useState<View>("list");
  const tasks = useTaskView(reload);
  const me = state.status === "ready" ? state.data.me : null;
  const rows = state.status === "ready" ? state.data.rows : [];
  const interns = [...new Map(rows.map((row) => [row.person_id, row.person_name])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const viewerOf = (row: TaskItem): Viewer => ({
    person: Boolean(me) && row.person_id === me,
    reviewer: Boolean(me) && row.reviewer_id === me,
    manager: true,
  });

  return (
    <div className={cn("flex flex-col gap-6", tasks.opened ? besidePanel : null)}>
      <PageHeader
        title="Tasks"
        description={
          isAdmin
            ? "Give interns tasks and see who has done them. Each intern ticks their own copy."
            : "Give your interns tasks and see who has done them. Each intern ticks their own copy."
        }
      />
      <section aria-labelledby="new-task-title" className={card}>
        <h2 id="new-task-title" className="text-base">
          New task
        </h2>
        <TaskForm mode="staff" onSaved={reload} />
      </section>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 sm:w-72">
          <Label htmlFor="task-filter">Show tasks for</Label>
          <select
            id="task-filter"
            className="h-12 w-full rounded-md border border-input bg-card px-3"
            value={intern}
            onChange={(e) => setIntern(e.target.value)}
          >
            <option value="">All interns</option>
            {interns.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <ViewSwitch view={view} setView={setView} />
      </div>
      <LoadBlock state={state} reload={reload}>
        {({ rows: data }) => {
          const forIntern = data.filter((row) => !intern || row.person_id === intern);
          if (data.length === 0) return <EmptyState>No tasks yet.</EmptyState>;
          if (view === "board")
            return (
              <TaskBoard
                rows={forIntern}
                viewerOf={viewerOf}
                busy={tasks.busy}
                onOpen={tasks.open}
                onMove={(row, status) => void tasks.move(row, status)}
                showPerson
              />
            );
          const toReview = sortTasks(forIntern.filter((row) => row.status === "in_review" && row.reviewer_id === me));
          const groups = groupTasks(data).filter((item) => !intern || item.copies.some((row) => row.person_id === intern));
          return (
            <div className="flex flex-col gap-6">
              {toReview.length > 0 ? (
                <Section title="Waiting for your review">
                  {toReview.map((row) => (
                    <TaskRow key={row.item_id} row={row} name={`${row.title} · ${row.person_name}`} onOpen={() => tasks.open(row)} />
                  ))}
                </Section>
              ) : null}
              {groups.length === 0 ? (
                <EmptyState>No tasks for this intern.</EmptyState>
              ) : (
                <ul className="flex flex-col gap-3">
                  {groups.map((item) => (
                    <TaskGroupCard key={item.key} group={item} all={data} onOpen={tasks.open} onChanged={reload} />
                  ))}
                </ul>
              )}
            </div>
          );
        }}
      </LoadBlock>
      {tasks.detail(rows, viewerOf)}
    </div>
  );
}

function TaskGroupCard({
  group: { first, copies, done },
  all,
  onOpen,
  onChanged,
}: {
  group: TaskGroup;
  all: StaffTask[];
  onOpen: (row: TaskItem) => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const due = dueText(first);
  const repeat = repeatSummary(first.repeat_days, first.repeat_until);

  async function archive() {
    const { error } = await createClient().rpc("archive_task", { id: first.task_id });
    if (error) toast.error(errorText(error, "It didn't archive. Try again."));
    else {
      toast.success("Task archived.");
      onChanged();
    }
  }

  return (
    <li className="overflow-hidden rounded-xl bg-card shadow-card">
      <div className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">{first.title}</p>
            <p className="text-sm text-muted-foreground">
              From {first.created_by_name}
              {first.reviewer_name ? ` · Reviewer ${first.reviewer_name}` : ""}
            </p>
          </div>
          <StatusChip tone={done === copies.length ? "ok" : "warn"} label={`${done} of ${copies.length} done`} />
        </div>
        <p className="flex flex-wrap gap-x-2.5 text-sm text-muted-foreground">
          <span>{PRIORITY_LABEL[first.priority as Priority] ?? first.priority} priority</span>
          {due ? <span className={isOverdue(first, new Date()) ? "font-semibold text-bad" : undefined}>Due {due}</span> : null}
          {repeat ? <span>{repeat}</span> : null}
        </p>
      </div>
      <ul aria-label={`Copies of ${first.title}`} className="divide-y divide-border border-t border-border">
        {copies.map((row) => (
          <TaskRow key={row.item_id} row={row} name={row.person_name} onOpen={() => onOpen(row)} />
        ))}
      </ul>
      {editing ? (
        <div className="border-t border-border p-4">
          <TaskForm
            mode="staff"
            initial={{
              id: first.task_id,
              title: first.title,
              description: first.description,
              priority: first.priority,
              due_date: first.due_date,
              due_time: first.due_time,
              link: first.link,
              repeat_days: first.repeat_days,
              repeat_until: first.repeat_until,
              // Every current assignee, across the task's days.
              assignees: [...new Set(all.filter((row) => row.task_id === first.task_id).map((row) => row.person_id))],
              reviewer: first.reviewer_id,
              reviewer_name: first.reviewer_name,
              estimate_minutes: first.estimate_minutes,
            }}
            onSaved={() => {
              setEditing(false);
              onChanged();
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 border-t border-border p-2">
          <Button type="button" size="sm" variant="ghost" aria-label={`Edit ${first.title}`} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button type="button" size="sm" variant="ghost" aria-label={`Archive ${first.title}`} onClick={() => void archive()}>
            Archive
          </Button>
        </div>
      )}
    </li>
  );
}

/** Supervisor intern page: that intern's copies; tapping one opens its detail to review, comment or unblock. */
export function InternTasks({ internId }: { internId: string }) {
  const load = useCallback(() => loadStaffTasks(internId), [internId]);
  const [state, reload] = useLoad(load);
  const tasks = useTaskView(reload);
  const me = state.status === "ready" ? state.data.me : null;
  const viewerOf = (row: TaskItem): Viewer => ({ person: false, reviewer: Boolean(me) && row.reviewer_id === me, manager: true });
  return (
    <div className={cn(tasks.opened ? besidePanel : null)}>
      <LoadBlock state={state} reload={reload}>
        {({ rows }) =>
          rows.length === 0 ? (
            <EmptyState>No tasks for this intern.</EmptyState>
          ) : (
            <ul className={group}>
              {sortTasks(rows).map((row) => (
                <TaskRow key={row.item_id} row={row} onOpen={() => tasks.open(row)} />
              ))}
            </ul>
          )
        }
      </LoadBlock>
      {tasks.detail(state.status === "ready" ? state.data.rows : [], viewerOf)}
    </div>
  );
}

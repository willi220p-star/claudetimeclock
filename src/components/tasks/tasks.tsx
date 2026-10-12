"use client";

import { useCallback, useState } from "react";
import { ListTodo } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { StatusChip, type Tone } from "@/components/status-chip";
import { TaskForm } from "@/components/tasks/task-form";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  dueText,
  groupTasks,
  isOverdue,
  repeatSummary,
  sortTasks,
  type MyTask,
  type Priority,
  type StaffTask,
  type TaskGroup,
  type TaskStatus,
} from "@/components/tasks/task-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/daymark";
import { formatDayTime } from "@/lib/darwin";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

const card = "flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card";
const PRIORITY_TONE: Record<string, Tone> = { high: "bad", medium: "warn", low: "neutral" };
const STATUS_TONE: Record<string, Tone> = { todo: "neutral", in_progress: "info", done: "ok" };

export async function loadMyTasks() {
  const { data, error } = await createClient().rpc("my_tasks");
  if (error) throw error;
  return (data ?? []) as MyTask[];
}

async function loadStaffTasks(intern?: string) {
  const { data, error } = await createClient().rpc("staff_tasks", intern ? { intern } : {});
  if (error) throw error;
  return (data ?? []) as StaffTask[];
}
const loadAllStaffTasks = () => loadStaffTasks();

/** Priority, due date and time (red when overdue), repeat, link and description: shared by every list. */
function TaskDetails({
  row,
  repeatUntil,
}: {
  row: Pick<MyTask, "title" | "priority" | "due_date" | "due_time" | "status" | "link" | "description" | "repeat_days">;
  repeatUntil?: string | null;
}) {
  const due = dueText(row);
  const overdue = isOverdue(row, new Date());
  const repeat = repeatSummary(row.repeat_days, repeatUntil ?? null);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusChip tone={PRIORITY_TONE[row.priority] ?? "neutral"} label={`${PRIORITY_LABEL[row.priority as Priority] ?? row.priority} priority`} />
        {due ? <span className={overdue ? "font-semibold text-bad" : "text-muted-foreground"}>Due {due}</span> : null}
        {overdue ? <StatusChip tone="bad" label="Overdue" /> : null}
        {repeat ? <span className="text-muted-foreground">{repeat}</span> : null}
      </div>
      {row.description ? <p className="text-sm whitespace-pre-line">{row.description}</p> : null}
      {row.link ? (
        <a href={row.link} target="_blank" rel="noopener noreferrer" className="w-fit text-sm break-all text-primary underline">
          {row.link}
        </a>
      ) : null}
    </>
  );
}

/** Intern Home (D44): their tasks and the ones they're working with, plus their own "Add task" form. */
export function TasksCard() {
  const [state, reload] = useLoad(loadMyTasks);
  const [adding, setAdding] = useState(false);
  const rows = state.status === "ready" ? sortTasks(state.data) : [];
  const open = rows.filter((row) => row.status !== "done");
  const done = rows.filter((row) => row.status === "done");

  return (
    <section aria-labelledby="tasks-title" className={card}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="tasks-title" className="flex items-center gap-2 text-base">
          <ListTodo aria-hidden className="size-4 text-primary" />
          Tasks
        </h2>
        {adding ? null : (
          <Button type="button" size="sm" variant="secondary" onClick={() => setAdding(true)}>
            Add task
          </Button>
        )}
      </div>
      {adding ? (
        <div className="rounded-lg border border-border p-3">
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
      ) : (
        <>
          {open.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to do right now.</p> : null}
          <ul className="flex flex-col divide-y divide-border">
            {open.map((row) => (
              <MyTaskItem key={row.item_id} row={row} onChanged={reload} />
            ))}
          </ul>
          {done.length > 0 ? (
            <details>
              <summary className="min-h-11 cursor-pointer content-center font-medium text-primary">Done ({done.length})</summary>
              <ul className="flex flex-col divide-y divide-border">
                {done.map((row) => (
                  <MyTaskItem key={row.item_id} row={row} onChanged={reload} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

function MyTaskItem({ row, onChanged }: { row: MyTask; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const noteId = `task-note-${row.item_id}`;

  async function setStatus(status: TaskStatus, doneNote?: string) {
    setBusy(true);
    const { error } = await createClient().rpc("set_task_status", {
      item: row.item_id,
      status,
      ...(doneNote ? { note: doneNote } : {}),
    });
    setBusy(false);
    if (error) {
      toast.error(errorText(error, "That didn't save. Try again."));
      return;
    }
    setAsking(false);
    setNote("");
    onChanged();
  }

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className={row.status === "done" ? "font-semibold text-muted-foreground line-through" : "font-semibold"}>{row.title}</p>
        {row.own ? null : <StatusChip tone={STATUS_TONE[row.status] ?? "neutral"} label={STATUS_LABEL[row.status as TaskStatus] ?? row.status} />}
      </div>
      <TaskDetails row={row} />
      <p className="text-sm text-muted-foreground">
        {row.own ? `From ${row.created_by_name}` : `${row.created_by_name}'s task`}
        {row.working_with?.length ? ` · Working with ${row.working_with.join(", ")}` : ""}
      </p>
      {row.status === "done" && row.done_at ? (
        <p className="text-sm text-muted-foreground">
          Done {formatDayTime(row.done_at)}
          {row.done_note ? ` · ${row.done_note}` : ""}
        </p>
      ) : null}
      {row.own ? (
        <div role="group" aria-label={`Status of ${row.title}`} className="flex flex-wrap gap-1">
          {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((status) => (
            <Button
              key={status}
              type="button"
              size="sm"
              variant={row.status === status ? "default" : "outline"}
              aria-pressed={row.status === status}
              disabled={busy}
              onClick={() => {
                if (row.status === status) return;
                if (status === "done") setAsking(true);
                else void setStatus(status);
              }}
            >
              {STATUS_LABEL[status]}
            </Button>
          ))}
        </div>
      ) : null}
      {asking ? (
        <form
          className="flex flex-col gap-2 rounded-lg bg-muted p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void setStatus("done", note.trim() || undefined);
          }}
        >
          <Label htmlFor={noteId}>Note (optional)</Label>
          <Input id={noteId} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you did" />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              Mark done
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/** `/supervisor/tasks` and `/admin/tasks` (D44): assign, see "2 of 3 done", edit and archive. */
export function TasksDesk({ isAdmin }: { isAdmin: boolean }) {
  const [state, reload] = useLoad(loadAllStaffTasks);
  const [intern, setIntern] = useState("");
  const rows = state.status === "ready" ? state.data : [];
  const interns = [...new Map(rows.map((row) => [row.person_id, row.person_name])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );

  return (
    <>
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
      <LoadBlock state={state} reload={reload} empty="No tasks yet.">
        {(data) => {
          const groups = groupTasks(data).filter((group) => !intern || group.copies.some((row) => row.person_id === intern));
          if (groups.length === 0) return <EmptyState>No tasks for this intern.</EmptyState>;
          return (
            <ul className="flex flex-col gap-3">
              {groups.map((group) => (
                <TaskGroupCard key={group.key} group={group} all={data} onChanged={reload} />
              ))}
            </ul>
          );
        }}
      </LoadBlock>
    </>
  );
}

function TaskGroupCard({ group, all, onChanged }: { group: TaskGroup; all: StaffTask[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const { first, copies, done, left } = group;

  async function archive() {
    const { error } = await createClient().rpc("archive_task", { id: first.task_id });
    if (error) toast.error(errorText(error, "It didn't archive. Try again."));
    else {
      toast.success("Task archived.");
      onChanged();
    }
  }

  return (
    <li className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{first.title}</p>
          <p className="text-sm text-muted-foreground">From {first.created_by_name}</p>
        </div>
        <StatusChip tone={done === copies.length ? "ok" : "warn"} label={`${done} of ${copies.length} done`} />
      </div>
      <TaskDetails row={first} repeatUntil={first.repeat_until} />
      {left.length > 0 ? <p className="text-sm">Still to do: {left.join(", ")}</p> : null}
      {copies.some((row) => row.done_note) ? (
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {copies
            .filter((row) => row.done_note)
            .map((row) => (
              <li key={row.item_id}>
                {row.person_name}: {row.done_note}
              </li>
            ))}
        </ul>
      ) : null}
      {editing ? (
        <div className="rounded-lg border border-border p-3">
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
            }}
            onSaved={() => {
              setEditing(false);
              onChanged();
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" aria-label={`Edit ${first.title}`} onClick={() => setEditing(true)}>
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

/** Supervisor intern page: that intern's copies, read-only. */
export function InternTasks({ internId }: { internId: string }) {
  const load = useCallback(() => loadStaffTasks(internId), [internId]);
  const [state, reload] = useLoad(load);
  return (
    <LoadBlock state={state} reload={reload} empty="No tasks for this intern.">
      {(rows) => (
        <ul className="flex flex-col gap-2">
          {sortTasks(rows).map((row) => (
            <li key={row.item_id} className={card}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-semibold">{row.title}</p>
                <StatusChip tone={STATUS_TONE[row.status] ?? "neutral"} label={STATUS_LABEL[row.status as TaskStatus] ?? row.status} />
              </div>
              <TaskDetails row={row} repeatUntil={row.repeat_until} />
              {row.status === "done" && row.done_at ? (
                <p className="text-sm text-muted-foreground">
                  Done {formatDayTime(row.done_at)}
                  {row.done_note ? ` · ${row.done_note}` : ""}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </LoadBlock>
  );
}

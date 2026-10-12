import type { Database } from "@/lib/database.types";
import { darwinAt, darwinDateKey, formatDay, formatTimeOfDay } from "@/lib/darwin";
import { addDays, mondayOf } from "@/lib/periods";

type Fns = Database["public"]["Functions"];
type Nullable =
  | "description"
  | "due_date"
  | "due_time"
  | "link"
  | "done_at"
  | "done_note"
  | "repeat_days"
  | "reviewer_id"
  | "reviewer_name"
  | "estimate_minutes"
  | "blocked_reason"
  | "review_requested_at";
type Loosen<T> = Omit<T, Nullable> & {
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  link: string | null;
  done_at: string | null;
  done_note: string | null;
  repeat_days: number[] | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  estimate_minutes: number | null;
  blocked_reason: string | null;
  review_requested_at: string | null;
};
/** The generator marks every function column non-null; these can be null at runtime. */
export type MyTask = Loosen<Fns["my_tasks"]["Returns"][number]>;
export type StaffTask = Omit<Loosen<Fns["staff_tasks"]["Returns"][number]>, "repeat_until"> & { repeat_until: string | null };

export type Priority = "high" | "medium" | "low";
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done";
/** The fields every list, board and detail view needs: a `my_tasks` row or a `staff_tasks` row. */
export type TaskItem = Omit<MyTask, "own" | "working_with" | "to_review"> & {
  own?: boolean;
  working_with?: string[];
  to_review?: boolean;
  person_id?: string;
  person_name?: string;
  repeat_until?: string | null;
};

export const PRIORITY_LABEL: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };
export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
};
export const STATUSES = Object.keys(STATUS_LABEL) as TaskStatus[];
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Sortable = { status: string; due_date: string | null; priority: string; done_at: string | null };

/** Open first by due date (no date last) then priority high to low; done after, newest first. */
export function compareTasks(a: Sortable, b: Sortable) {
  const doneA = a.status === "done";
  const doneB = b.status === "done";
  if (doneA !== doneB) return doneA ? 1 : -1;
  if (doneA) return (b.done_at ?? "").localeCompare(a.done_at ?? "");
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  }
  return (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1);
}

export const sortTasks = <T extends Sortable>(rows: T[]) => [...rows].sort(compareTasks);

/** Open and past its due date, or due today with its due time gone (Darwin). */
export function isOverdue(row: { status: string; due_date: string | null; due_time: string | null }, now: Date) {
  if (row.status === "done" || !row.due_date) return false;
  const today = darwinDateKey(now);
  if (row.due_date < today) return true;
  return row.due_date === today && !!row.due_time && darwinAt(row.due_date, row.due_time) < now;
}

export type TaskFilter = "all" | "today" | "week" | "overdue" | "review";
export const TASK_FILTERS: { value: TaskFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "overdue", label: "Overdue" },
  { value: "review", label: "To review" },
];

/** My work quick filters (D46): open tasks due today, this Monday–Sunday, or overdue (Darwin). */
export function matchesTaskFilter(
  row: { status: string; due_date: string | null; due_time: string | null; to_review?: boolean },
  filter: TaskFilter,
  now: Date,
) {
  if (filter === "all") return true;
  if (filter === "review") return Boolean(row.to_review);
  if (row.status === "done") return false;
  if (filter === "overdue") return isOverdue(row, now);
  if (!row.due_date) return false;
  const today = darwinDateKey(now);
  if (filter === "today") return row.due_date === today;
  const monday = mondayOf(today);
  return row.due_date >= monday && row.due_date <= addDays(monday, 6);
}

/** "Tue 14 Oct, 9:00 am", "Tue 14 Oct" or null. */
export function dueText(row: { due_date: string | null; due_time: string | null }) {
  if (!row.due_date) return null;
  return row.due_time ? `${formatDay(row.due_date)}, ${formatTimeOfDay(row.due_time)}` : formatDay(row.due_date);
}

/** "Every Mon, Fri until 30 Nov" (ISO weekdays 1–7). */
export function repeatSummary(days: number[] | null, until: string | null) {
  if (!days || days.length === 0) return null;
  const names = [...new Set(days)]
    .sort((a, b) => a - b)
    .map((day) => WEEKDAYS[day - 1])
    .filter(Boolean);
  const every = names.length === 7 ? "Every day" : `Every ${names.join(", ")}`;
  if (!until) return every;
  const [, month, day] = until.split("-").map(Number);
  return `${every} until ${day} ${MONTHS[month - 1]}`;
}

/** "• title: note" lines for the person's own copies ticked done on `dateKey` (Darwin). */
export function workLogLines(rows: MyTask[], dateKey: string) {
  return sortTasks(rows)
    .filter((row) => row.own && row.status === "done" && row.done_at && darwinDateKey(row.done_at) === dateKey)
    .reverse()
    .map((row) => (row.done_note?.trim() ? `• ${row.title}: ${row.done_note.trim()}` : `• ${row.title}`));
}

export type TaskGroup = {
  key: string;
  first: StaffTask;
  copies: StaffTask[];
  done: number;
  left: string[];
};

/** Staff list: one group per task and due day, so a repeating task shows each day's "2 of 3 done". */
export function groupTasks(rows: StaffTask[]): TaskGroup[] {
  const groups = new Map<string, StaffTask[]>();
  for (const row of rows) {
    const key = `${row.task_id}|${row.due_date ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([key, copies]) => {
      const open = copies.filter((row) => row.status !== "done");
      // Represent the group by an open copy, so a part-done group sorts with the open ones.
      const first = open[0] ?? copies[0];
      return { key, first, copies, done: copies.length - open.length, left: open.map((row) => row.person_name) };
    })
    .sort((a, b) => compareTasks(a.first, b.first));
}

/** "1 h 40 m", "3 h", "40 m" (D48 estimate and time spent). */
export function formatMinutes(total: number) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} m`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} m`;
}

/** Hours and minutes boxes to a total: null when both are blank; whole, non-negative numbers only. */
export function parseDuration(hours: string, minutes: string): { minutes: number | null } | { error: string } {
  const h = hours.trim();
  const m = minutes.trim();
  if (!h && !m) return { minutes: null };
  if (!/^\d*$/.test(h) || !/^\d*$/.test(m)) return { error: "Use whole hours and minutes." };
  return { minutes: Number(h || 0) * 60 + Number(m || 0) };
}

/** Board columns (D48), each sorted like the list. An unknown status lands in To do. */
export function boardColumns<T extends TaskItem>(rows: T[]) {
  const statusOf = (row: T) => (STATUSES.includes(row.status as TaskStatus) ? (row.status as TaskStatus) : "todo");
  return STATUSES.map((status) => ({
    status,
    label: STATUS_LABEL[status],
    rows: sortTasks(rows.filter((row) => statusOf(row) === status)),
  }));
}

/** Who is looking at a copy: its person, its reviewer, or staff who manage the person. */
export type Viewer = { person: boolean; reviewer: boolean; manager: boolean };
type Gate = Pick<TaskItem, "status" | "reviewer_id" | "subtasks_total" | "subtasks_done">;

const allTicked = (task: Gate) => task.subtasks_done >= task.subtasks_total;
const tickReason = (task: Gate, then: string) =>
  task.subtasks_total === 1 ? `Tick the subtask to ${then}.` : `Tick all ${task.subtasks_total} subtasks to ${then}.`;

/**
 * Why `viewer` can't move the copy to `to`, or null when they can. Mirrors set_task_status (D48): only the person sends
 * for review, and only with a reviewer and every subtask ticked; with a reviewer only Approve makes it Done; while in
 * review only the person can take it back.
 */
export function moveBlocker(task: Gate, viewer: Viewer, to: TaskStatus): string | null {
  if (task.status === to) return "It's already there.";
  if (!viewer.person && !viewer.manager) return "Only the person it's for can move it.";
  if (task.status === "in_review" && !viewer.person) return "It's waiting for the reviewer.";
  if (to === "in_review") {
    if (!task.reviewer_id) return "It has no reviewer. Mark it done instead.";
    if (!viewer.person) return "Only the person it's for can send it for review.";
    if (!allTicked(task)) return tickReason(task, "send for review");
  }
  if (to === "done") {
    if (task.reviewer_id) return "Send it for review. Your reviewer marks it done.";
    if (!allTicked(task)) return tickReason(task, "mark it done");
  }
  return null;
}

export type PrimaryAction = { kind: "review" | "done" | "withdraw" | "reopen"; label: string; blocker: string | null };

/** The detail sheet's footer (D48): the one main action, the review buttons, and what else the viewer may change. */
export function taskActions(task: Gate, viewer: Viewer) {
  const review = viewer.reviewer && task.status === "in_review";
  const open = task.status === "todo" || task.status === "in_progress";
  let primary: PrimaryAction | null = null;
  if (review) primary = null;
  else if (open && task.reviewer_id && viewer.person)
    primary = { kind: "review", label: "Send for review", blocker: moveBlocker(task, viewer, "in_review") };
  else if (open && !task.reviewer_id && (viewer.person || viewer.manager))
    primary = { kind: "done", label: "Mark done", blocker: moveBlocker(task, viewer, "done") };
  else if (task.status === "in_review" && viewer.person) primary = { kind: "withdraw", label: "Take back", blocker: null };
  else if (task.status === "done" && (viewer.person || viewer.manager)) primary = { kind: "reopen", label: "Reopen", blocker: null };
  return {
    review,
    primary,
    blocked: task.status !== "done" && (viewer.person || viewer.manager),
    logTime: viewer.person,
    editSubtasks: task.status !== "done" && (viewer.person || viewer.reviewer || viewer.manager),
  };
}

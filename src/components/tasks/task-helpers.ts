import type { Database } from "@/lib/database.types";
import { darwinAt, darwinDateKey, formatDay, formatTimeOfDay } from "@/lib/darwin";

type Fns = Database["public"]["Functions"];
type Nullable = "description" | "due_date" | "due_time" | "link" | "done_at" | "done_note";
type Loosen<T> = Omit<T, Nullable | "repeat_days"> & {
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  link: string | null;
  done_at: string | null;
  done_note: string | null;
  repeat_days: number[] | null;
};
/** The generator marks every function column non-null; these can be null at runtime. */
export type MyTask = Loosen<Fns["my_tasks"]["Returns"][number]>;
export type StaffTask = Omit<Loosen<Fns["staff_tasks"]["Returns"][number]>, "repeat_until"> & { repeat_until: string | null };

export type Priority = "high" | "medium" | "low";
export type TaskStatus = "todo" | "in_progress" | "done";

export const PRIORITY_LABEL: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };
export const STATUS_LABEL: Record<TaskStatus, string> = { todo: "To do", in_progress: "In progress", done: "Done" };
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

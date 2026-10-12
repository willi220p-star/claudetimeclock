import { describe, expect, it } from "vitest";
import {
  groupTasks,
  isOverdue,
  matchesTaskFilter,
  repeatSummary,
  sortTasks,
  workLogLines,
  type MyTask,
  type StaffTask,
} from "@/components/tasks/task-helpers";

describe("matchesTaskFilter (My work quick filters)", () => {
  const now = new Date("2026-10-14T10:00:00+09:30"); // Wednesday, Darwin
  const due = (due_date: string | null, status = "todo") => ({ status, due_date, due_time: null });

  it("Today, This week (Mon–Sun) and Overdue on open tasks only", () => {
    expect(matchesTaskFilter(due("2026-10-14"), "today", now)).toBe(true);
    expect(matchesTaskFilter(due("2026-10-14", "done"), "today", now)).toBe(false);
    expect(matchesTaskFilter(due("2026-10-12"), "week", now)).toBe(true);
    expect(matchesTaskFilter(due("2026-10-18"), "week", now)).toBe(true);
    expect(matchesTaskFilter(due("2026-10-19"), "week", now)).toBe(false);
    expect(matchesTaskFilter(due("2026-10-13"), "overdue", now)).toBe(true);
    expect(matchesTaskFilter(due(null), "week", now)).toBe(false);
    expect(matchesTaskFilter(due(null, "done"), "all", now)).toBe(true);
  });
});

const base: MyTask = {
  item_id: "i",
  task_id: "t",
  title: "Task",
  description: null,
  priority: "medium",
  due_date: null,
  due_time: null,
  link: null,
  status: "todo",
  done_at: null,
  done_note: null,
  created_by_name: "Sam",
  own: true,
  working_with: [],
  repeat_days: null,
  reviewer_id: null,
  reviewer_name: null,
  estimate_minutes: null,
  spent_minutes: 0,
  blocked_reason: null,
  subtasks_total: 0,
  subtasks_done: 0,
  comments: 0,
  review_requested_at: null,
  to_review: false,
};
const task = (patch: Partial<MyTask>): MyTask => ({ ...base, ...patch });

describe("sortTasks", () => {
  it("puts open first by due date (none last) then priority, done newest first", () => {
    const rows = [
      task({ title: "done old", status: "done", done_at: "2026-10-01T01:00:00Z" }),
      task({ title: "no date" }),
      task({ title: "15 low", due_date: "2026-10-15", priority: "low" }),
      task({ title: "done new", status: "done", done_at: "2026-10-10T01:00:00Z" }),
      task({ title: "15 high", due_date: "2026-10-15", priority: "high" }),
      task({ title: "14", due_date: "2026-10-14" }),
    ];
    expect(sortTasks(rows).map((row) => row.title)).toEqual(["14", "15 high", "15 low", "no date", "done new", "done old"]);
  });
});

describe("isOverdue", () => {
  // 10:00 Darwin on 14 Oct.
  const now = new Date("2026-10-14T00:30:00Z");
  it("is overdue before today, or today after its due time", () => {
    expect(isOverdue({ status: "todo", due_date: "2026-10-13", due_time: null }, now)).toBe(true);
    expect(isOverdue({ status: "todo", due_date: "2026-10-14", due_time: null }, now)).toBe(false);
    expect(isOverdue({ status: "todo", due_date: "2026-10-14", due_time: "09:00:00" }, now)).toBe(true);
    expect(isOverdue({ status: "in_progress", due_date: "2026-10-14", due_time: "11:00" }, now)).toBe(false);
  });
  it("is never overdue when done or undated", () => {
    expect(isOverdue({ status: "done", due_date: "2026-10-01", due_time: null }, now)).toBe(false);
    expect(isOverdue({ status: "todo", due_date: null, due_time: null }, now)).toBe(false);
  });
});

describe("repeatSummary", () => {
  it("names the weekdays in order and the end date", () => {
    expect(repeatSummary([5, 1], "2026-11-30")).toBe("Every Mon, Fri until 30 Nov");
    expect(repeatSummary([1, 2, 3, 4, 5, 6, 7], "2026-12-01")).toBe("Every day until 1 Dec");
    expect(repeatSummary(null, null)).toBeNull();
    expect(repeatSummary([], "2026-11-30")).toBeNull();
  });
});

describe("workLogLines", () => {
  it("lists own copies done on that Darwin day, oldest first, with the note", () => {
    const rows = [
      // 23:45 Darwin on 14 Oct.
      task({ title: "Late one", status: "done", done_at: "2026-10-14T14:15:00Z" }),
      task({ title: "Report", status: "done", done_at: "2026-10-14T00:30:00Z", done_note: " Sent to Sam " }),
      // 00:15 Darwin on 15 Oct.
      task({ title: "Tomorrow", status: "done", done_at: "2026-10-14T14:45:00Z" }),
      task({ title: "Teammate's", status: "done", done_at: "2026-10-14T01:00:00Z", own: false }),
      task({ title: "Open", status: "in_progress" }),
    ];
    expect(workLogLines(rows, "2026-10-14")).toEqual(["• Report: Sent to Sam", "• Late one"]);
  });
});

describe("groupTasks", () => {
  it("counts done copies per task and day, and names who's left", () => {
    const staff = (patch: Partial<StaffTask>): StaffTask => ({
      ...base,
      person_id: "p",
      person_name: "Ana",
      repeat_until: null,
      ...patch,
    });
    const groups = groupTasks([
      staff({ task_id: "a", person_name: "Ana", status: "done", done_at: "2026-10-14T01:00:00Z" }),
      staff({ task_id: "a", person_name: "Ben" }),
      staff({ task_id: "a", person_name: "Cy", status: "in_progress" }),
      staff({ task_id: "b", person_name: "Ana", due_date: "2026-10-13" }),
    ]);
    expect(groups.map((group) => [group.first.task_id, group.done, group.copies.length, group.left])).toEqual([
      ["b", 0, 1, ["Ana"]],
      ["a", 1, 3, ["Ben", "Cy"]],
    ]);
  });
});

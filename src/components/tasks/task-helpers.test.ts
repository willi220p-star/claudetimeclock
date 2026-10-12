import { describe, expect, it } from "vitest";
import {
  boardColumns,
  formatMinutes,
  groupTasks,
  moveBlocker,
  parseDuration,
  taskActions,
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

  it("To review keeps only rows waiting for the caller's review", () => {
    expect(matchesTaskFilter({ ...due(null, "in_review"), to_review: true }, "review", now)).toBe(true);
    expect(matchesTaskFilter({ ...due(null, "in_review"), to_review: false }, "review", now)).toBe(false);
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
  project_id: null,
  project_name: null,
  milestone_id: null,
  milestone_name: null,
  labels: [],
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

describe("formatMinutes and parseDuration (D48 estimate and time spent)", () => {
  it("formats hours and minutes", () => {
    expect(formatMinutes(100)).toBe("1 h 40 m");
    expect(formatMinutes(180)).toBe("3 h");
    expect(formatMinutes(40)).toBe("40 m");
    expect(formatMinutes(0)).toBe("0 m");
  });
  it("adds up the boxes, null when both are blank, refuses non-whole numbers", () => {
    expect(parseDuration("1", "40")).toEqual({ minutes: 100 });
    expect(parseDuration("", "90")).toEqual({ minutes: 90 });
    expect(parseDuration(" 3 ", "")).toEqual({ minutes: 180 });
    expect(parseDuration("", " ")).toEqual({ minutes: null });
    expect(parseDuration("1.5", "")).toHaveProperty("error");
    expect(parseDuration("-1", "")).toHaveProperty("error");
  });
});

describe("boardColumns", () => {
  it("puts each copy in its status column, sorted, with unknown statuses in To do", () => {
    const columns = boardColumns([
      task({ item_id: "a", status: "in_review" }),
      task({ item_id: "b", status: "todo", due_date: "2026-10-15" }),
      task({ item_id: "c", status: "weird" }),
      task({ item_id: "d", status: "done" }),
      task({ item_id: "e", status: "todo", due_date: "2026-10-14" }),
    ]);
    expect(columns.map((column) => [column.label, column.rows.map((row) => row.item_id)])).toEqual([
      ["To do", ["e", "b", "c"]],
      ["In progress", []],
      ["In review", ["a"]],
      ["Done", ["d"]],
    ]);
  });
});

describe("taskActions and moveBlocker (who sees which button)", () => {
  const person = { person: true, reviewer: false, manager: false };
  const reviewer = { person: false, reviewer: true, manager: false };
  const staff = { person: false, reviewer: false, manager: true };
  const teammate = { person: false, reviewer: false, manager: false };
  const copy = (patch: Partial<MyTask>) => task({ status: "in_progress", ...patch });

  it("the person sends for review once every subtask is ticked", () => {
    const open = copy({ reviewer_id: "r", subtasks_total: 4, subtasks_done: 2 });
    expect(taskActions(open, person).primary).toEqual({
      kind: "review",
      label: "Send for review",
      blocker: "Tick all 4 subtasks to send for review.",
    });
    expect(taskActions({ ...open, subtasks_done: 4 }, person).primary?.blocker).toBeNull();
    expect(taskActions(copy({ reviewer_id: "r", subtasks_total: 1 }), person).primary?.blocker).toBe(
      "Tick the subtask to send for review.",
    );
  });

  it("without a reviewer the person or staff mark it done, gated on subtasks", () => {
    expect(taskActions(copy({}), person).primary).toEqual({ kind: "done", label: "Mark done", blocker: null });
    expect(taskActions(copy({ subtasks_total: 2, subtasks_done: 1 }), staff).primary?.blocker).toBe(
      "Tick all 2 subtasks to mark it done.",
    );
  });

  it("with a reviewer, staff who aren't the reviewer get no main action", () => {
    expect(taskActions(copy({ reviewer_id: "r" }), staff).primary).toBeNull();
  });

  it("only the reviewer sees Needs changes and Approve, and only in review", () => {
    const inReview = copy({ status: "in_review", reviewer_id: "r" });
    expect(taskActions(inReview, reviewer)).toMatchObject({ review: true, primary: null, logTime: false });
    expect(taskActions(copy({ reviewer_id: "r" }), reviewer).review).toBe(false);
    expect(taskActions(inReview, person)).toMatchObject({ review: false, primary: { kind: "withdraw" } });
  });

  it("a teammate can only read and comment", () => {
    expect(taskActions(copy({}), teammate)).toEqual({
      review: false,
      primary: null,
      blocked: false,
      logTime: false,
      editSubtasks: false,
    });
  });

  it("done copies can be reopened but not blocked or edited", () => {
    expect(taskActions(copy({ status: "done" }), person)).toMatchObject({
      primary: { kind: "reopen" },
      blocked: false,
      editSubtasks: false,
    });
  });

  it("Move to… follows set_task_status", () => {
    const withReviewer = copy({ reviewer_id: "r" });
    expect(moveBlocker(withReviewer, person, "done")).toBe("Send it for review. Your reviewer marks it done.");
    expect(moveBlocker(withReviewer, person, "in_review")).toBeNull();
    expect(moveBlocker(withReviewer, staff, "in_review")).toBe("Only the person it's for can send it for review.");
    expect(moveBlocker(copy({}), person, "in_review")).toBe("It has no reviewer. Mark it done instead.");
    expect(moveBlocker(copy({ status: "in_review", reviewer_id: "r" }), staff, "todo")).toBe("It's waiting for the reviewer.");
    expect(moveBlocker(copy({ status: "in_review", reviewer_id: "r" }), person, "in_progress")).toBeNull();
    expect(moveBlocker(copy({}), teammate, "todo")).toBe("Only the person it's for can move it.");
    expect(moveBlocker(copy({}), staff, "todo")).toBeNull();
  });
});

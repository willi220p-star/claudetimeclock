import { describe, expect, test } from "vitest";
import {
  attendanceBreakdown,
  attendanceRates,
  owedRanking,
  pct,
  periodHours,
  progressToTarget,
  requestStats,
  weekByDay,
  weeklyBars,
} from "@/lib/chart-data";
import type { ProgressRow } from "@/lib/placement-ui";

const at = (date: string, time: string) => `${date}T${time}:00+09:30`;
const punch = (id: string, event_type: "shift_in" | "shift_out", occurred_at: string) => ({ id, event_type, occurred_at });

describe("weekByDay", () => {
  test("totals per day and per session, open session runs to now", () => {
    const punches = [
      punch("a", "shift_in", at("2026-10-05", "09:00")),
      punch("b", "shift_out", at("2026-10-05", "12:00")),
      punch("c", "shift_in", at("2026-10-05", "12:30")),
      punch("d", "shift_out", at("2026-10-05", "17:00")),
      punch("e", "shift_in", at("2026-10-07", "09:00")),
      punch("x", "shift_in", at("2026-10-12", "09:00")), // next week: ignored
    ];
    const { days, total } = weekByDay(punches, "2026-10-05", new Date(at("2026-10-07", "10:15")), [
      { work_date: "2026-10-05", counted: 450 },
    ]);
    expect(days.map((day) => day.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(days[0]).toMatchObject({ date: "2026-10-05", minutes: 450, hours: 7.5, counted: 450 });
    expect(days[0].sessions.map((s) => s.minutes)).toEqual([180, 270]);
    expect(days[2]).toMatchObject({ minutes: 75, counted: null });
    expect(days[2].sessions[0].end).toBeNull();
    expect(total).toBe(525);
  });

  test("a lone clock-out counts nothing", () => {
    const { days } = weekByDay([punch("o", "shift_out", at("2026-10-06", "17:00"))], "2026-10-05", new Date());
    expect(days[1].sessions).toEqual([{ id: "o", start: null, end: at("2026-10-06", "17:00"), minutes: 0 }]);
  });
});

test("weeklyBars plots hours", () => {
  expect(weeklyBars([{ week_no: 1, counted: 450, scheduled: 900 }, { week_no: 2, counted: null, scheduled: null }])).toEqual([
    { label: "W1", counted: 7.5, rostered: 15 },
    { label: "W2", counted: 0, rostered: 0 },
  ]);
});

test("attendanceBreakdown sorts days into worked, absent, leave, moved", () => {
  const days = [
    { work_date: "2026-10-01", status: "scheduled", leave_kind: null },
    { work_date: "2026-10-02", status: "leave", leave_kind: "sick" },
    { work_date: "2026-10-03", status: "leave", leave_kind: "absent" },
    { work_date: "2026-10-04", status: "moved", leave_kind: null },
  ];
  const results = [
    { work_date: "2026-10-01", counted: 400, no_show: false },
    { work_date: "2026-10-05", counted: 0, no_show: true },
  ];
  expect(attendanceBreakdown(days, results).map((row) => [row.key, row.days])).toEqual([
    ["worked", 1],
    ["absent", 2],
    ["leave", 1],
    ["moved", 1],
  ]);
});

test("attendanceRates mirrors private.attendance", () => {
  const row = (no_show: boolean, late: boolean, scheduled = 450, closed = true) => ({ scheduled, closed, no_show, late });
  expect(attendanceRates([row(false, false), row(false, true), row(true, false), row(false, false, 0), row(true, false, 450, false)])).toEqual({
    attendancePct: 67,
    onTimePct: 50,
  });
  expect(attendanceRates([])).toEqual({ attendancePct: null, onTimePct: null });
  expect(pct(1, 3)).toBe(33);
});

test("periodHours keeps to the window and counts leave as rostered", () => {
  const results = [
    { work_date: "2026-09-27", counted: 100 },
    { work_date: "2026-09-28", counted: 450 },
  ];
  const days = [
    { work_date: "2026-09-28", status: "scheduled", planned_minutes: 450 },
    { work_date: "2026-09-29", status: "leave", planned_minutes: 450 },
    { work_date: "2026-09-30", status: "moved", planned_minutes: 450 },
    { work_date: "2026-10-12", status: "scheduled", planned_minutes: 450 },
  ];
  expect(periodHours(results, days, "2026-09-28", "2026-10-11")).toEqual({ counted: 450, rostered: 900 });
});

const progress = (name: string, status: string, counted: number, owed: number) =>
  ({ placement_id: name, intern_name: name, status, counted_total: counted, target_minutes: 1000, owed }) as ProgressRow;

test("progressToTarget keeps live placements, caps at 100%, furthest first", () => {
  const rows = [progress("A", "active", 250, 0), progress("B", "completed", 1000, 0), progress("C", "extended", 1200, 0)];
  expect(progressToTarget(rows).map((row) => [row.label, row.pct])).toEqual([
    ["C", 100],
    ["A", 25],
  ]);
});

test("owedRanking drops anyone ahead, most owed first", () => {
  const rows = [progress("A", "active", 0, 60), progress("B", "active", 0, -30), progress("C", "active", 0, 120)];
  expect(owedRanking(rows).map((row) => [row.label, row.hours])).toEqual([
    ["C", 2],
    ["A", 1],
  ]);
});

test("requestStats counts by status and buckets waiting requests by age", () => {
  const now = new Date("2026-10-08T00:00:00Z");
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  const { byStatus, byAge } = requestStats(
    [
      { status: "pending_supervisor", created_at: ago(2) },
      { status: "pending_admin", created_at: ago(30) },
      { status: "pending_supervisor", created_at: ago(24) },
      { status: "pending_supervisor", created_at: ago(200) },
      { status: "approved", created_at: ago(500) },
    ],
    now,
  );
  expect(byStatus.map((row) => row.count)).toEqual([3, 1, 1, 0, 0]);
  expect(byAge.map((row) => row.count)).toEqual([1, 2, 0, 1]);
});

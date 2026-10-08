import { describe, expect, test } from "vitest";
import { dayTimes, filterDays, profileDays, profileSummary } from "@/lib/profile-stats";

const punch = (id: string, event_type: "shift_in" | "shift_out", time: string, extra: Record<string, unknown> = {}) => ({
  id,
  event_type,
  occurred_at: `${time}+09:30`,
  is_break: false,
  source: "clock",
  confirmed_at: null as string | null,
  replaces_punch_id: null as string | null,
  ...extra,
});

const today = "2026-10-08"; // a Thursday
const days = [
  { work_date: "2026-09-28", status: "scheduled", leave_kind: null },
  { work_date: "2026-09-29", status: "leave", leave_kind: "absent" },
  { work_date: "2026-10-05", status: "scheduled", leave_kind: null },
  { work_date: "2026-10-06", status: "moved", leave_kind: null },
  { work_date: "2026-10-12", status: "scheduled", leave_kind: null },
];
const results = [
  { work_date: "2026-09-28", counted: 450, scheduled: 450, worked: 450, late: false },
  { work_date: "2026-09-29", counted: 0, scheduled: 450, worked: 0, late: false },
  { work_date: "2026-10-05", counted: 400, scheduled: 450, worked: 400, late: true },
  { work_date: "2026-10-12", counted: 0, scheduled: 450, worked: 0, late: false },
];
const punches = [
  punch("a", "shift_in", "2026-10-05T09:10:00"),
  punch("b", "shift_out", "2026-10-05T12:00:00", { is_break: true }),
  punch("c", "shift_in", "2026-10-05T12:30:00", { is_break: true }),
  punch("d", "shift_out", "2026-10-05T17:00:00"),
  punch("e", "shift_out", "2026-10-05T17:30:00", { source: "staff_edit", replaces_punch_id: "d" }),
  punch("f", "shift_in", "2026-10-07T09:00:00", { source: "supervisor" }),
];

describe("intern profile stats", () => {
  const list = profileDays({ days, results, kinds: [{ work_date: "2026-10-05", kind: "work_based", status: "pending" }], punches, today });

  test("one row per past day, newest first, replaced punches dropped", () => {
    expect(list.map((day) => day.date)).toEqual(["2026-10-07", "2026-10-06", "2026-10-05", "2026-09-29", "2026-09-28"]);
    const oct5 = list.find((day) => day.date === "2026-10-05")!;
    expect(oct5.rows.flatMap((row) => [row.in?.id, row.out?.id])).toEqual(["a", "b", "c", "e"]);
    expect(oct5).toMatchObject({ came: true, late: true, edited: true, typedIn: false, kind: { kind: "work_based" } });
    expect(list.find((day) => day.date === "2026-10-07")).toMatchObject({ came: true, typedIn: true });
  });

  test("clock-in, break, clock-out and session lengths", () => {
    const times = dayTimes(list.find((day) => day.date === "2026-10-05")!.rows);
    expect(times.clockIn?.id).toBe("a");
    expect(times.clockOut?.id).toBe("e");
    expect(times.breaks.map((item) => [item.start.id, item.end?.id, item.minutes])).toEqual([["b", "c", 30]]);
    expect(times.sessions).toEqual([170, 300]);
  });

  test("summary counts days and whole weeks against their scheduled hours", () => {
    expect(profileSummary(list, results, today)).toEqual({
      worked: 3,
      absent: 1,
      moved: 1,
      late: 1,
      weeksMet: 0,
      weeksMissed: 1, // week of 28 Sep: 450 of 900; this week is still running
      thisWeek: { counted: 400, scheduled: 450 },
    });
  });

  test("filter and date range", () => {
    expect(filterDays(list, "absent", "", "").map((day) => day.date)).toEqual(["2026-09-29"]);
    expect(filterDays(list, "moved", "", "").map((day) => day.date)).toEqual(["2026-10-06"]);
    expect(filterDays(list, "worked", "2026-10-01", "2026-10-06").map((day) => day.date)).toEqual(["2026-10-05"]);
    expect(filterDays(list, "all", "2026-10-06", "").length).toBe(2);
  });
});

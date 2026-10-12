import { describe, expect, test } from "vitest";
import { historyFrom, historyMonths, historyRows, pendingFixDates } from "@/lib/history";
import { buildRequestPayload } from "@/lib/placement-ui";

const punch = (id: string, event_type: "shift_in" | "shift_out", time: string, extra: Record<string, unknown> = {}) => ({
  id,
  event_type,
  occurred_at: `${time}+09:30`,
  is_break: false,
  source: "device",
  confirmed_at: null as string | null,
  verification_method: "gps_selfie" as string | null,
  replaces_punch_id: null as string | null,
  ...extra,
});

const today = "2026-10-12"; // a Monday
const days = [
  { work_date: "2026-09-30", status: "scheduled", leave_kind: null },
  { work_date: "2026-10-06", status: "leave", leave_kind: "sick" },
  { work_date: "2026-10-07", status: "scheduled", leave_kind: null },
  { work_date: "2026-10-08", status: "scheduled", leave_kind: null },
  { work_date: "2026-10-09", status: "scheduled", leave_kind: null },
  { work_date: "2026-10-12", status: "scheduled", leave_kind: null },
  { work_date: "2026-10-14", status: "scheduled", leave_kind: null },
];
const results = [
  { work_date: "2026-09-30", counted: 450, scheduled: 450, worked: 450, late: false },
  { work_date: "2026-10-06", counted: 0, scheduled: 450, worked: 0, late: false },
  { work_date: "2026-10-07", counted: 449, scheduled: 450, worked: 449, late: false },
  { work_date: "2026-10-08", counted: 305, scheduled: 450, worked: 305, late: true },
  { work_date: "2026-10-09", counted: 454, scheduled: 450, worked: 454, late: false },
];
const kinds = [
  { work_date: "2026-10-08", kind: "work_based", status: "pending" },
  { work_date: "2026-10-09", kind: "full_day", status: null },
];
const punches = [
  punch("a", "shift_in", "2026-09-30T09:00:00"),
  punch("b", "shift_out", "2026-09-30T17:00:00"),
  punch("c", "shift_in", "2026-10-07T09:01:00", { source: "supervisor", verification_method: "offline" }),
  punch("d", "shift_out", "2026-10-07T17:00:00"),
  punch("e", "shift_in", "2026-10-08T09:15:00", { verification_method: "kiosk" }),
  punch("f", "shift_out", "2026-10-08T14:20:00", { verification_method: "kiosk" }),
  punch("g", "shift_in", "2026-10-09T08:58:00"),
  punch("h", "shift_out", "2026-10-09T12:30:00", { is_break: true }),
  punch("i", "shift_in", "2026-10-09T13:00:00", { is_break: true }),
  punch("j", "shift_out", "2026-10-09T17:02:00"),
  punch("k", "shift_out", "2026-10-09T17:10:00", { source: "staff_edit", replaces_punch_id: "j" }),
  punch("l", "shift_in", "2026-10-10T09:04:00"),
  punch("m", "shift_in", "2026-10-12T09:00:00"),
];
const requests = [
  { type: "punch_fix", status: "pending_supervisor", dates: ["2026-10-08"], payload: { date: "2026-10-08" } },
  { type: "punch_fix", status: "approved", dates: ["2026-10-07"], payload: { date: "2026-10-07" } },
  { type: "leave", status: "pending_supervisor", dates: ["2026-10-09"], payload: {} },
];

describe("shift history rows", () => {
  const rows = historyRows({ days, results, kinds, punches, requests, today, fixDays: 7 });
  const row = (date: string) => rows.find((item) => item.date === date)!;
  const labels = (date: string) => row(date).chips.map((chip) => chip.label);

  test("newest first, up to today, future rostered days left out", () => {
    expect(rows.map((item) => item.date)).toEqual(["2026-10-12", "2026-10-10", "2026-10-09", "2026-10-08", "2026-10-07", "2026-10-06", "2026-09-30"]);
  });

  test("a past day with an open clock-in is a missing clock-out; today's open shift isn't", () => {
    expect(row("2026-10-10").missingOut).toBe(true);
    expect(labels("2026-10-10")).toContain("Missing clock-out");
    expect(row("2026-10-10").fix).toEqual({ clock_in: "09:04", replaces_in_punch_id: "l" });
    expect(row("2026-10-12").missingOut).toBe(false);
    expect(labels("2026-10-12")).toEqual([]);
  });

  test("breaks, day type, the replacement punch and the last session's fix", () => {
    const day = row("2026-10-09");
    expect(day.breaks).toHaveLength(1);
    expect(day.dayType).toBe("Full day");
    expect(day.clockOut).toBe("2026-10-09T17:10:00+09:30");
    expect(labels("2026-10-09")).toEqual(["Edited"]);
    expect(day.fix).toEqual({ clock_in: "13:00", replaces_in_punch_id: "i", clock_out: "17:10", replaces_out_punch_id: "k" });
    expect(day.counted).toBe(454);
  });

  test("chips: offline waiting, kiosk, work-based waiting, late, fix requested", () => {
    expect(labels("2026-10-07")).toEqual(["Offline · waiting"]);
    expect(labels("2026-10-08")).toEqual(["Waiting", "Kiosk", "Late", "Fix requested"]);
    expect(row("2026-10-08").dayType).toBe("Work-based");
  });

  test("a pending fix blocks a second one; the window limits how far back", () => {
    expect(row("2026-10-08").fixPending).toBe(true);
    expect(row("2026-10-08").canFix).toBe(false);
    expect(row("2026-10-07").canFix).toBe(true);
    expect(row("2026-09-30").canFix).toBe(false);
  });

  test("leave shows its status and kind", () => {
    expect(row("2026-10-06").status).toBe("leave");
    expect(row("2026-10-06").dayType).toBe("Sick leave");
    expect(row("2026-10-09").status).toBeNull();
  });

  test("months group rows with their counted total", () => {
    expect(historyMonths(rows).map((group) => [group.key, group.counted, group.rows.length])).toEqual([
      ["2026-10", 449 + 305 + 454, 6],
      ["2026-09", 450, 1],
    ]);
  });

  test("pending fix dates come from dates or the payload", () => {
    expect([...pendingFixDates([{ type: "punch_fix", status: "pending_admin", dates: null, payload: { date: "2026-10-01" } }])]).toEqual([
      "2026-10-01",
    ]);
  });
});

describe("history range", () => {
  test("this month first, then a month earlier each time, never before the start", () => {
    expect(historyFrom("2026-08-20", "2026-10-12", 1)).toBe("2026-10-01");
    expect(historyFrom("2026-08-20", "2026-10-12", 2)).toBe("2026-09-01");
    expect(historyFrom("2026-08-20", "2026-10-12", 3)).toBe("2026-08-20");
    expect(historyFrom("2026-10-05", "2026-10-12", 1)).toBe("2026-10-05");
  });
});

describe("punch fix payload from history", () => {
  const base = { date: "2026-10-10", clock_in: "09:04", clock_in_was: "09:04", replaces_in_punch_id: "l", clock_out: "", clock_out_was: "", replaces_out_punch_id: "" };

  test("an unchanged clock-in isn't sent; a new clock-out closes the open shift", () => {
    expect(buildRequestPayload("punch_fix", { ...base, clock_out: "17:00" })).toEqual({ date: "2026-10-10", clock_out: "17:00" });
  });

  test("a changed time is sent with the punch it replaces", () => {
    expect(buildRequestPayload("punch_fix", { ...base, clock_in: "09:00" })).toEqual({
      date: "2026-10-10",
      clock_in: "09:00",
      replaces_in_punch_id: "l",
    });
    expect(
      buildRequestPayload("punch_fix", { ...base, clock_out: "16:30", clock_out_was: "17:10", replaces_out_punch_id: "k" }),
    ).toEqual({ date: "2026-10-10", clock_out: "16:30", replaces_out_punch_id: "k" });
  });

  test("without punch ids (a new shift) both times are sent as before", () => {
    expect(buildRequestPayload("punch_fix", { date: "2026-10-10", clock_in: "09:00", clock_out: "17:00" })).toEqual({
      date: "2026-10-10",
      clock_in: "09:00",
      clock_out: "17:00",
    });
  });
});

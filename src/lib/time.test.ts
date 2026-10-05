import { describe, expect, test } from "vitest";
import { breakBetween, clockState, minutesOnDay, minutesSince, punchDays } from "@/lib/time";

const punch = (id: string, event_type: "shift_in" | "shift_out", occurred_at: string, is_break = false) => ({
  id,
  event_type,
  occurred_at,
  is_break,
});

describe("clockState", () => {
  test("nothing yet means not clocked in", () => {
    expect(clockState([])).toEqual({ clockedIn: false, onBreak: false, since: null });
  });

  test("the latest punch decides, whatever the order given", () => {
    const punches = [
      punch("b", "shift_out", "2026-10-13T08:00:00Z"),
      punch("c", "shift_in", "2026-10-13T23:30:00Z"),
      punch("a", "shift_in", "2026-10-13T00:00:00Z"),
    ];
    expect(clockState(punches)).toEqual({ clockedIn: true, onBreak: false, since: "2026-10-13T23:30:00Z" });
  });

  test("an auto clock-out stamped at its clock-in's instant closes the shift, in either order", () => {
    const inn = punch("a", "shift_in", "2026-10-13T00:00:00Z");
    const out = punch("b", "shift_out", "2026-10-13T00:00:00Z");
    expect(clockState([out, inn])).toEqual({ clockedIn: false, onBreak: false, since: null });
    expect(clockState([inn, out])).toEqual({ clockedIn: false, onBreak: false, since: null });
  });

  test("a clock-out marked as a break is a break for the rest of that Darwin day only", () => {
    const punches = [punch("a", "shift_in", "2026-10-13T23:30:00Z"), punch("b", "shift_out", "2026-10-14T02:30:00Z", true)];
    expect(clockState(punches, "2026-10-14")).toEqual({ clockedIn: false, onBreak: true, since: "2026-10-14T02:30:00Z" });
    expect(clockState(punches, "2026-10-15")).toEqual({ clockedIn: false, onBreak: false, since: null });
  });
});

describe("minutesSince", () => {
  test("whole minutes, never negative", () => {
    expect(minutesSince("2026-10-13T23:30:00Z", new Date("2026-10-14T00:15:59Z"))).toBe(45);
    expect(minutesSince("2026-10-14T00:30:00Z", new Date("2026-10-14T00:15:00Z"))).toBe(0);
  });
});

describe("punchDays", () => {
  test("pairs punches per Darwin day, newest day first", () => {
    const days = punchDays([
      punch("1", "shift_in", "2026-10-13T23:30:00Z"), // Wed 14 Oct 9:00 am Darwin
      punch("2", "shift_out", "2026-10-14T03:30:00Z"),
      punch("3", "shift_in", "2026-10-14T04:30:00Z"),
      punch("0", "shift_in", "2026-10-12T23:30:00Z"), // Tue 13 Oct
    ]);
    expect(days.map((day) => day.dateKey)).toEqual(["2026-10-14", "2026-10-13"]);
    expect(days[0].rows.map((row) => [row.in?.id ?? null, row.out?.id ?? null])).toEqual([
      ["1", "2"],
      ["3", null],
    ]);
  });

  test("a clock-out without a clock-in gets its own row", () => {
    const [day] = punchDays([punch("9", "shift_out", "2026-10-14T03:30:00Z")]);
    expect(day.rows).toEqual([{ id: "9", in: null, out: expect.objectContaining({ id: "9" }) }]);
  });
});

describe("breaks and today's total", () => {
  // Wed 14 Oct Darwin: 9:00–12:00, a 30-minute break, then 12:30 until now (1:00 pm).
  const punches = [
    punch("1", "shift_in", "2026-10-13T23:30:00Z"),
    punch("2", "shift_out", "2026-10-14T02:30:00Z", true),
    punch("3", "shift_in", "2026-10-14T03:00:00Z", true),
  ];

  test("the break shows between the two sessions", () => {
    const [day] = punchDays(punches);
    expect(breakBetween(day.rows[0], day.rows[1])).toBe(30);
    expect(breakBetween(day.rows[1], undefined)).toBeNull();
  });

  test("every session adds up, an open one until now", () => {
    expect(minutesOnDay(punches, "2026-10-14", new Date("2026-10-14T03:30:00Z"))).toBe(210);
    expect(minutesOnDay(punches, "2026-10-13", new Date("2026-10-14T03:30:00Z"))).toBe(0);
  });
});

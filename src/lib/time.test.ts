import { describe, expect, test } from "vitest";
import { clockState, minutesSince, punchDays } from "@/lib/time";

const punch = (id: string, event_type: "shift_in" | "shift_out", occurred_at: string) => ({ id, event_type, occurred_at });

describe("clockState", () => {
  test("nothing yet means not clocked in", () => {
    expect(clockState([])).toEqual({ clockedIn: false, since: null });
  });

  test("the latest punch decides, whatever the order given", () => {
    const punches = [
      punch("b", "shift_out", "2026-10-13T08:00:00Z"),
      punch("c", "shift_in", "2026-10-13T23:30:00Z"),
      punch("a", "shift_in", "2026-10-13T00:00:00Z"),
    ];
    expect(clockState(punches)).toEqual({ clockedIn: true, since: "2026-10-13T23:30:00Z" });
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

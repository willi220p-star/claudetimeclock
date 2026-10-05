import { describe, expect, test } from "vitest";
import { backOnTrack, pickedMinutes, presetOf, presetTimes, quickFill } from "@/lib/catch-up";

const usual = { start: "09:00", end: "17:00" };
const slots = {
  owed_minutes: 600,
  break_minutes: 30,
  usual,
  days: [
    { date: "2026-10-09", free: 2 },
    { date: "2026-10-12", free: 1 },
    { date: "2026-10-14", free: 3 },
  ],
};

describe("catch-up picker", () => {
  test("presets are the usual day, its first 4 hours or its last 4", () => {
    expect(presetTimes("full", usual)).toEqual(usual);
    expect(presetTimes("morning", usual)).toEqual({ start: "09:00", end: "13:00" });
    expect(presetTimes("afternoon", usual)).toEqual({ start: "13:00", end: "17:00" });
    expect(presetOf({ start: "13:00", end: "17:00" }, usual)).toBe("afternoon");
    expect(presetOf({ start: "10:00", end: "15:00" }, usual)).toBe("custom");
  });

  test("picked minutes use the intern's own break", () => {
    const picks = { "2026-10-09": usual, "2026-10-12": { start: "09:00", end: "13:00" } };
    expect(pickedMinutes(picks, 30)).toBe(450 + 240);
    expect(pickedMinutes(picks, 45)).toBe(435 + 240);
  });

  test("quick fill takes the earliest free days until the balance is covered", () => {
    expect(Object.keys(quickFill(slots))).toEqual(["2026-10-09", "2026-10-12"]);
    expect(quickFill({ ...slots, owed_minutes: 0 })).toEqual({});
  });

  test("back on track: the day the picks cover the balance, or none", () => {
    const picks = { "2026-10-14": usual, "2026-10-09": usual };
    expect(backOnTrack(picks, 600, 30)).toBe("2026-10-14");
    expect(backOnTrack(picks, 450, 30)).toBe("2026-10-09");
    expect(backOnTrack({ "2026-10-09": usual }, 600, 30)).toBeNull();
  });
});

describe("quick fill limit", () => {
  test("never more than 20 days in one go", () => {
    const days = Array.from({ length: 30 }, (_, index) => ({ date: `2026-11-${String(index + 1).padStart(2, "0")}`, free: 1 }));
    expect(Object.keys(quickFill({ days, owed_minutes: 100_000, usual, break_minutes: 30 }))).toHaveLength(20);
  });
});

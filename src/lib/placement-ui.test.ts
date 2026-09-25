import { describe, expect, test } from "vitest";
import {
  coversLine,
  dayCellStatus,
  forecastSeries,
  fortnightLabel,
  overtimeSteps,
  requestTimeline,
  splitEffect,
} from "@/lib/placement-ui";

describe("placement-ui", () => {
  test("splitEffect reads arrows and becomes", () => {
    expect(splitEffect("office 2/3 → 3/3")).toEqual([{ before: "office 2/3", after: "3/3" }]);
    expect(splitEffect("Tue 14 Oct becomes 9:00 am–5:00 pm")).toEqual([
      { before: "Tue 14 Oct", after: "9:00 am–5:00 pm" },
    ]);
  });

  test("requestTimeline adds admin when an extra spot is needed", () => {
    expect(requestTimeline("pending_supervisor", false).current).toBe("supervisor");
    expect(requestTimeline("pending_admin", true).steps).toContain("admin");
    expect(requestTimeline("approved", false).current).toBe("outcome");
  });

  test("overtimeSteps are 15-minute increments", () => {
    expect(overtimeSteps(45)).toEqual([15, 30, 45]);
    expect(overtimeSteps(0)).toEqual([]);
  });

  test("coversLine and dayCellStatus", () => {
    expect(coversLine(360, 450)).toBe("Covers 6h of 7h 30m owed");
    expect(dayCellStatus({ workDate: "2026-10-06", today: "2026-10-06", dayStatus: "scheduled" })).toBe("today");
    expect(dayCellStatus({ workDate: "2026-10-05", today: "2026-10-06", dayStatus: "moved" })).toBe("moved");
  });

  test("fortnightLabel is the visa self-check line", () => {
    expect(fortnightLabel("2026-09-28", "2026-10-11", 1350)).toBe(
      "This fortnight (Mon 28 Sep – Sun 11 Oct): 22h 30m counted",
    );
    expect(fortnightLabel("2026-09-28", "2026-10-11", 0)).toBe("This fortnight (Mon 28 Sep – Sun 11 Oct): 0h counted");
  });

  test("forecastSeries accumulates counted hours and projects to the forecast week", () => {
    const rows = forecastSeries({
      weeks: [
        { week_no: 1, counted: 600 },
        { week_no: 2, counted: 900 },
      ],
      targetMinutes: 6000,
      totalWeeks: 4,
      currentWeek: 2,
      forecastWeek: 5,
    });
    expect(rows.map((row) => row.week)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows.map((row) => row.counted)).toEqual([0, 10, 25, null, null, null]);
    expect(rows.map((row) => row.plan)).toEqual([0, 25, 50, 75, 100, 100]);
    expect(rows.map((row) => row.projection)).toEqual([null, null, 25, 50, 75, 100]);
  });

  test("forecastSeries draws no projection without a later forecast", () => {
    const rows = forecastSeries({ weeks: [], targetMinutes: 600, totalWeeks: 2, currentWeek: 1, forecastWeek: null });
    expect(rows.every((row) => row.projection === null)).toBe(true);
    expect(rows).toHaveLength(3);
  });
});

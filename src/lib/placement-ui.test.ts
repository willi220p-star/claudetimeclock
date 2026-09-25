import { describe, expect, test } from "vitest";
import {
  checkinAverage,
  checkinOverdue,
  coversLine,
  dayCellStatus,
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
});

describe("check-ins", () => {
  test("average to one decimal", () => {
    expect(checkinAverage({ reliability: 4, quality: 5, communication: 3 })).toBe(4);
    expect(checkinAverage({ reliability: 2, quality: 3, communication: 3 })).toBe(2.7);
  });

  test("overdue when nothing covers last week", () => {
    expect(checkinOverdue(null, "2026-10-05")).toBe(true);
    expect(checkinOverdue("2026-09-28", "2026-10-05")).toBe(true);
    expect(checkinOverdue("2026-10-05", "2026-10-05")).toBe(false);
    expect(checkinOverdue("2026-10-12", "2026-10-05")).toBe(false);
  });
});

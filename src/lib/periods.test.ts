import { describe, expect, test } from "vitest";
import {
  addDays,
  addMonths,
  monthGrid,
  monthStart,
  fortnightEnd,
  fortnightIndex,
  fortnightStart,
  mondayOf,
  totalWeeks,
  weekNo,
} from "@/lib/periods";

const ANCHOR = "2026-09-28";

describe("periods (R5.7)", () => {
  test("weeks start on Monday", () => {
    expect(mondayOf("2026-10-14")).toBe("2026-10-12");
    expect(mondayOf("2026-10-18")).toBe("2026-10-12");
    expect(mondayOf("2026-10-12")).toBe("2026-10-12");
  });

  test("fortnight index from the anchor", () => {
    expect(fortnightIndex("2026-09-28", ANCHOR)).toBe(0);
    expect(fortnightIndex("2026-10-11", ANCHOR)).toBe(0);
    expect(fortnightIndex("2026-10-12", ANCHOR)).toBe(1);
  });

  test("fortnight index uses a real floor before the anchor", () => {
    expect(fortnightIndex("2026-09-27", ANCHOR)).toBe(-1);
    expect(fortnightIndex("2026-09-14", ANCHOR)).toBe(-1);
    expect(fortnightIndex("2026-09-13", ANCHOR)).toBe(-2);
  });

  test("fortnight bounds", () => {
    expect(fortnightStart("2026-10-20", ANCHOR)).toBe("2026-10-12");
    expect(fortnightEnd("2026-10-20", ANCHOR)).toBe("2026-10-25");
    expect(fortnightStart("2026-09-20", ANCHOR)).toBe("2026-09-14");
  });

  test("placement week number and total", () => {
    expect(weekNo("2026-10-01", "2026-09-30")).toBe(1);
    expect(weekNo("2026-10-05", "2026-09-30")).toBe(2);
    expect(totalWeeks("2026-09-30", "2026-12-23")).toBe(13);
  });

  test("addDays crosses months", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("month start and addMonths cross years", () => {
    expect(monthStart("2026-10-14")).toBe("2026-10-01");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
  });

  test("month grid is Mon–Fri rows with neighbouring days blank", () => {
    const october = monthGrid("2026-10-20");
    expect(october).toHaveLength(5);
    expect(october[0]).toEqual([null, null, null, "2026-10-01", "2026-10-02"]);
    expect(october[4]).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
  });

  test("month grid drops a week that only holds a weekend of the month", () => {
    // 1 Aug 2026 is a Saturday; 31 Aug is a Monday.
    const august = monthGrid("2026-08-01");
    expect(august[0][0]).toBe("2026-08-03");
    expect(august.at(-1)).toEqual(["2026-08-31", null, null, null, null]);
    expect(august.flat().filter(Boolean)).toHaveLength(21);
  });
});

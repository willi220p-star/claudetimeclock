import { describe, expect, test } from "vitest";
import {
  addDays,
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
});

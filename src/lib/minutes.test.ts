import { describe, expect, test } from "vitest";
import { formatMinutes, plannedMinutes } from "@/lib/minutes";

describe("formatMinutes", () => {
  test.each([
    [450, "7h 30m"],
    [480, "8h"],
    [45, "45m"],
    [0, "0h"],
    [-90, "1h 30m ahead"],
    [-45, "45m ahead"],
    [1395, "23h 15m"],
  ])("%i → %s", (minutes, text) => {
    expect(formatMinutes(minutes)).toBe(text);
  });

  test("rejects fractional minutes", () => {
    expect(() => formatMinutes(1.5)).toThrow();
  });
});

describe("plannedMinutes (R5.2.4)", () => {
  test("no break at exactly 300 minutes", () => {
    expect(plannedMinutes("09:00", "14:00")).toBe(300);
  });
  test("30-minute break over 300 minutes", () => {
    expect(plannedMinutes("09:00", "14:15")).toBe(285);
    expect(plannedMinutes("09:00:00", "17:00:00")).toBe(450);
  });
  test("short day has no break", () => {
    expect(plannedMinutes("09:00", "12:00")).toBe(180);
  });
});

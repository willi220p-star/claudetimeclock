import { describe, expect, test } from "vitest";
import {
  darwinAt,
  darwinDateKey,
  formatDate,
  formatDay,
  formatDayTime,
  formatTime,
  formatTimeOfDay,
  relativeOrDate,
} from "@/lib/darwin";

describe("Darwin time", () => {
  test("a UTC evening instant is already tomorrow in Darwin", () => {
    expect(darwinDateKey("2026-10-13T14:30:00Z")).toBe("2026-10-14");
    expect(darwinDateKey("2026-10-13T14:29:59Z")).toBe("2026-10-13");
  });

  test("formats a full date with the year", () => {
    expect(formatDate("2026-10-13T15:00:00Z")).toBe("14 Oct 2026");
  });

  test("formats a date key as EEE d MMM", () => {
    expect(formatDay("2026-10-14")).toBe("Wed 14 Oct");
  });

  test("formats an instant as a Darwin day", () => {
    expect(formatDay("2026-10-13T15:00:00Z")).toBe("Wed 14 Oct");
  });

  test("formats a Darwin clock time with lower-case am/pm", () => {
    expect(formatTime("2026-10-13T23:30:00Z")).toBe("9:00 am");
    expect(formatTime("2026-10-14T06:30:00Z")).toBe("4:00 pm");
  });

  test("formats a time of day from the database", () => {
    expect(formatTimeOfDay("09:00:00")).toBe("9:00 am");
    expect(formatTimeOfDay("13:30")).toBe("1:30 pm");
    expect(formatTimeOfDay("12:00:00")).toBe("12:00 pm");
  });

  test("formats day and time together", () => {
    expect(formatDayTime("2026-10-13T23:30:00Z")).toBe("Wed 14 Oct, 9:00 am");
  });

  test("darwinAt turns a Darwin wall time into an instant", () => {
    expect(darwinAt("2026-10-14", "09:00").toISOString()).toBe("2026-10-13T23:30:00.000Z");
  });

  test("relative time up to 6 days, then a date", () => {
    const now = new Date("2026-10-14T00:00:00Z");
    expect(relativeOrDate("2026-10-13T23:59:40Z", now)).toBe("just now");
    expect(relativeOrDate("2026-10-13T23:35:00Z", now)).toBe("25 min ago");
    expect(relativeOrDate("2026-10-13T21:00:00Z", now)).toBe("3 h ago");
    expect(relativeOrDate("2026-10-12T23:00:00Z", now)).toBe("1 day ago");
    expect(relativeOrDate("2026-10-08T01:00:00Z", now)).toBe("5 days ago");
    expect(relativeOrDate("2026-10-07T00:00:00Z", now)).toBe("Wed 7 Oct");
  });
});

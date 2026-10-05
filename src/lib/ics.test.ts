import { describe, expect, test } from "vitest";
import { rosterIcs } from "@/lib/ics";

describe("rosterIcs", () => {
  test("one event per day, Darwin times in UTC, the place escaped", () => {
    const file = rosterIcs(
      [{ work_date: "2026-10-12", start_time: "09:00:00", end_time: "17:00:00" }],
      "Regus, Palmerston; Level 1",
      new Date("2026-10-05T00:00:00Z"),
    );
    expect(file.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(file).toContain("DTSTART:20261011T233000Z\r\nDTEND:20261012T073000Z\r\n");
    expect(file).toContain("UID:2026-10-12-0900@dgk-clock");
    expect(file).toContain("DTSTAMP:20261005T000000Z");
    expect(file).toContain("LOCATION:Regus\\, Palmerston\\; Level 1");
    expect(file.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(file.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

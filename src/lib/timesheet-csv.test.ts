import { describe, expect, test } from "vitest";
import { exportCsv, type ExportRow } from "@/lib/timesheet-csv";

function row(over: Partial<ExportRow>): ExportRow {
  return {
    intern_name: "Ava Lee",
    placement_id: "p1",
    week_start: "2026-09-28",
    work_date: "2026-09-29",
    counted_minutes: 450,
    break_minutes: 30,
    paid: true,
    hourly_rate: 25,
    amount: 187.5,
    ...over,
  };
}

describe("exportCsv", () => {
  test("header, 2-decimal hours, CRLF and a totals row per intern", () => {
    const csv = exportCsv([
      row({}),
      row({ work_date: "2026-09-30", counted_minutes: 20, amount: 8.33 }),
      row({ intern_name: "Ben Ng", paid: false, hourly_rate: null, amount: null, counted_minutes: 480 }),
    ]);
    expect(csv.split("\r\n")).toEqual([
      "Intern,Week starting,Date,Hours,Break (min),Paid,Hourly rate,Amount",
      "Ava Lee,2026-09-28,2026-09-29,7.50,30,Yes,25.00,187.50",
      "Ava Lee,2026-09-28,2026-09-30,0.33,30,Yes,25.00,8.33",
      "Ava Lee total,,,7.83,60,,,195.83",
      "Ben Ng,2026-09-28,2026-09-29,8.00,30,No,,",
      "Ben Ng total,,,8.00,30,,,",
      "",
    ]);
  });

  test("quotes commas and quotes, and defuses formulas", () => {
    const csv = exportCsv([row({ intern_name: 'Lee, "AJ"' }), row({ intern_name: "=HYPERLINK(1)", paid: false, amount: null })]);
    expect(csv).toContain('"Lee, ""AJ""",2026-09-28');
    expect(csv).toContain('"Lee, ""AJ"" total",,,7.50');
    expect(csv).toContain("'=HYPERLINK(1),2026-09-28,2026-09-29,7.50,30,No,,\r\n");
  });

  test("no rows is just the header", () => {
    expect(exportCsv([])).toBe("Intern,Week starting,Date,Hours,Break (min),Paid,Hourly rate,Amount\r\n");
  });
});

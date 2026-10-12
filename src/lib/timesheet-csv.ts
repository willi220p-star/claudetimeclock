import type { Database } from "@/lib/database.types";

export type ExportRow = Database["public"]["Functions"]["signoff_export"]["Returns"][number];

const HEADER = ["Intern", "Week starting", "Date", "Hours", "Break (min)", "Paid", "Hourly rate", "Amount"];

/** RFC 4180 cell; a leading = + - @ (or tab/CR) gets a ' so spreadsheets never run it as a formula. */
function cell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const money = (value: number | null) => (value === null ? "" : value.toFixed(2));
const hours = (minutes: number) => (minutes / 60).toFixed(2);

/**
 * The signed-hours export (D43): one line per signed day, then a totals line per intern.
 * Rows arrive ordered by intern then date (signoff_export), so an intern's days are consecutive.
 */
export function exportCsv(rows: ExportRow[]) {
  const lines = [HEADER];
  rows.forEach((row, index) => {
    lines.push([
      row.intern_name,
      row.week_start,
      row.work_date,
      hours(row.counted_minutes),
      String(row.break_minutes),
      row.paid ? "Yes" : "No",
      money(row.paid ? row.hourly_rate : null),
      money(row.amount),
    ]);
    if (rows[index + 1]?.intern_name === row.intern_name) return;
    const mine = rows.filter((other) => other.intern_name === row.intern_name);
    const amounts = mine.filter((other) => other.amount !== null);
    lines.push([
      `${row.intern_name} total`,
      "",
      "",
      hours(mine.reduce((sum, other) => sum + other.counted_minutes, 0)),
      String(mine.reduce((sum, other) => sum + other.break_minutes, 0)),
      "",
      "",
      // Sum in cents so 0.1 + 0.2 stays 0.30.
      amounts.length ? money(amounts.reduce((sum, other) => sum + Math.round((other.amount ?? 0) * 100), 0) / 100) : "",
    ]);
  });
  return lines.map((line) => line.map(cell).join(",")).join("\r\n") + "\r\n";
}

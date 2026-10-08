// Rows for the Progress charts (intern, supervisor, admin). Pure functions so Vitest covers them;
// the pages only load data and draw. Minutes stay integers; charts plot hours to one decimal.
import { addDays } from "@/lib/periods";
import { punchDays } from "@/lib/time";
import type { EventType } from "@/lib/daymark";
import { formatTime } from "@/lib/darwin";
import { REQUEST_STATUS_LABEL, type ProgressRow } from "@/lib/placement-ui";

export const hoursOf = (minutes: number) => Math.round(minutes / 6) / 10;

/** private.pct: a whole-number percentage, null when there is nothing to divide by. */
export function pct(part: number, whole: number) {
  return whole === 0 ? null : Math.round((100 * part) / whole);
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Timed = { id: string; event_type: EventType; occurred_at: string; is_break?: boolean | null };

export type Session = { id: string; start: string | null; end: string | null; minutes: number };
export type WeekDay = { date: string; label: string; minutes: number; hours: number; counted: number | null; sessions: Session[] };

/**
 * "The intern's total time this week, per day and per shift": clocked time from punches, Monday
 * to Sunday, each clock-in/clock-out pair a session (an open one runs until `now`). `counted` is the
 * day's result once the day has closed. Matches minutesOnDay.
 */
export function weekByDay(
  punches: Timed[],
  weekStart: string,
  now: Date,
  results: { work_date: string; counted: number | null }[] = [],
) {
  const byDate = new Map(punchDays(punches).map((day) => [day.dateKey, day.rows]));
  const days: WeekDay[] = WEEKDAYS.map((label, index) => {
    const date = addDays(weekStart, index);
    const sessions = (byDate.get(date) ?? []).map((row) => {
      const start = row.in?.occurred_at ?? null;
      const end = row.out?.occurred_at ?? null;
      const until = end ? Date.parse(end) : now.getTime();
      const minutes = start ? Math.max(0, Math.floor((until - Date.parse(start)) / 60_000)) : 0;
      return { id: row.id, start, end, minutes };
    });
    const minutes = sessions.reduce((sum, session) => sum + session.minutes, 0);
    const result = results.find((row) => row.work_date === date);
    return { date, label, minutes, hours: hoursOf(minutes), counted: result?.counted ?? null, sessions };
  });
  return { days, total: days.reduce((sum, day) => sum + day.minutes, 0) };
}

/** "9:02 am – 12:30 pm" for a session; an open one ends "now", an unpaired clock-out says so. */
export function sessionSpan(session: Session) {
  const from = session.start ? formatTime(session.start) : "no clock-in";
  const to = session.end ? formatTime(session.end) : session.start ? "now" : "?";
  return `${from} – ${to}`;
}

/** Weekly counted vs rostered hours, one row per placement week. */
export function weeklyBars(weeks: { week_no: number | null; counted: number | null; scheduled: number | null }[]) {
  return weeks.map((week) => ({
    label: `W${week.week_no ?? "?"}`,
    counted: hoursOf(week.counted ?? 0),
    rostered: hoursOf(week.scheduled ?? 0),
  }));
}

type DayRow = { work_date: string; status: string; leave_kind: string | null };
type ResultRow = { work_date: string; counted: number | null; no_show: boolean | null };

/**
 * Attendance breakdown in days. Absent = a no-show, or leave marked 'absent' (ready for that kind;
 * today leave is sick or personal). Leave = any other leave. Moved = a day swapped to another date.
 */
export function attendanceBreakdown(days: DayRow[], results: ResultRow[]) {
  const absentLeave = days.filter((day) => day.status === "leave" && day.leave_kind === "absent").length;
  return [
    { key: "worked", label: "Worked", days: results.filter((row) => (row.counted ?? 0) > 0).length },
    { key: "absent", label: "Absent", days: results.filter((row) => row.no_show).length + absentLeave },
    { key: "leave", label: "Leave", days: days.filter((day) => day.status === "leave").length - absentLeave },
    { key: "moved", label: "Moved", days: days.filter((day) => day.status === "moved").length },
  ];
}

/** private.attendance over closed rostered days: attended = not a no-show; on time = attended and not late. */
export function attendanceRates(results: { scheduled: number | null; closed: boolean | null; no_show: boolean | null; late: boolean | null }[]) {
  const due = results.filter((row) => (row.scheduled ?? 0) > 0 && row.closed);
  const attended = due.filter((row) => !row.no_show);
  return {
    attendancePct: pct(attended.length, due.length),
    onTimePct: pct(attended.filter((row) => !row.late).length, attended.length),
  };
}

/** Counted minutes from day results and rostered minutes (scheduled + leave, as kpi_intern does) in [from, to]. */
export function periodHours(
  results: { work_date: string; counted: number | null }[],
  days: { work_date: string; status: string; planned_minutes: number | null }[],
  from: string,
  to: string,
) {
  const inside = (date: string) => date >= from && date <= to;
  return {
    counted: results.filter((row) => inside(row.work_date)).reduce((sum, row) => sum + (row.counted ?? 0), 0),
    rostered: days
      .filter((day) => inside(day.work_date) && (day.status === "scheduled" || day.status === "leave"))
      .reduce((sum, day) => sum + (day.planned_minutes ?? 0), 0),
  };
}

const LIVE = new Set(["active", "extended", "target_reached"]);

/** Live placements' counted share of target, furthest along first. */
export function progressToTarget(rows: ProgressRow[]) {
  return rows
    .filter((row) => LIVE.has(row.status))
    .map((row) => ({
      id: row.placement_id,
      label: row.intern_name,
      pct: Math.min(100, pct(row.counted_total, row.target_minutes) ?? 0),
      counted: row.counted_total,
      target: row.target_minutes,
    }))
    .sort((a, b) => b.pct - a.pct || a.label.localeCompare(b.label));
}

/** Interns who owe hours, most owed first. */
export function owedRanking(rows: Pick<ProgressRow, "placement_id" | "intern_name" | "owed">[]) {
  return rows
    .filter((row) => row.owed > 0)
    .map((row) => ({ id: row.placement_id, label: row.intern_name, owed: row.owed, hours: hoursOf(row.owed) }))
    .sort((a, b) => b.owed - a.owed || a.label.localeCompare(b.label));
}

const STATUS_ORDER = ["pending_supervisor", "pending_admin", "approved", "declined", "cancelled"];
export const AGE_BUCKETS = [
  { label: "Under 1 day", maxHours: 24 },
  { label: "1–2 days", maxHours: 48 },
  { label: "2–7 days", maxHours: 168 },
  { label: "Over 7 days", maxHours: Infinity },
];

/** Requests by status, and how long the waiting ones have waited. */
export function requestStats(requests: { status: string; created_at: string }[], now: Date) {
  const byStatus = STATUS_ORDER.map((status) => ({
    key: status,
    label: REQUEST_STATUS_LABEL[status] ?? status,
    count: requests.filter((row) => row.status === status).length,
  }));
  const waiting = requests.filter((row) => row.status === "pending_supervisor" || row.status === "pending_admin");
  const ages = waiting.map((row) => (now.getTime() - Date.parse(row.created_at)) / 3_600_000);
  const byAge = AGE_BUCKETS.map((bucket, index) => ({
    label: bucket.label,
    count: ages.filter((age) => age < bucket.maxHours && (index === 0 || age >= AGE_BUCKETS[index - 1].maxHours)).length,
  }));
  return { byStatus, byAge };
}

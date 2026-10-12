// Shift history (D46): every day since the placement started, newest first, grouped by month.
// Pure, so Vitest covers it; the screen only formats what this returns.
import type { DayStatus } from "@/components/day-status-badge";
import type { Tone } from "@/components/status-chip";
import { darwinClock } from "@/lib/darwin";
import type { EventType } from "@/lib/daymark";
import { addDays, addMonths, monthStart } from "@/lib/periods";
import { dayCellStatus } from "@/lib/placement-ui";
import { dayTimes, profileDays } from "@/lib/profile-stats";

type DayRow = { work_date: string; status: string; leave_kind: string | null };
type ResultRow = { work_date: string; counted: number; scheduled: number; worked: number; late: boolean; no_show?: boolean };
type KindRow = { work_date: string; kind: string; status: string | null };
type PunchRow = {
  id: string;
  event_type: EventType;
  occurred_at: string;
  is_break?: boolean | null;
  source: string;
  confirmed_at: string | null;
  verification_method?: string | null;
  replaces_punch_id: string | null;
};
type RequestRow = { type: string; status: string; dates?: string[] | null; payload?: unknown };

export type HistoryChip = { label: string; tone: Tone };
/** What a punch fix for the day starts from: the day's last session, as "HH:mm" and punch ids. */
export type HistoryFix = { clock_in?: string; clock_out?: string; replaces_in_punch_id?: string; replaces_out_punch_id?: string };

export type HistoryRow = {
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  missingOut: boolean;
  breaks: { start: string; end: string | null }[];
  dayType: string | null;
  counted: number | null;
  /** Absent, leave, moved, no-show or cancelled; null for an ordinary day. */
  status: DayStatus | null;
  chips: HistoryChip[];
  fixPending: boolean;
  canFix: boolean;
  fix: HistoryFix;
};

const PENDING = new Set(["pending_supervisor", "pending_admin"]);
const QUIET: DayStatus[] = ["worked", "scheduled", "today", "closure"];

/** Dates that already have a punch fix waiting, so a second one isn't sent. */
export function pendingFixDates(requests: RequestRow[]) {
  const dates = new Set<string>();
  for (const row of requests) {
    if (row.type !== "punch_fix" || !PENDING.has(row.status)) continue;
    for (const date of row.dates ?? []) dates.add(date);
    const payload = row.payload as { date?: unknown } | null | undefined;
    if (typeof payload?.date === "string") dates.add(payload.date);
  }
  return dates;
}

/** The first date to load when `months` months are shown (this month is 1), never before the start. */
export function historyFrom(startDate: string, today: string, months: number) {
  const from = addMonths(monthStart(today), -(months - 1));
  return from < startDate ? startDate : from;
}

export function historyRows(args: {
  days: DayRow[];
  results: ResultRow[];
  kinds: KindRow[];
  punches: PunchRow[];
  requests: RequestRow[];
  today: string;
  /** How far back a punch fix can go (settings.punch_fix_days). */
  fixDays: number;
}): HistoryRow[] {
  const pending = pendingFixDates(args.requests);
  return profileDays(args).map((day) => {
    const times = dayTimes(day.rows);
    const live = day.rows.flatMap((row) => [row.in, row.out]); // profileDays already dropped replaced punches
    // ponytail: a fix targets the day's last session (the one that ends the day); earlier sessions
    // on a day with breaks are fixed from Requests with a plain punch fix.
    const last = day.rows.at(-1);
    // A past day whose last session never closed, or whose break never ended.
    const missingOut = day.date < args.today && Boolean((last?.in && !last.out) || last?.out?.is_break);
    const fixPending = pending.has(day.date);
    const status = dayCellStatus({
      workDate: day.date,
      today: args.today,
      dayStatus: day.day?.status,
      leaveKind: day.day?.leave_kind,
      counted: day.result?.counted,
      noShow: day.result?.no_show,
    });
    const chips: HistoryChip[] = [];
    if (missingOut) chips.push({ label: "Missing clock-out", tone: "bad" });
    if (live.some((punch) => punch?.source === "auto_close")) chips.push({ label: "Auto-closed", tone: "warn" });
    if (day.waiting) chips.push({ label: day.waiting, tone: "warn" });
    if (day.kind?.kind === "work_based" && day.kind.status === "pending") chips.push({ label: "Waiting", tone: "warn" });
    if (day.kind?.kind === "work_based" && day.kind.status === "declined") chips.push({ label: "Work-based declined", tone: "bad" });
    if (live.some((punch) => punch?.verification_method === "kiosk")) chips.push({ label: "Kiosk", tone: "neutral" });
    if (day.edited) chips.push({ label: "Edited", tone: "neutral" });
    if (day.late) chips.push({ label: "Late", tone: "warn" });
    if (fixPending) chips.push({ label: "Fix requested", tone: "info" });

    const fix: HistoryFix = {};
    if (last?.in) Object.assign(fix, { clock_in: darwinClock(last.in.occurred_at), replaces_in_punch_id: last.in.id });
    if (last?.out) Object.assign(fix, { clock_out: darwinClock(last.out.occurred_at), replaces_out_punch_id: last.out.id });

    return {
      date: day.date,
      clockIn: times.clockIn?.occurred_at ?? null,
      clockOut: times.clockOut?.occurred_at ?? null,
      missingOut,
      breaks: times.breaks.map((item) => ({ start: item.start.occurred_at, end: item.end?.occurred_at ?? null })),
      dayType:
        day.day?.status === "leave" && day.day.leave_kind !== "absent"
          ? day.day.leave_kind === "sick"
            ? "Sick leave"
            : "Personal leave"
          : day.kind?.kind === "work_based"
            ? "Work-based"
            : day.kind?.kind === "full_day"
              ? "Full day"
              : null,
      counted: day.result ? day.result.counted : null,
      status: QUIET.includes(status) ? null : status,
      chips,
      fixPending,
      canFix: !fixPending && day.date <= args.today && day.date >= addDays(args.today, -args.fixDays),
      fix,
    };
  });
}

/** Rows by calendar month ("2026-10"), newest first, with the month's counted minutes. */
export function historyMonths(rows: HistoryRow[]) {
  const months = new Map<string, HistoryRow[]>();
  for (const row of rows) {
    const key = row.date.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), row]);
  }
  return [...months.entries()].map(([key, list]) => ({
    key,
    counted: list.reduce((total, row) => total + (row.counted ?? 0), 0),
    rows: list,
  }));
}

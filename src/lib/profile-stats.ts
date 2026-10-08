// The intern profile's timesheet and summary tiles (Dilip, 8 Oct). Pure, so it is tested in isolation.
import { darwinDateKey } from "@/lib/darwin";
import type { EventType } from "@/lib/daymark";
import { mondayOf } from "@/lib/periods";
import { breakBetween, punchDays, type ShiftRow } from "@/lib/time";

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
  replaces_punch_id: string | null;
};

export type ProfileFilter = "all" | "worked" | "absent" | "moved" | "late";

export type ProfileDay<P extends PunchRow> = {
  date: string;
  day: DayRow | null;
  result: ResultRow | null;
  kind: KindRow | null;
  rows: ShiftRow<P>[];
  came: boolean;
  absent: boolean;
  moved: boolean;
  late: boolean;
  edited: boolean;
  typedIn: boolean;
};

/**
 * One entry per day up to today that was rostered, has a result or has punches, newest first.
 * Punches a punch fix or staff edit replaced are dropped; the replacement shows instead.
 */
export function profileDays<P extends PunchRow>(args: {
  days: DayRow[];
  results: ResultRow[];
  kinds: KindRow[];
  punches: P[];
  today: string;
}): ProfileDay<P>[] {
  const replaced = new Set(args.punches.map((punch) => punch.replaces_punch_id).filter(Boolean));
  const live = args.punches.filter((punch) => !replaced.has(punch.id));
  const sessions = new Map(punchDays(live).map((day) => [day.dateKey, day.rows]));
  const dayPunches = (date: string) => live.filter((punch) => darwinDateKey(punch.occurred_at) === date);
  const dates = new Set([...args.days.map((d) => d.work_date), ...args.results.map((r) => r.work_date), ...sessions.keys()]);
  return [...dates]
    .filter((date) => date <= args.today)
    .sort((a, b) => (a < b ? 1 : -1))
    .map((date) => {
      const day = args.days.find((d) => d.work_date === date) ?? null;
      const result = args.results.find((r) => r.work_date === date) ?? null;
      const rows = sessions.get(date) ?? [];
      const punches = dayPunches(date);
      return {
        date,
        day,
        result,
        kind: args.kinds.find((k) => k.work_date === date) ?? null,
        rows,
        came: rows.some((row) => row.in) || (result?.worked ?? 0) > 0 || (result?.counted ?? 0) > 0,
        absent: day?.status === "leave" && day.leave_kind === "absent",
        moved: day?.status === "moved",
        late: result?.late ?? false,
        edited: punches.some((punch) => punch.source === "staff_edit"),
        typedIn: punches.some((punch) => punch.source === "supervisor" && !punch.confirmed_at),
      };
    });
}

/** Clock-in, breaks, clock-out and each session's length for one day's sessions. */
export function dayTimes<P extends PunchRow>(rows: ShiftRow<P>[]) {
  return {
    clockIn: rows.find((row) => row.in && !row.in.is_break)?.in ?? null,
    clockOut: [...rows].reverse().find((row) => row.out && !row.out.is_break)?.out ?? null,
    breaks: rows.flatMap((row, index) =>
      row.out?.is_break ? [{ start: row.out, end: rows[index + 1]?.in ?? null, minutes: breakBetween(row, rows[index + 1]) }] : [],
    ),
    sessions: rows.map((row) =>
      row.in && row.out ? Math.max(0, Math.floor((Date.parse(row.out.occurred_at) - Date.parse(row.in.occurred_at)) / 60_000)) : null,
    ),
  };
}

/**
 * Summary tiles. A week (Monday to Sunday) meets its hours when counted ≥ scheduled; weeks with
 * nothing scheduled don't count, and this week only counts once it is met (it is still running).
 */
export function profileSummary(list: ProfileDay<PunchRow>[], results: ResultRow[], today: string) {
  const weeks = new Map<string, { counted: number; scheduled: number }>();
  for (const row of results) {
    const week = mondayOf(row.work_date);
    const sum = weeks.get(week) ?? { counted: 0, scheduled: 0 };
    sum.counted += row.counted;
    sum.scheduled += row.scheduled;
    weeks.set(week, sum);
  }
  const current = mondayOf(today);
  let met = 0;
  let missed = 0;
  for (const [week, sum] of weeks) {
    if (week > current || sum.scheduled === 0) continue;
    if (sum.counted >= sum.scheduled) met += 1;
    else if (week < current) missed += 1;
  }
  return {
    worked: list.filter((day) => day.came).length,
    absent: list.filter((day) => day.absent).length,
    moved: list.filter((day) => day.moved).length,
    late: list.filter((day) => day.late).length,
    weeksMet: met,
    weeksMissed: missed,
    thisWeek: weeks.get(current) ?? { counted: 0, scheduled: 0 },
  };
}

/** The timesheet filter and the from/to range ("" means open-ended). */
export function filterDays<D extends ProfileDay<PunchRow>>(list: D[], filter: ProfileFilter, from: string, to: string) {
  return list.filter(
    (day) =>
      (!from || day.date >= from) &&
      (!to || day.date <= to) &&
      (filter === "all" ||
        (filter === "worked" && day.came) ||
        (filter === "absent" && day.absent) ||
        (filter === "moved" && day.moved) ||
        (filter === "late" && day.late)),
  );
}

import { darwinDateKey } from "@/lib/darwin";
import type { EventType } from "@/lib/daymark";

type Timed = { id: string; event_type: EventType; occurred_at: string; is_break?: boolean | null };

// At the same instant a clock-in comes before its clock-out (an auto-close is stamped at the clock-in, D3).
const oldestFirst = (a: Timed, b: Timed) =>
  Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || Number(a.event_type !== "shift_in") - Number(b.event_type !== "shift_in");

/**
 * R5.1.5: the latest punch decides. A clock-out marked as a break is "on a break" for the rest of
 * that Darwin day (5 Oct); a break never ended by the next day just counts as clocked out.
 */
export function clockState(punches: Timed[], todayKey?: string) {
  const latest = [...punches].sort(oldestFirst).at(-1);
  if (latest?.event_type === "shift_in") return { clockedIn: true as const, onBreak: false, since: latest.occurred_at };
  if (latest?.is_break && (!todayKey || darwinDateKey(latest.occurred_at) === todayKey)) {
    return { clockedIn: false as const, onBreak: true, since: latest.occurred_at };
  }
  return { clockedIn: false as const, onBreak: false, since: null };
}

/** Whole minutes from an instant until now, never negative. Display only. */
export function minutesSince(from: string, now: Date) {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(from)) / 60_000));
}

export type ShiftRow<T extends Timed> = { id: string; in: T | null; out: T | null };
export type PunchDay<T extends Timed> = { dateKey: string; rows: ShiftRow<T>[] };

/** Punches grouped by Darwin day (newest day first), each day paired into clock-in/clock-out rows. */
export function punchDays<T extends Timed>(punches: T[]): PunchDay<T>[] {
  const days = new Map<string, ShiftRow<T>[]>();
  for (const punch of [...punches].sort(oldestFirst)) {
    const key = darwinDateKey(punch.occurred_at);
    const rows = days.get(key) ?? [];
    days.set(key, rows);
    const last = rows.at(-1);
    if (punch.event_type === "shift_out" && last && !last.out) last.out = punch;
    else rows.push(punch.event_type === "shift_in" ? { id: punch.id, in: punch, out: null } : { id: punch.id, in: null, out: punch });
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([dateKey, rows]) => ({ dateKey, rows }));
}

/** Minutes of a break between two sessions: from a clock-out marked as a break to the next clock-in. */
export function breakBetween<T extends Timed>(row: ShiftRow<T>, next: ShiftRow<T> | undefined) {
  if (!row.out?.is_break || !next?.in) return null;
  return Math.max(0, Math.floor((Date.parse(next.in.occurred_at) - Date.parse(row.out.occurred_at)) / 60_000));
}

/** Time clocked on a Darwin day, every session added up (an open one runs until now). Display only. */
export function minutesOnDay(punches: Timed[], dateKey: string, now: Date) {
  const day = punchDays(punches).find((item) => item.dateKey === dateKey);
  return (day?.rows ?? []).reduce((total, row) => {
    if (!row.in) return total;
    const end = row.out ? Date.parse(row.out.occurred_at) : now.getTime();
    return total + Math.max(0, Math.floor((end - Date.parse(row.in.occurred_at)) / 60_000));
  }, 0);
}

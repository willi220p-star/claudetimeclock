import { darwinDateKey } from "@/lib/darwin";
import type { EventType } from "@/lib/daymark";

type Timed = { id: string; event_type: EventType; occurred_at: string };

// At the same instant a clock-in comes before its clock-out (an auto-close is stamped at the clock-in, D3).
const oldestFirst = (a: Timed, b: Timed) =>
  Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || Number(a.event_type !== "shift_in") - Number(b.event_type !== "shift_in");

/** R5.1.5: the latest punch decides whether the intern is clocked in. */
export function clockState(punches: Timed[]) {
  const latest = [...punches].sort(oldestFirst).at(-1);
  return latest?.event_type === "shift_in"
    ? { clockedIn: true as const, since: latest.occurred_at }
    : { clockedIn: false as const, since: null };
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

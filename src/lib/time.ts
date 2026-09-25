import type { EventType, Punch, ShiftStatus } from "@/lib/daymark";

type PunchLike = Pick<Punch, "event_type" | "occurred_at">;

export type TimeSummary = {
  status: ShiftStatus;
  todayWorked: number;
  todayBreak: number;
  shiftWorked: number;
  shiftBreak: number;
};

export function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function summarize(punches: PunchLike[], nowMs: number): TimeSummary {
  const sorted = [...punches].sort(
    (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at),
  );

  const work: Array<[number, number]> = [];
  const breaks: Array<[number, number]> = [];
  let status: ShiftStatus = "off";
  let shiftStart: number | null = null;
  let cursor: number | null = null;
  let breakStart: number | null = null;
  let latestShiftStart = -1;

  for (const punch of sorted) {
    const at = Date.parse(punch.occurred_at);
    if (Number.isNaN(at)) continue;
    applyEvent(punch.event_type, at);
  }

  if (cursor !== null) work.push([cursor, nowMs]);
  if (breakStart !== null) breaks.push([breakStart, nowMs]);

  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  const dayStart = start.getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  return {
    status,
    todayWorked: covered(work, dayStart, dayEnd),
    todayBreak: covered(breaks, dayStart, dayEnd),
    shiftWorked: latestShiftStart < 0 ? 0 : covered(work, latestShiftStart, nowMs + 1),
    shiftBreak: latestShiftStart < 0 ? 0 : covered(breaks, latestShiftStart, nowMs + 1),
  };

  function applyEvent(event: EventType, at: number) {
    if (event === "shift_in") {
      shiftStart = at;
      latestShiftStart = at;
      cursor = at;
      breakStart = null;
      status = "on_shift";
      return;
    }

    if (event === "break_in" && cursor !== null && shiftStart !== null) {
      work.push([cursor, at]);
      cursor = null;
      breakStart = at;
      status = "on_break";
      return;
    }

    if (event === "break_out" && breakStart !== null && shiftStart !== null) {
      breaks.push([breakStart, at]);
      breakStart = null;
      cursor = at;
      status = "on_shift";
      return;
    }

    if (event === "shift_out" && shiftStart !== null) {
      if (cursor !== null) work.push([cursor, at]);
      if (breakStart !== null) breaks.push([breakStart, at]);
      cursor = null;
      breakStart = null;
      shiftStart = null;
      status = "off";
    }
  }
}

function covered(ranges: Array<[number, number]>, from: number, to: number) {
  return ranges.reduce((sum, [start, end]) => {
    return sum + Math.max(0, Math.min(end, to) - Math.max(start, from));
  }, 0);
}

export function visiblePunches<T extends PunchLike & { id: string }>(punches: T[], now: Date) {
  const sorted = [...punches].sort(
    (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at),
  );
  const today = sorted.filter((punch) => sameLocalDay(punch.occurred_at, now));

  let shiftIndex = -1;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (sorted[index].event_type === "shift_in") {
      shiftIndex = index;
      break;
    }
  }

  if (shiftIndex === -1) return today.reverse();

  const shift = sorted.slice(shiftIndex);
  const closed = shift.some((punch) => punch.event_type === "shift_out");
  if (closed) return today.reverse();

  const ids = new Set([...today, ...shift].map((punch) => punch.id));
  return sorted.filter((punch) => ids.has(punch.id)).reverse();
}

function sameLocalDay(iso: string, now: Date) {
  const date = new Date(iso);
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

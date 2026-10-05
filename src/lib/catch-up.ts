import { plannedMinutes } from "@/lib/minutes";
import type { CatchUpSlots } from "@/lib/placement-ui";

// Catch-up picker (Dilip, 5 Oct): the intern picks free office days themselves; each picked day
// becomes an extra-day request for their supervisor. Pure helpers, so they're easy to test.

export type Times = { start: string; end: string };
export type Picks = Record<string, Times>;
export type Preset = "full" | "morning" | "afternoon" | "custom";

const toMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};
const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Full day = the intern's usual times; morning and afternoon are the first and last 4 hours of it. */
export function presetTimes(preset: Exclude<Preset, "custom">, usual: Times): Times {
  const start = toMinutes(usual.start);
  const end = toMinutes(usual.end);
  if (preset === "morning") return { start: usual.start, end: toTime(Math.min(start + 240, end)) };
  if (preset === "afternoon") return { start: toTime(Math.max(end - 240, start)), end: usual.end };
  return usual;
}

export function presetOf(times: Times, usual: Times): Preset {
  for (const preset of ["full", "morning", "afternoon"] as const) {
    const candidate = presetTimes(preset, usual);
    if (candidate.start === times.start && candidate.end === times.end) return preset;
  }
  return "custom";
}

/** Minutes the picked days would plan, with the intern's own break. */
export function pickedMinutes(picks: Picks, breakMinutes: number) {
  return Object.values(picks).reduce((total, times) => total + Math.max(0, plannedMinutes(times.start, times.end, breakMinutes)), 0);
}

/** The server takes at most 20 days in one go. */
export const MAX_DAYS = 20;

/** Quick fill: the earliest free days at the usual times until the balance is covered (20 at most). */
export function quickFill(slots: Pick<CatchUpSlots, "days" | "owed_minutes" | "usual" | "break_minutes">): Picks {
  const picks: Picks = {};
  const perDay = plannedMinutes(slots.usual.start, slots.usual.end, slots.break_minutes);
  let covered = 0;
  for (const day of slots.days) {
    if (covered >= slots.owed_minutes || perDay <= 0 || Object.keys(picks).length >= MAX_DAYS) break;
    picks[day.date] = { ...slots.usual };
    covered += perDay;
  }
  return picks;
}

/** The day the picked days would cover the balance, if they do. */
export function backOnTrack(picks: Picks, owed: number, breakMinutes: number) {
  let covered = 0;
  for (const date of Object.keys(picks).sort()) {
    covered += plannedMinutes(picks[date].start, picks[date].end, breakMinutes);
    if (covered >= owed) return date;
  }
  return null;
}

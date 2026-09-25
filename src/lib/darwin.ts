import { TZDate, tz } from "@date-fns/tz";
import { differenceInMinutes, format, parse } from "date-fns";

// Every business date and time is Australia/Darwin (UTC+09:30, no daylight saving).
export const DARWIN = "Australia/Darwin";
const inDarwin = tz(DARWIN);
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

type Instant = Date | string;

function toDarwin(value: Instant) {
  if (typeof value === "string" && DATE_KEY.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new TZDate(year, month - 1, day, DARWIN);
  }
  return new TZDate(new Date(value).getTime(), DARWIN);
}

/** The Darwin calendar date of an instant, as `yyyy-MM-dd`. */
export function darwinDateKey(value: Instant) {
  return format(toDarwin(value), "yyyy-MM-dd", { in: inDarwin });
}

/** "Tue 14 Oct" */
export function formatDay(value: Instant) {
  return format(toDarwin(value), "EEE d MMM", { in: inDarwin });
}

/** "9:00 am" */
export function formatTime(value: Instant) {
  return format(toDarwin(value), "h:mm aaa", { in: inDarwin });
}

/** "Tue 14 Oct, 9:00 am" */
export function formatDayTime(value: Instant) {
  return `${formatDay(value)}, ${formatTime(value)}`;
}

/** A database `time` ("09:00:00" or "09:00") as "9:00 am". */
export function formatTimeOfDay(value: string) {
  return format(parse(value.slice(0, 5), "HH:mm", new Date(2000, 0, 1)), "h:mm aaa");
}

/** The instant of a Darwin wall-clock time on a Darwin date. */
export function darwinAt(dateKey: string, time: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(new TZDate(year, month - 1, day, hour, minute, DARWIN).getTime());
}

/** Relative time up to 6 days old, then the date. */
export function relativeOrDate(value: Instant, now: Date) {
  const minutes = differenceInMinutes(now, new Date(value));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  const days = Math.floor(minutes / (24 * 60));
  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;
  return formatDay(value);
}

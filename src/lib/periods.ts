// Calendar maths on Darwin date keys (yyyy-MM-dd). Day numbers are UTC-based, so no
// time zone or daylight saving can shift them. Mirrors the SQL in private.* (R5.7).

const DAY = 86_400_000;

function dayNumber(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY;
}

function keyOf(dayNo: number) {
  return new Date(dayNo * DAY).toISOString().slice(0, 10);
}

export function addDays(key: string, days: number) {
  return keyOf(dayNumber(key) + days);
}

/** R5.7.1: weeks run Monday to Sunday. */
export function mondayOf(key: string) {
  const n = dayNumber(key);
  const weekday = (new Date(n * DAY).getUTCDay() + 6) % 7; // Monday = 0
  return keyOf(n - weekday);
}

/** R5.7.2: company-wide fortnights anchored on a Monday, real floor before the anchor. */
export function fortnightIndex(key: string, anchor: string) {
  return Math.floor((dayNumber(key) - dayNumber(anchor)) / 14);
}

export function fortnightStart(key: string, anchor: string) {
  return addDays(anchor, 14 * fortnightIndex(key, anchor));
}

export function fortnightEnd(key: string, anchor: string) {
  return addDays(fortnightStart(key, anchor), 13);
}

/** R5.7.3: "Week 6 of 13". */
export function weekNo(key: string, startDate: string) {
  return Math.floor((dayNumber(mondayOf(key)) - dayNumber(mondayOf(startDate))) / 7) + 1;
}

export function totalWeeks(startDate: string, plannedEnd: string) {
  return weekNo(plannedEnd, startDate);
}

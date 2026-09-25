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

/** The Monday that starts last week: the week a check-in and the Monday summary cover. */
export function lastWeekStart(today: string) {
  return addDays(mondayOf(today), -7);
}

/**
 * Mondays a check-in can be saved for, newest first: weeks that have started, overlap the
 * placement and are at most `limit` weeks back (the database enforces the same range).
 */
export function checkinWeeks(today: string, startDate: string, endDate: string, limit = 12) {
  const first = mondayOf(startDate);
  let week = [mondayOf(today), mondayOf(endDate)].reduce((a, b) => (a < b ? a : b));
  const weeks: string[] = [];
  while (week >= first && weeks.length < limit) {
    weeks.push(week);
    week = addDays(week, -7);
  }
  return weeks;
}

/** The first day of the month holding `key`. */
export function monthStart(key: string) {
  return `${key.slice(0, 7)}-01`;
}

export function addMonths(key: string, months: number) {
  const [year, month] = key.split("-").map(Number);
  return keyOf(Date.UTC(year, month - 1 + months, 1) / DAY);
}

/**
 * Mon–Fri rows covering the month holding `key`, for the intern month calendar.
 * Weekdays from the neighbouring months are null; a row with none of this month's days is dropped.
 */
export function monthGrid(key: string): (string | null)[][] {
  const first = monthStart(key);
  const next = addMonths(first, 1);
  const rows: (string | null)[][] = [];
  for (let monday = mondayOf(first); monday < next; monday = addDays(monday, 7)) {
    const row = [0, 1, 2, 3, 4].map((i) => {
      const day = addDays(monday, i);
      return day >= first && day < next ? day : null;
    });
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

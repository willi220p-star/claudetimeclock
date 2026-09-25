// Pure helpers for the admin configuration screens (sites, closures, settings, audit).
// The database validates everything again; these only shape what the screens show and send.

/** Jobs an admin can run by hand through public.run_job. Add a name here when the database learns one. */
export const JOBS = [
  { name: "auto_close", label: "Clock out open shifts (daily 7:05 pm)" },
  { name: "day_close", label: "Day close (daily 7:10 pm)" },
  { name: "reconcile", label: "Reconcile day results (nightly 2:00 am)" },
  { name: "escalate", label: "Escalate waiting requests (hourly)" },
  { name: "retention_reminders", label: "Retention reminders (nightly)" },
  { name: "clock_guard", label: "Test clock check" },
] as const;

/** Tables the audit log writes to, for the filter. */
export const AUDIT_TABLES = [
  "cron.job",
  "daymark_closure_days",
  "daymark_cohorts",
  "daymark_day_results",
  "daymark_notices",
  "daymark_placements",
  "daymark_profiles",
  "daymark_requests",
  "daymark_scheduled_days",
  "daymark_settings",
  "daymark_sites",
] as const;

/** "00:00" to "23:45" in 15-minute steps, as the site clock-in window allows. */
export const QUARTER_HOURS = Array.from({ length: 96 }, (_, i) => {
  const m = i * 15;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

/** Numeric settings, grouped, with the same ranges as private.update_settings. */
export const SETTING_GROUPS = [
  {
    title: "Clocking",
    fields: [
      { key: "grace_minutes", label: "Grace period", unit: "minutes", min: 0, max: 60 },
      { key: "max_day_minutes", label: "Longest counted day", unit: "minutes", min: 600, max: 720 },
      { key: "max_accuracy_m", label: "GPS accuracy limit", unit: "metres", min: 20, max: 500 },
      { key: "idle_signout_minutes", label: "Idle sign-out", unit: "minutes", min: 5, max: 480 },
    ],
  },
  {
    title: "Requests",
    fields: [
      { key: "notice_hours", label: "Request notice", unit: "hours", min: 0, max: 168 },
      { key: "escalation_hours", label: "Escalate after", unit: "hours", min: 1, max: 336 },
      { key: "sick_backdate_days", label: "Sick leave backdating", unit: "days", min: 0, max: 14 },
    ],
  },
  {
    title: "Punch fixes",
    fields: [
      { key: "punch_fix_days", label: "Punch fix window", unit: "days", min: 1, max: 31 },
      { key: "punch_fix_min_reason", label: "Shortest reason", unit: "characters", min: 1, max: 500 },
      { key: "punch_fix_max_per_fortnight", label: "Fixes per fortnight", unit: "fixes", min: 1, max: 20 },
    ],
  },
  {
    title: "Retention",
    fields: [
      { key: "retention_days", label: "Keep records", unit: "days", min: 1, max: 365 },
      { key: "cert_retention_days", label: "Keep medical certificates", unit: "days", min: 1, max: 365 },
    ],
  },
] as const;

export type SettingKey = (typeof SETTING_GROUPS)[number]["fields"][number]["key"];
export type SettingValues = Record<SettingKey, number> & { fortnight_anchor: string };

/** Only the keys whose value changed, ready for update_settings. */
export function settingsDiff(original: SettingValues, next: SettingValues): Partial<SettingValues> {
  const out: Record<string, number | string> = {};
  for (const key of Object.keys(next) as (keyof SettingValues)[]) {
    if (next[key] !== original[key]) out[key] = next[key];
  }
  return out as Partial<SettingValues>;
}

/** Flattens a JSON value into readable "path: value" lines, e.g. a job result. */
export function jsonLines(value: unknown, path = ""): { key: string; value: string }[] {
  if (value !== null && typeof value === "object") {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
    if (entries.length === 0) return [{ key: path || "result", value: Array.isArray(value) ? "none" : "—" }];
    return entries.flatMap(([k, v]) => jsonLines(v, path ? `${path}.${k}` : k));
  }
  return [{ key: path || "result", value: value === null || value === undefined ? "—" : String(value) }];
}

/** Groups rows by the year of their `day` ("yyyy-MM-dd"), keeping the input order. */
export function groupByYear<T extends { day: string }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const year = row.day.slice(0, 4);
    groups.set(year, [...(groups.get(year) ?? []), row]);
  }
  return [...groups.entries()].map(([year, items]) => ({ year, items }));
}

/** "1 scheduled day cancelled", "3 scheduled days cancelled". */
export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

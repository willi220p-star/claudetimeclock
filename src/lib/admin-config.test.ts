import { describe, expect, test } from "vitest";
import { groupByYear, jsonLines, plural, QUARTER_HOURS, settingsDiff, type SettingValues } from "@/lib/admin-config";
import { fieldErrors, noticeSchema, settingsSchema, siteSchema } from "@/lib/schemas";

const base: SettingValues = {
  grace_minutes: 5,
  max_day_minutes: 600,
  max_accuracy_m: 100,
  idle_signout_minutes: 30,
  notice_hours: 24,
  escalation_hours: 48,
  sick_backdate_days: 3,
  punch_fix_days: 7,
  punch_fix_min_reason: 10,
  punch_fix_max_per_fortnight: 3,
  retention_days: 365,
  cert_retention_days: 90,
  fortnight_anchor: "2026-01-05",
};

describe("admin-config", () => {
  test("settingsDiff sends only changed keys", () => {
    expect(settingsDiff(base, base)).toEqual({});
    expect(settingsDiff(base, { ...base, grace_minutes: 10, fortnight_anchor: "2026-01-12" })).toEqual({
      grace_minutes: 10,
      fortnight_anchor: "2026-01-12",
    });
  });

  test("jsonLines flattens nested results", () => {
    expect(jsonLines({ drift: 2, closed: { shifts: 1, ids: ["a", "b"] }, none: [] })).toEqual([
      { key: "drift", value: "2" },
      { key: "closed.shifts", value: "1" },
      { key: "closed.ids.0", value: "a" },
      { key: "closed.ids.1", value: "b" },
      { key: "none", value: "none" },
    ]);
    expect(jsonLines(null)).toEqual([{ key: "result", value: "—" }]);
    expect(jsonLines(true)).toEqual([{ key: "result", value: "true" }]);
  });

  test("groupByYear keeps order", () => {
    const rows = [{ day: "2026-12-25" }, { day: "2027-01-01" }, { day: "2027-01-26" }];
    expect(groupByYear(rows).map((g) => [g.year, g.items.length])).toEqual([
      ["2026", 1],
      ["2027", 2],
    ]);
  });

  test("site schema checks ranges and order", () => {
    const site = {
      name: "Office",
      address: "1 Main St",
      latitude: "-12.46",
      longitude: "130.84",
      radius_m: "200",
      standard_capacity: "3",
      hard_capacity: "4",
      window_start: "07:00",
      window_end: "19:00",
    };
    expect(siteSchema.parse(site).latitude).toBe(-12.46);
    const bad = siteSchema.safeParse({ ...site, radius_m: "19", hard_capacity: "2", window_end: "07:00" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(Object.keys(fieldErrors(bad.error)).sort()).toEqual(["hard_capacity", "radius_m", "window_end"]);
    const order = siteSchema.safeParse({ ...site, hard_capacity: "2", window_end: "06:45" });
    if (!order.success) expect(Object.keys(fieldErrors(order.error)).sort()).toEqual(["hard_capacity", "window_end"]);
    expect(siteSchema.safeParse({ ...site, window_start: "07:10" }).success).toBe(false);
  });

  test("settings schema wants whole numbers in range and a Monday anchor", () => {
    const text = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, String(v)]));
    expect(settingsSchema.parse(text)).toEqual(base);
    expect(settingsSchema.safeParse({ ...text, grace_minutes: "61" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...text, grace_minutes: "1.5" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...text, fortnight_anchor: "2026-01-06" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...text, cert_retention_days: "366" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...text, retention_days: "30", cert_retention_days: "90" }).success).toBe(false);
  });

  test("notice schema matches publish_notice", () => {
    const ok = { version: "1.1", title: "Notice", body: "x".repeat(50) };
    expect(noticeSchema.safeParse(ok).success).toBe(true);
    expect(noticeSchema.safeParse({ ...ok, version: ".1" }).success).toBe(false);
    expect(noticeSchema.safeParse({ ...ok, body: "short" }).success).toBe(false);
  });

  test("quarter hours and plural", () => {
    expect(QUARTER_HOURS[0]).toBe("00:00");
    expect(QUARTER_HOURS.at(-1)).toBe("23:45");
    expect(QUARTER_HOURS).toHaveLength(96);
    expect(plural(1, "scheduled day")).toBe("1 scheduled day");
    expect(plural(3, "scheduled day")).toBe("3 scheduled days");
  });
});

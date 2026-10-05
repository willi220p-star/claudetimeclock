import { describe, expect, test } from "vitest";
import { ADMIN_GROUPS, currentGroup, SUPERVISOR_GROUPS } from "@/components/desk-shell";

describe("staff navigation tree", () => {
  test("every page belongs to one main tab, detail pages included", () => {
    expect(currentGroup(ADMIN_GROUPS, "/admin")?.label).toBe("Home");
    expect(currentGroup(ADMIN_GROUPS, "/admin/placement/")?.label).toBe("People");
    expect(currentGroup(ADMIN_GROUPS, "/admin/timesheets")?.label).toBe("Time");
    expect(currentGroup(ADMIN_GROUPS, "/admin/audit")?.label).toBe("Reports");
    expect(currentGroup(ADMIN_GROUPS, "/admin/sites")?.label).toBe("Settings");
    expect(currentGroup(SUPERVISOR_GROUPS, "/supervisor/intern")?.label).toBe("Interns");
    expect(currentGroup(SUPERVISOR_GROUPS, "/supervisor/timesheets")?.label).toBe("Time");
    expect(currentGroup(SUPERVISOR_GROUPS, "/supervisor")?.label).toBe("Today");
  });

  test("no page sits under two main tabs", () => {
    for (const groups of [ADMIN_GROUPS, SUPERVISOR_GROUPS]) {
      for (const page of groups.flatMap((group) => group.pages)) {
        expect(groups.filter((group) => group.pages.some((other) => other.match(page.href)))).toHaveLength(1);
      }
    }
  });
});

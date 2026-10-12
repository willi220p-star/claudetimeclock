import { describe, expect, test } from "vitest";
import { INTERN_TABS } from "@/components/desk-shell";
import { ME_SEGMENTS, SCHEDULE_SEGMENTS } from "@/components/segmented-nav";

const lit = (items: readonly { label: string; match: (path: string) => boolean }[], path: string) =>
  items.filter((item) => item.match(path)).map((item) => item.label);

describe("intern navigation (D46)", () => {
  test("bottom tabs: Today, Tasks, Projects, Schedule, Me", () => {
    expect(INTERN_TABS.map((tab) => tab.label)).toEqual(["Today", "Tasks", "Projects", "Schedule", "Me"]);
  });

  test.each([
    ["/clock", "Today"],
    ["/clock/", "Today"],
    ["/clock/tasks/", "Tasks"],
    ["/clock/projects", "Projects"],
    ["/clock/schedule", "Schedule"],
    ["/clock/schedule/history/", "Schedule"],
    ["/clock/me", "Me"],
    ["/clock/progress/", "Me"],
    ["/clock/requests", "Me"],
  ])("%s lights %s only", (path, tab) => {
    expect(lit(INTERN_TABS, path)).toEqual([tab]);
  });

  test("Me segments follow the page", () => {
    expect(lit(ME_SEGMENTS, "/clock/me/")).toEqual(["Me"]);
    expect(lit(ME_SEGMENTS, "/clock/progress")).toEqual(["Progress"]);
    expect(lit(ME_SEGMENTS, "/clock/requests/")).toEqual(["Requests"]);
  });

  test("Schedule segments: Roster only on the roster itself", () => {
    expect(lit(SCHEDULE_SEGMENTS, "/clock/schedule/")).toEqual(["Roster"]);
    expect(lit(SCHEDULE_SEGMENTS, "/clock/schedule/history/")).toEqual(["History"]);
  });
});

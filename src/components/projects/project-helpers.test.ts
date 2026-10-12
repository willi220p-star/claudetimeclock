import { describe, expect, it } from "vitest";
import {
  activitySentence,
  checkLinks,
  dateRange,
  filterProjects,
  hoursText,
  projectProgress,
  teamText,
} from "@/components/projects/project-helpers";

describe("projectProgress", () => {
  it("counts done copies out of all copies", () => {
    expect(projectProgress(7, 12)).toEqual({ percent: 58, text: "7 of 12 tasks done" });
    expect(projectProgress(1, 1)).toEqual({ percent: 100, text: "1 of 1 tasks done" });
    expect(projectProgress(0, 0)).toEqual({ percent: 0, text: "No tasks yet" });
    expect(projectProgress(5, 3).percent).toBe(100);
  });

  it("shows hours spent against the estimate", () => {
    expect(hoursText(18 * 60, 26 * 60)).toBe("18 h of 26 h");
    expect(hoursText(90, 0)).toBe("1 h 30 m spent");
    expect(hoursText(0, 0)).toBeNull();
  });

  it("writes the date range", () => {
    expect(dateRange("2026-09-01", "2026-10-31")).toBe("1 Sep to 31 Oct");
    expect(dateRange("2026-09-01", null)).toBe("From 1 Sep");
    expect(dateRange(null, "2026-10-31")).toBe("Due 31 Oct");
    expect(dateRange(null, null)).toBeNull();
  });
});

describe("checkLinks", () => {
  it("drops blanks and keeps https links", () => {
    expect(checkLinks([" https://a.com ", "", "https://b.com/x"])).toEqual({ links: ["https://a.com", "https://b.com/x"] });
  });
  it("refuses http, spaces, more than 5 and long links", () => {
    expect(checkLinks(["http://a.com"])).toHaveProperty("error");
    expect(checkLinks(["https://a b.com"])).toHaveProperty("error");
    expect(checkLinks(["https://"])).toHaveProperty("error");
    expect(checkLinks(Array.from({ length: 6 }, (_, i) => `https://a.com/${i}`))).toEqual({ error: "Keep it to 5 links." });
    expect(checkLinks([`https://a.com/${"x".repeat(500)}`])).toHaveProperty("error");
  });
});

describe("filterProjects", () => {
  const rows = [
    { name: "Harbour Cafe website", client_name: "Harbour Cafe" },
    { name: "Ads", client_name: "Northside Dental" },
    { name: "Internal", client_name: null },
  ];
  it("matches name or client, ignoring case", () => {
    expect(filterProjects(rows, "dental").map((row) => row.name)).toEqual(["Ads"]);
    expect(filterProjects(rows, "HARBOUR")).toHaveLength(1);
    expect(filterProjects(rows, "  ")).toHaveLength(3);
  });
});

describe("activity and team text", () => {
  it("reads each kind as a sentence", () => {
    expect(activitySentence({ actor_name: "Priya", kind: "changes_asked", text: "Homepage" })).toBe(
      "Priya asked for changes on Homepage",
    );
    expect(activitySentence({ actor_name: "Dilip", kind: "status_changed", text: "on_hold" })).toBe("Dilip set the status to On hold");
    expect(activitySentence({ actor_name: null, kind: "milestone_done", text: "Launch" })).toBe("Milestone Launch done");
    expect(activitySentence({ actor_name: "Aisha", kind: "task_done", text: "Brief" })).toBe("Aisha finished Brief");
  });
  it("names the lead and the team", () => {
    expect(teamText("Dilip", ["Dilip", "Sushant", "Vipashyana"])).toBe("Lead Dilip, with Sushant and Vipashyana");
    expect(teamText(null, ["A", "B", "C"])).toBe("With A, B and C");
    expect(teamText(null, [])).toBe("No team yet");
  });
});

import { describe, expect, test } from "vitest";
import {
  fillWeekGaps,
  buildCertificateModel,
  buildReportModel,
  certificateBlocker,
  documentId,
  hoursText,
  verificationLabels,
  type ReportInput,
} from "@/lib/report";

const PLACEMENT_ID = "3f2a91c0-1111-4222-8333-444455556666";
const GENERATED = new Date("2026-09-25T05:02:00Z"); // 2:32 pm in Darwin

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    placement: {
      id: PLACEMENT_ID,
      status: "completed",
      start_date: "2026-06-01",
      planned_end_date: "2026-09-18",
      ended_on: "2026-09-11",
      target_minutes: 480 * 60,
      university: "CDU",
      course: "Bachelor of IT",
      uni_coordinator_name: "Dr Lee",
      report_approved_at: "2026-09-12T00:30:00Z",
      report_approved_by: "sup",
      report_approval_note: " Hours final. ",
      supervisor_id: "sup",
    },
    internName: "Grace Park",
    weeks: [
      { week_no: 1, week_start: "2026-06-01", scheduled: 900, counted: 870, approved_ot: 30, no_shows: 0, late_days: 1 },
      { week_no: 2, week_start: "2026-06-08", scheduled: 900, counted: 450, approved_ot: null, no_shows: 1, late_days: 0 },
      { week_no: null, week_start: null, scheduled: 60, counted: 60, approved_ot: 0, no_shows: 0, late_days: 0 },
    ],
    days: [
      { work_date: "2026-06-01", counted: 480, worked: 480, approved_ot: 30 },
      { work_date: "2026-06-02", counted: 390, worked: 390, approved_ot: 0 },
      { work_date: "2026-06-03", counted: 0, worked: 0, approved_ot: 0 },
    ],
    punches: [
      // 2026-06-01 Darwin: a GPS + selfie clock-in, a replaced clock-out and its punch fix.
      { id: "p1", occurred_at: "2026-05-31T23:30:00Z", source: "device", verification_method: "gps_selfie", confirmed_by: null, replaces_punch_id: null },
      { id: "p2", occurred_at: "2026-06-01T08:00:00Z", source: "device", verification_method: "gps_selfie", confirmed_by: null, replaces_punch_id: null },
      { id: "p3", occurred_at: "2026-06-01T08:30:00Z", source: "punch_fix", verification_method: "punch_fix", confirmed_by: null, replaces_punch_id: "p2" },
      // 2026-06-02 Darwin: supervisor confirmed.
      { id: "p4", occurred_at: "2026-06-01T23:30:00Z", source: "supervisor", verification_method: "supervisor", confirmed_by: "sup", replaces_punch_id: null },
    ],
    requests: [
      { type: "overtime", status: "approved", dates: ["2026-06-01"], supervisor_id: "sup", admin_id: null, admin_decision: null },
      { type: "punch_fix", status: "approved", dates: ["2026-06-01"], supervisor_id: "sup", admin_id: "adm", admin_decision: "approved" },
    ],
    names: { sup: "Tom Walsh", intern: "Grace Park" },
    generatedAt: GENERATED,
    documentId: "DGK-3F2A91C0-ABCDEF12",
    ...overrides,
  };
}

describe("intern report model", () => {
  test("the document id is the placement's short id plus a SHA-256 of id + generated_at", async () => {
    const id = await documentId(PLACEMENT_ID, GENERATED);
    expect(id).toMatch(/^DGK-3F2A91C0-[0-9A-F]{8}$/);
    expect(await documentId(PLACEMENT_ID, GENERATED)).toBe(id);
    expect(await documentId(PLACEMENT_ID, new Date(GENERATED.getTime() + 1000))).not.toBe(id);
  });

  test("header fields, Darwin dates and the generated stamp", () => {
    const m = buildReportModel(input());
    expect(m.generated).toBe("25 Sep 2026, 2:32 pm");
    expect(m.dates).toEqual({ start: "1 Jun 2026", plannedEnd: "18 Sep 2026", ended: "11 Sep 2026" });
    expect(m.coordinator).toBe("Dr Lee");
    expect(m.status).toBe("Completed");
    expect(m.target).toBe("480h");
  });

  test("maps weeks, drops rows without a week, and totals what it shows", () => {
    const m = buildReportModel(input());
    expect(m.weeks).toEqual([
      { week: "1", starting: "1 Jun 2026", scheduled: "15h", counted: "14h 30m", overtime: "30m", noShows: "0", late: "1" },
      { week: "2", starting: "8 Jun 2026", scheduled: "15h", counted: "7h 30m", overtime: "—", noShows: "1", late: "0" },
    ]);
    expect(m.totals).toEqual({ scheduled: "30h", counted: "22h", overtime: "30m", noShows: "1", late: "1" });
    expect(m.counted).toBe("22h");
  });

  test("lists worked days with how they were verified and who approved overtime", () => {
    const m = buildReportModel(input());
    expect(m.days).toEqual([
      {
        date: "Mon 1 Jun 2026",
        counted: "8h",
        verification: "GPS + selfie, Punch fix approved by DGK admin",
        overtime: "30m approved by Tom Walsh",
      },
      { date: "Tue 2 Jun 2026", counted: "6h 30m", verification: "Supervisor confirmed (Tom Walsh)", overtime: "—" },
    ]);
  });

  test("verification labels cover auto close, pending confirmation and no events", () => {
    const punches = [
      { id: "a", occurred_at: "2026-06-05T09:30:00Z", source: "auto_close", verification_method: null, confirmed_by: null, replaces_punch_id: null },
      { id: "b", occurred_at: "2026-06-04T23:30:00Z", source: "supervisor", verification_method: "supervisor", confirmed_by: null, replaces_punch_id: null },
    ];
    expect(verificationLabels("2026-06-05", punches, [], {})).toEqual([
      "Auto clock-out (unverified)",
      "Awaiting supervisor confirmation",
    ]);
    expect(verificationLabels("2026-06-06", punches, [], {})).toEqual(["No clock events"]);
  });

  test("approval line and note, or not yet approved", () => {
    expect(buildReportModel(input()).approval).toEqual({
      approved: true,
      line: "Approved by Tom Walsh on 12 Sep 2026",
      note: "Hours final.",
    });
    const draft = input();
    draft.placement = { ...draft.placement, report_approved_at: null, report_approved_by: null };
    expect(buildReportModel(draft).approval).toEqual({
      approved: false,
      line: "Not yet approved by the DGK supervisor",
      note: null,
    });
  });
});

describe("certificate", () => {
  test("is available when completed, or target reached with the report approved", () => {
    expect(certificateBlocker({ status: "completed", report_approved_at: null })).toBeNull();
    expect(certificateBlocker({ status: "target_reached", report_approved_at: "2026-09-12T00:00:00Z" })).toBeNull();
    expect(certificateBlocker({ status: "target_reached", report_approved_at: null })).toMatch(/report is approved/);
    expect(certificateBlocker({ status: "active", report_approved_at: null })).toMatch(/completed/);
    expect(certificateBlocker({ status: "withdrawn", report_approved_at: "2026-09-12T00:00:00Z" })).toMatch(/completed/);
  });

  test("states the counted hours, dates and supervisor", () => {
    expect(buildCertificateModel(input())).toEqual({
      documentId: "DGK-3F2A91C0-ABCDEF12",
      internName: "Grace Park",
      statement: "completed 22 hours of professional placement at DGK Business Consultancy, Palmerston City NT",
      dates: "1 Jun 2026 to 11 Sep 2026",
      supervisorName: "Tom Walsh",
      issued: "25 Sep 2026",
    });
  });

  test("hours read in words", () => {
    expect(hoursText(480 * 60)).toBe("480 hours");
    expect(hoursText(61)).toBe("1 hour 1 minute");
    expect(hoursText(479 * 60 + 30)).toBe("479 hours 30 minutes");
  });
});

describe("weekly table", () => {
  test("a week with no row (a closure week) is listed with zeros", () => {
    const row = (week_no: number, week_start: string) => ({
      week_no, week_start, scheduled: 450, counted: 450, approved_ot: 0, no_shows: 0, late_days: 0,
    });
    const weeks = fillWeekGaps([row(5, "2026-08-10"), row(3, "2026-07-27"), row(1, "2026-07-13")]);
    expect(weeks.map((w) => [w.week_no, w.week_start, w.counted])).toEqual([
      [1, "2026-07-13", 450],
      [2, "2026-07-20", 0],
      [3, "2026-07-27", 450],
      [4, "2026-08-03", 0],
      [5, "2026-08-10", 450],
    ]);
  });
});

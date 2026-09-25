import { darwinDateKey, formatDate, formatDay, formatTime } from "@/lib/darwin";
import { formatMinutes } from "@/lib/minutes";
import { PLACEMENT_STATUS_LABEL } from "@/lib/placement-ui";

/**
 * Uni hours report and completion certificate (§13, D13): pure data → document model. The
 * react-pdf components in src/components/pdf only lay these strings out. No selfies, GPS or
 * addresses ever reach the model (§13).
 */

export type ReportPlacement = {
  id: string;
  status: string;
  start_date: string;
  planned_end_date: string;
  ended_on: string | null;
  target_minutes: number;
  university: string;
  course: string;
  uni_coordinator_name: string | null;
  report_approved_at: string | null;
  report_approved_by: string | null;
  report_approval_note: string | null;
  supervisor_id: string;
};

export type ReportWeek = {
  week_no: number | null;
  week_start: string | null;
  scheduled: number | null;
  counted: number | null;
  approved_ot: number | null;
  no_shows: number | null;
  late_days: number | null;
};

export type ReportDay = { work_date: string; counted: number; worked: number; approved_ot: number };

export type ReportPunch = {
  id: string;
  occurred_at: string;
  source: string;
  verification_method: string | null;
  confirmed_by: string | null;
  replaces_punch_id: string | null;
};

export type ReportRequest = {
  type: string;
  status: string;
  dates: string[];
  supervisor_id: string | null;
  admin_id: string | null;
  admin_decision: string | null;
};

export type ReportInput = {
  placement: ReportPlacement;
  internName: string;
  weeks: ReportWeek[];
  days: ReportDay[];
  punches: ReportPunch[];
  requests: ReportRequest[];
  /** Display names by profile id; RLS hides some (an intern can't read admins), which read as "DGK admin". */
  names: Record<string, string>;
  generatedAt: Date;
  documentId: string;
};

const UNKNOWN_PERSON = "DGK admin";

function nameOf(names: Record<string, string>, id: string | null) {
  return id ? (names[id] ?? UNKNOWN_PERSON) : UNKNOWN_PERSON;
}

/** "DGK-1A2B3C4D-9F8E7D6C": the placement id's first 8 characters plus the first 8 of SHA-256(placement id + generated_at) (§13). */
export async function documentId(placementId: string, generatedAt: Date) {
  const bytes = new TextEncoder().encode(placementId + generatedAt.toISOString());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `DGK-${placementId.slice(0, 8)}-${hex.slice(0, 8)}`.toUpperCase();
}

/** "25 Sep 2026, 2:32 pm" in Darwin. */
export function darwinStamp(value: Date | string) {
  return `${formatDate(value)}, ${formatTime(value)}`;
}

/** Whole hours read "480 hours"; anything else "479 hours 30 minutes". */
export function hoursText(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return rest ? `${h} ${rest} ${rest === 1 ? "minute" : "minutes"}` : h;
}

/** Who decided an approved request: the admin when they made the last call, else the supervisor. */
function approverOf(request: ReportRequest) {
  return request.admin_decision ? request.admin_id : (request.supervisor_id ?? request.admin_id);
}

function approvedRequest(requests: ReportRequest[], type: string, date: string) {
  return requests.find((r) => r.type === type && r.status === "approved" && r.dates.includes(date));
}

/**
 * How a day's clock events were verified (security review §2.10), one label per method, in a
 * stable order. Punches replaced by a punch fix no longer count, so they are left out.
 */
export function verificationLabels(
  date: string,
  punches: ReportPunch[],
  requests: ReportRequest[],
  names: Record<string, string>,
) {
  const replaced = new Set(punches.map((p) => p.replaces_punch_id).filter(Boolean));
  const labels = new Set<string>();
  for (const punch of punches) {
    if (replaced.has(punch.id) || darwinDateKey(punch.occurred_at) !== date) continue;
    if (punch.source === "auto_close") labels.add("Auto clock-out (unverified)");
    else if (punch.verification_method === "gps_selfie") labels.add("GPS + selfie");
    else if (punch.verification_method === "supervisor")
      labels.add(punch.confirmed_by ? `Supervisor confirmed (${nameOf(names, punch.confirmed_by)})` : "Awaiting supervisor confirmation");
    else if (punch.verification_method === "punch_fix" || punch.source === "punch_fix") {
      const fix = approvedRequest(requests, "punch_fix", date);
      labels.add(fix ? `Punch fix approved by ${nameOf(names, approverOf(fix))}` : "Punch fix");
    } else labels.add("Device clock");
  }
  return labels.size ? [...labels].sort() : ["No clock events"];
}

export type ReportModel = {
  documentId: string;
  generated: string;
  internName: string;
  university: string;
  course: string;
  coordinator: string;
  status: string;
  dates: { start: string; plannedEnd: string; ended: string };
  target: string;
  counted: string;
  weeks: { week: string; starting: string; scheduled: string; counted: string; overtime: string; noShows: string; late: string }[];
  totals: { scheduled: string; counted: string; overtime: string; noShows: string; late: string };
  days: { date: string; counted: string; verification: string; overtime: string }[];
  approval: { approved: boolean; line: string; note: string | null };
};

const num = (value: number | null) => value ?? 0;

/** The counted total: the sum of the weekly counted minutes the report's table shows. */
export function countedMinutes(weeks: ReportWeek[]) {
  return weeks.reduce((total, w) => total + (w.week_start ? num(w.counted) : 0), 0);
}

export function buildReportModel(input: ReportInput): ReportModel {
  const { placement, names, requests } = input;
  const weeks = input.weeks.filter((w) => w.week_start);
  const sum = (key: keyof ReportWeek) => weeks.reduce((total, w) => total + num(w[key] as number | null), 0);
  const counted = countedMinutes(weeks);
  const approvedBy = placement.report_approved_by ? nameOf(names, placement.report_approved_by) : null;

  return {
    documentId: input.documentId,
    generated: darwinStamp(input.generatedAt),
    internName: input.internName,
    university: placement.university,
    course: placement.course,
    coordinator: placement.uni_coordinator_name ?? "—",
    status: PLACEMENT_STATUS_LABEL[placement.status] ?? placement.status,
    dates: {
      start: formatDate(placement.start_date),
      plannedEnd: formatDate(placement.planned_end_date),
      ended: placement.ended_on ? formatDate(placement.ended_on) : "—",
    },
    target: formatMinutes(placement.target_minutes),
    counted: formatMinutes(counted),
    weeks: weeks.map((w) => ({
      week: String(num(w.week_no)),
      starting: formatDate(w.week_start as string),
      scheduled: formatMinutes(num(w.scheduled)),
      counted: formatMinutes(num(w.counted)),
      overtime: num(w.approved_ot) ? formatMinutes(num(w.approved_ot)) : "—",
      noShows: String(num(w.no_shows)),
      late: String(num(w.late_days)),
    })),
    totals: {
      scheduled: formatMinutes(sum("scheduled")),
      counted: formatMinutes(counted),
      overtime: formatMinutes(sum("approved_ot")),
      noShows: String(sum("no_shows")),
      late: String(sum("late_days")),
    },
    days: input.days
      .filter((d) => d.worked > 0 || d.counted > 0)
      .map((d) => {
        const ot = d.approved_ot > 0 ? approvedRequest(requests, "overtime", d.work_date) : undefined;
        return {
          date: `${formatDay(d.work_date)} ${d.work_date.slice(0, 4)}`,
          counted: formatMinutes(d.counted),
          verification: verificationLabels(d.work_date, input.punches, requests, names).join(", "),
          overtime:
            d.approved_ot > 0
              ? `${formatMinutes(d.approved_ot)} approved${ot ? ` by ${nameOf(names, approverOf(ot))}` : ""}`
              : "—",
        };
      }),
    approval: placement.report_approved_at
      ? {
          approved: true,
          line: `Approved by ${approvedBy} on ${formatDate(placement.report_approved_at)}`,
          note: placement.report_approval_note?.trim() || null,
        }
      : { approved: false, line: "Not yet approved by the DGK supervisor", note: null },
  };
}

/** §13: the certificate is for a finished placement: completed, or target reached with the report approved. */
export function certificateBlocker(placement: Pick<ReportPlacement, "status" | "report_approved_at">) {
  if (placement.status === "completed") return null;
  if (placement.status === "target_reached" && placement.report_approved_at) return null;
  if (placement.status === "target_reached") return "The certificate unlocks once the uni report is approved.";
  return "The certificate unlocks when the placement is completed.";
}

export type CertificateModel = {
  documentId: string;
  internName: string;
  statement: string;
  dates: string;
  supervisorName: string;
  issued: string;
};

export function buildCertificateModel(input: ReportInput): CertificateModel {
  const { placement } = input;
  const end = placement.ended_on ?? placement.planned_end_date;
  return {
    documentId: input.documentId,
    internName: input.internName,
    statement: `completed ${hoursText(countedMinutes(input.weeks))} of professional placement at DGK Business Consultancy, Palmerston City NT`,
    dates: `${formatDate(placement.start_date)} to ${formatDate(end)}`,
    supervisorName: nameOf(input.names, placement.supervisor_id),
    issued: formatDate(input.generatedAt),
  };
}

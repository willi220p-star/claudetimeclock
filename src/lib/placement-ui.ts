import type { Effect } from "@/components/effect-preview";
import type { DayStatus } from "@/components/day-status-badge";
import type { Tone } from "@/components/status-chip";
import { formatDay } from "@/lib/darwin";
import { formatMinutes } from "@/lib/minutes";

export const REQUEST_TYPES = [
  "swap",
  "shift_change",
  "extra_day",
  "leave",
  "punch_fix",
  "overtime",
  "pattern_change",
  "attendance",
] as const;

export type RequestType = (typeof REQUEST_TYPES)[number];

export const REQUEST_LABEL: Record<RequestType, string> = {
  swap: "Swap",
  shift_change: "Change times",
  extra_day: "Extra day",
  leave: "Leave",
  punch_fix: "Punch fix",
  overtime: "Overtime",
  pattern_change: "Pattern change",
  attendance: "Attendance",
};

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending_supervisor: "Waiting for supervisor",
  pending_admin: "Waiting for admin",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
};

export const RISK_LABEL: Record<string, string> = {
  schedule_gap: "Schedule gap",
  owed: "Hours owed",
  no_shows: "No-shows",
  forecast_late: "Forecast late",
  low_checkin: "Low check-in",
};

export const BOARD_STATUS: Record<string, { label: string; tone: Tone }> = {
  not_in_yet: { label: "Not in yet", tone: "neutral" },
  in: { label: "In since", tone: "ok" },
  done: { label: "Done", tone: "ok" },
  late: { label: "Late", tone: "warn" },
  leave: { label: "Leave", tone: "info" },
  no_show: { label: "No-show", tone: "bad" },
  unscheduled: { label: "Unscheduled", tone: "info" },
};

export const PLACEMENT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  extended: "Extended",
  target_reached: "Target reached",
  completed: "Completed",
  withdrawn: "Withdrawn",
};

export const FULL_SPOT_TEXT = "Full — request an extra spot (needs admin approval)";

export function requestLabel(type: string) {
  return REQUEST_LABEL[type as RequestType] ?? type;
}

export function isPending(status: string) {
  return status === "pending_supervisor" || status === "pending_admin";
}

export function requestTimeline(status: string, extraSpot: boolean) {
  const steps = ["submitted", "supervisor", ...(extraSpot || status === "pending_admin" ? ["admin"] : []), "outcome"];
  const current =
    status === "pending_supervisor" ? "supervisor" : status === "pending_admin" ? "admin" : status === "approved" || status === "declined" || status === "cancelled" ? "outcome" : "submitted";
  return { steps, current };
}

export type PreviewCapacity = {
  date: string;
  headcount: number;
  after: number;
  label: string;
};

export type RequestPreview = {
  ok: boolean;
  message: string;
  needs_extra_spot: boolean;
  dates: string[];
  effects: string[];
  capacity: PreviewCapacity[];
};

export function previewToEffects(preview: RequestPreview): Effect[] {
  const fromLines = preview.effects.flatMap((line) => splitEffect(line));
  const fromCapacity = preview.capacity.map((row) => splitEffect(row.label)[0] ?? { before: row.label, after: "" });
  return [...fromLines, ...fromCapacity];
}

/** Split a server verdict that already uses an arrow into the EffectPreview shape. */
export function splitEffect(line: string): Effect[] {
  const arrow = line.match(/^(.*?)(?:\s+→\s+|\s+->\s+)(.*)$/);
  if (arrow) return [{ before: arrow[1].trim(), after: arrow[2].trim() }];
  const becomes = line.match(/^(.*?)\s+becomes\s+(.*)$/i);
  if (becomes) return [{ before: becomes[1].trim(), after: becomes[2].trim() }];
  const moves = line.match(/^(.*?)\s+moves to\s+(.*)$/i);
  if (moves) return [{ before: moves[1].trim(), after: moves[2].trim() }];
  return [{ before: line, after: "—" }];
}

export function owedLabel(minutes: number) {
  if (minutes > 0) return `Owed ${formatMinutes(minutes)}`;
  if (minutes < 0) return formatMinutes(minutes);
  return "Nothing owed";
}

export function coversLine(covers: number, owed: number) {
  return `Covers ${formatMinutes(covers)} of ${formatMinutes(owed)} owed`;
}

export function dayCellStatus(args: {
  workDate: string;
  today: string;
  dayStatus?: string | null;
  counted?: number | null;
  noShow?: boolean | null;
  closure?: string | null;
}): DayStatus {
  if (args.closure) return "closure";
  if (args.dayStatus === "moved") return "moved";
  if (args.dayStatus === "leave") return "leave";
  if (args.dayStatus === "cancelled") return "cancelled";
  if (args.noShow) return "no_show";
  if ((args.counted ?? 0) > 0) return "worked";
  if (args.workDate === args.today) return "today";
  if (args.dayStatus === "scheduled") return "scheduled";
  return "scheduled";
}

export type CatchUpItem = {
  type: string;
  payload: Record<string, string>;
  gain_minutes: number;
  label: string;
};

export type CatchUpOption = {
  requests: CatchUpItem[];
  covers_minutes: number;
  fully_covers: boolean;
};

export type CatchUpPlan = {
  owed_minutes: number;
  a: CatchUpOption;
  b: CatchUpOption;
};

export type InternKpi = {
  placement_id: string;
  counted_total: number;
  target_minutes: number;
  remaining: number;
  week_no: number;
  total_weeks: number;
  forecast_finish: string | null;
  days_late: number | null;
  pace: string;
  owed: number;
  this_week: { counted: number; scheduled: number };
  on_time_pct: number | null;
  attendance_pct: number | null;
  work_log_streak: number;
  pending_requests: number;
};

export type SupervisorKpi = {
  approvals_waiting: number;
  oldest_hours: number | null;
  at_risk: number;
  attendance_pct: number | null;
  on_time_pct: number | null;
  overtime_approved_minutes: number;
  work_log_pct: number | null;
  checkins_due: number;
  last_checkin: { week_start: string | null; average: number | null };
};

export type AdminKpi = {
  active: number;
  starting_soon: number;
  finishing_soon: number;
  pct_on_pace: number | null;
  counted_fortnight: number;
  counted_all_time: number;
  attendance_pct: number | null;
  on_time_pct: number | null;
  no_shows_fortnight: number;
  missed_punches_fortnight: number;
  turnaround: { supervisor_id: string; name: string; median_hours: number }[];
  desk_use_pct: number | null;
  days_at_four: number;
  outcomes: { on_time: number; late: number; withdrawn: number };
  interns_per_supervisor: { supervisor_id: string; name: string; interns: number }[];
  heatmap: { date: string; headcount: number }[];
};

export type ClockStatus = {
  server_now: string;
  today: string;
  next_event: "shift_in" | "shift_out";
  open_since: string | null;
  blocked: string | null;
  block_code: string | null;
  scheduled: { start: string; end: string; planned_minutes: number; status: string; leave_kind: string | null } | null;
  placement: {
    id: string;
    status: string;
    start_date: string;
    planned_end_date: string;
    ended_on: string | null;
    read_only: boolean;
    delete_on: string | null;
  } | null;
};

export type TodayPerson = {
  display_name: string;
  initials: string;
  status: string;
  unscheduled: boolean;
  me: boolean;
  person_id?: string;
  since?: string | null;
  start?: string | null;
  end?: string | null;
  late?: boolean;
  extra?: boolean;
};

export type TodayBoard = {
  date: string;
  site: { id: string; name: string; standard_capacity: number };
  count: number;
  label: string;
  people: TodayPerson[];
};

export type ProgressRow = {
  placement_id: string;
  intern_id: string;
  intern_name: string;
  supervisor_id: string;
  status: string;
  start_date: string;
  planned_end_date: string;
  target_minutes: number;
  owed: number;
  counted_total: number;
  remaining: number;
  week_no: number;
  total_weeks: number;
  forecast_finish: string | null;
  days_late: number | null;
  pace: string;
  attendance_pct?: number | null;
  risk_reasons: string[];
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function overtimeSteps(requested: number) {
  const top = Math.max(0, requested);
  const steps: number[] = [];
  for (let n = 15; n <= top; n += 15) steps.push(n);
  if (top > 0 && !steps.includes(top)) steps.push(top);
  return steps;
}

export type ClockCardName = "checking" | "blocked" | "ready_in" | "camera" | "submitting" | "in" | "done";

/** ClockCard states in §11.3. Camera and submit win so the selfie flow stays reachable. */
export function clockCardState(args: {
  loading: boolean;
  clockedIn: boolean;
  phase: "idle" | "camera" | "submitting";
  blocked: string | null;
  punchedOutToday: boolean;
}): ClockCardName {
  if (args.phase === "camera") return "camera";
  if (args.phase === "submitting") return "submitting";
  if (args.loading) return "checking";
  if (args.clockedIn) return "in";
  if (args.punchedOutToday) return "done";
  if (args.blocked) return "blocked";
  return "ready_in";
}

export function forecastText(forecast: string | null, daysLate: number | null) {
  if (!forecast || daysLate === null) return "Can't forecast a finish date yet.";
  const when = formatDay(forecast);
  if (daysLate < 0) return `Finishes ${when} · ${-daysLate === 1 ? "1 day" : `${-daysLate} days`} early`;
  if (daysLate === 0) return `Finishes ${when} · on plan`;
  return `Finishes ${when} · ${daysLate === 1 ? "1 day" : `${daysLate} days`} late`;
}

export function requestAgeHours(createdAt: string, now: Date) {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(createdAt)) / 3_600_000));
}

export function approvalTone(hours: number, escalated: boolean): Tone {
  if (escalated) return "bad";
  if (hours > 48) return "warn";
  return "neutral";
}

export function internName(value: unknown) {
  const row = asRecord(value);
  return typeof row?.display_name === "string" ? row.display_name : "Intern";
}

export function buildRequestPayload(type: string, fields: Record<string, string>): Record<string, unknown> {
  switch (type) {
    case "swap":
      return {
        scheduled_day_id: fields.scheduled_day_id,
        new_date: fields.new_date,
        ...(fields.start && fields.end ? { start: fields.start.slice(0, 5), end: fields.end.slice(0, 5) } : {}),
      };
    case "shift_change":
      return { scheduled_day_id: fields.scheduled_day_id, start: fields.start.slice(0, 5), end: fields.end.slice(0, 5) };
    case "extra_day":
      return { date: fields.date, start: (fields.start || "09:00").slice(0, 5), end: (fields.end || "17:00").slice(0, 5) };
    case "leave":
      return {
        dates: (fields.dates ?? "").split(",").map((part) => part.trim()).filter(Boolean),
        kind: fields.kind || "personal",
      };
    case "punch_fix":
      return {
        date: fields.date,
        ...(fields.clock_in ? { clock_in: fields.clock_in } : {}),
        ...(fields.clock_out ? { clock_out: fields.clock_out } : {}),
      };
    case "pattern_change":
      return { effective_from: fields.effective_from, pattern: JSON.parse(fields.pattern || "[]") };
    default:
      return { ...fields };
  }
}

/** §11.3 check-in areas, stored as 1–5 each. */
export const CHECKIN_AREAS = [
  { key: "reliability", label: "Reliability" },
  { key: "quality", label: "Quality of work" },
  { key: "communication", label: "Communication" },
] as const;

export const CHECKIN_ANCHORS: Record<number, string> = { 1: "Needs a lot of help", 3: "Solid", 5: "Excellent" };

export type CheckinScores = { reliability: number; quality: number; communication: number };

export function checkinAverage(scores: CheckinScores) {
  return Math.round(((scores.reliability + scores.quality + scores.communication) / 3) * 10) / 10;
}

/** §12 supervisor 8: overdue when the latest check-in is for a week before last week. */
export function checkinOverdue(latestWeekStart: string | null, lastWeek: string) {
  return latestWeekStart === null || latestWeekStart < lastWeek;
}

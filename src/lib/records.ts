import { darwinAt, darwinDateKey, formatDate, formatDayTime, formatTimeOfDay } from "@/lib/darwin";

// The Records tab (Dilip, 26 Sep): every table, read under the viewer's RLS. Admins edit the
// listed fields and delete rows through update_record / delete_record; the database keeps the
// final say (it holds the same column whitelist), so this list only shapes the form.

export type Row = Record<string, unknown>;
export type FieldKind = "text" | "textarea" | "number" | "time" | "date" | "datetime";
export type Field = { name: string; label: string; kind: FieldKind };
export type Names = { person: (id: unknown) => string | null; placement: (id: unknown) => string | null };

export type RecordTable = {
  table: string;
  label: string;
  /** Hidden from supervisors (RLS would show them nothing useful). */
  adminOnly?: boolean;
  order: { column: string; ascending?: boolean };
  title: (row: Row, names: Names) => string;
  subtitle: (row: Row, names: Names) => string;
  edit?: Field[];
  deletable?: boolean;
  /** What else goes with a delete, shown in the confirm sheet. */
  deleteNote?: string;
};

const text = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));
const when = (value: unknown) => (typeof value === "string" && value ? formatDayTime(value) : "—");
const day = (value: unknown) => (typeof value === "string" && value ? formatDate(value) : "—");
const time = (value: unknown) => (typeof value === "string" && value ? formatTimeOfDay(value) : "—");
const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");
const LABEL = (value: unknown) => text(value).replaceAll("_", " ");

export const RECORD_TABLES: RecordTable[] = [
  {
    table: "daymark_profiles",
    label: "People",
    order: { column: "display_name", ascending: true },
    title: (r) => text(r.display_name),
    subtitle: (r) =>
      join(
        text(r.contact_email),
        [r.is_intern && "intern", r.is_supervisor && "supervisor", r.is_admin && "admin"].filter(Boolean).join(", "),
        !r.active && "inactive",
      ),
    edit: [{ name: "display_name", label: "Name", kind: "text" }],
    deletable: true,
    deleteNote:
      "Deletes their login, placement, punches, requests, roster, notifications and photos for good. The audit log and consent records stay.",
  },
  {
    table: "daymark_placements",
    label: "Placements",
    order: { column: "start_date" },
    title: (r, n) => text(n.person(r.intern_id)),
    subtitle: (r) => join(text(r.university), LABEL(r.status), `${day(r.start_date)} – ${day(r.planned_end_date)}`),
    edit: [
      { name: "university", label: "University", kind: "text" },
      { name: "course", label: "Course", kind: "text" },
      { name: "uni_coordinator_name", label: "Uni coordinator", kind: "text" },
      { name: "uni_coordinator_email", label: "Coordinator email", kind: "text" },
    ],
    deletable: true,
    deleteNote: "Deletes the placement with its roster, punches, hours, requests, work logs and photos. The person stays.",
  },
  {
    table: "daymark_scheduled_days",
    label: "Roster days",
    order: { column: "work_date" },
    title: (r, n) => join(n.placement(r.placement_id), day(r.work_date)),
    subtitle: (r) => join(`${time(r.start_time)}–${time(r.end_time)}`, LABEL(r.status), r.leave_kind ? LABEL(r.leave_kind) : null),
    edit: [
      { name: "start_time", label: "Start", kind: "time" },
      { name: "end_time", label: "Finish", kind: "time" },
    ],
    deletable: true,
    deleteNote: "The day's hours are worked out again without it.",
  },
  {
    table: "daymark_punches",
    label: "Punches",
    order: { column: "occurred_at" },
    title: (r, n) => join(n.person(r.user_id), LABEL(r.event_type)),
    subtitle: (r) => join(when(r.occurred_at), LABEL(r.verification_method ?? r.source), r.photo_deleted_at ? "photo removed" : null),
    edit: [{ name: "occurred_at", label: "Time (Darwin)", kind: "datetime" }],
    deletable: true,
    deleteNote: "Its selfie is deleted too, and the day's hours are worked out again.",
  },
  {
    table: "daymark_requests",
    label: "Requests",
    order: { column: "created_at" },
    title: (r, n) => join(n.person(r.intern_id), LABEL(r.type)),
    subtitle: (r) =>
      join(LABEL(r.status), Array.isArray(r.dates) ? r.dates.map((d) => day(d)).join(", ") : null, when(r.created_at)),
    edit: [
      { name: "reason", label: "Reason", kind: "textarea" },
      { name: "supervisor_note", label: "Supervisor note", kind: "textarea" },
      { name: "admin_note", label: "Admin note", kind: "textarea" },
    ],
    deletable: true,
    deleteNote: "Changes it already made to the roster stay. An attached certificate is deleted too.",
  },
  {
    table: "daymark_work_logs",
    label: "Work logs",
    order: { column: "work_date" },
    title: (r, n) => join(n.placement(r.placement_id), day(r.work_date)),
    subtitle: (r) => text(r.summary),
    edit: [{ name: "summary", label: "Summary", kind: "textarea" }],
    deletable: true,
  },
  {
    table: "daymark_checkins",
    label: "Check-ins",
    order: { column: "week_start" },
    title: (r, n) => join(n.placement(r.placement_id), `week of ${day(r.week_start)}`),
    subtitle: (r) => join(`${text(r.reliability)}/${text(r.quality)}/${text(r.communication)}`, r.comment ? text(r.comment) : null),
    edit: [
      { name: "reliability", label: "Reliability (1–5)", kind: "number" },
      { name: "quality", label: "Quality (1–5)", kind: "number" },
      { name: "communication", label: "Communication (1–5)", kind: "number" },
      { name: "comment", label: "Comment", kind: "textarea" },
    ],
    deletable: true,
  },
  {
    table: "daymark_notifications",
    label: "Notifications",
    order: { column: "created_at" },
    title: (r) => text(r.title),
    subtitle: (r, n) => join(n.person(r.person_id), when(r.created_at), r.read_at ? "read" : "unread"),
    edit: [
      { name: "title", label: "Title", kind: "text" },
      { name: "body", label: "Message", kind: "textarea" },
    ],
    deletable: true,
  },
  {
    table: "daymark_cohorts",
    label: "Cohorts",
    order: { column: "created_at" },
    title: (r) => text(r.name),
    subtitle: (r) => join(`starts ${day(r.starts_on)}`, r.notes ? text(r.notes) : null),
    edit: [
      { name: "name", label: "Name", kind: "text" },
      { name: "starts_on", label: "Starts", kind: "date" },
      { name: "notes", label: "Notes", kind: "textarea" },
    ],
    deletable: true,
    deleteNote: "Placements in it stay, with no cohort.",
  },
  {
    table: "daymark_closure_days",
    label: "Closure days",
    order: { column: "day" },
    title: (r) => join(day(r.day), text(r.name)),
    subtitle: (r) => LABEL(r.kind),
    edit: [{ name: "name", label: "Name", kind: "text" }],
    deletable: true,
    deleteNote: "Roster days it cancelled are put back.",
  },
  {
    table: "daymark_exit_feedback",
    label: "Exit feedback",
    adminOnly: true,
    order: { column: "submitted_at" },
    title: (r, n) => text(n.placement(r.placement_id)),
    subtitle: (r) => when(r.submitted_at),
    deletable: true,
  },
  {
    table: "daymark_clock_challenges",
    label: "Clock-in codes",
    adminOnly: true,
    order: { column: "issued_at" },
    title: (r, n) => join(n.person(r.person_id), LABEL(r.event_type)),
    subtitle: (r) => join(when(r.issued_at), r.used_at ? "used" : "not used"),
    deletable: true,
  },
  {
    table: "daymark_schedule_history",
    label: "Roster changes",
    order: { column: "changed_at" },
    title: (r, n) => text(n.person(r.changed_by) ?? "System"),
    subtitle: (r) => when(r.changed_at),
    deletable: true,
  },
  {
    table: "daymark_shifts",
    label: "Shifts",
    order: { column: "work_date" },
    title: (r, n) => join(n.placement(r.placement_id), day(r.work_date)),
    subtitle: (r) => join(when(r.clock_in_at), r.clock_out_at ? `to ${when(r.clock_out_at)}` : "still in"),
  },
  {
    table: "daymark_day_results",
    label: "Day hours",
    order: { column: "work_date" },
    title: (r, n) => join(n.placement(r.placement_id), day(r.work_date)),
    subtitle: (r) => `counted ${text(r.counted)} min · worked ${text(r.worked)} min`,
  },
  {
    table: "daymark_consent_records",
    label: "Consent records",
    adminOnly: true,
    order: { column: "recorded_at" },
    title: (r, n) => join(n.person(r.person_id) ?? "Deleted person", LABEL(r.purpose)),
    subtitle: (r) => join(LABEL(r.decision), when(r.recorded_at)),
  },
  {
    table: "daymark_audit_log",
    label: "Audit log",
    adminOnly: true,
    order: { column: "at" },
    title: (r) => join(LABEL(r.action), text(r.table_name)),
    subtitle: (r, n) => join(n.person(r.actor_id) ?? "System", when(r.at)),
  },
  {
    table: "daymark_sites",
    label: "Sites",
    order: { column: "created_at" },
    title: (r) => text(r.name),
    subtitle: (r) => join(text(r.address), `${text(r.radius_m)} m`, !r.active && "inactive"),
  },
];

/** Tables a viewer sees: supervisors get the ones RLS scopes to their interns. */
export function tablesFor(isAdmin: boolean) {
  return RECORD_TABLES.filter((t) => isAdmin || !t.adminOnly);
}

/** A row's key: its id, or the composite key of day results. */
export function rowKey(row: Row) {
  return row.id !== undefined ? String(row.id) : `${String(row.placement_id)}:${String(row.work_date)}`;
}

/** "photo_path" → "Photo path". */
export function columnLabel(column: string) {
  const words = column.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** A cell as plain text for the preview sheet: names for person ids, Darwin times for instants. */
export function displayValue(column: string, value: unknown, names: Names) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  const raw = String(value);
  if (/(^|_)(id|by)$/.test(column) && column !== "id") {
    const name = column === "placement_id" ? names.placement(raw) : names.person(raw);
    if (name) return name;
  }
  if (ISO_INSTANT.test(raw)) return formatDayTime(raw);
  return raw;
}

/** A stored value as the form input shows it. Datetimes are Darwin wall-clock "yyyy-MM-ddTHH:mm". */
export function inputValue(kind: FieldKind, value: unknown) {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  if (kind === "time") return raw.slice(0, 5);
  if (kind === "datetime") {
    const clock = new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Darwin",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(raw));
    return `${darwinDateKey(raw)}T${clock}`;
  }
  return raw;
}

/** The changed fields only, as the database expects them (datetimes as instants). */
export function changedPatch(fields: Field[], row: Row, draft: Record<string, string>) {
  const patch: Record<string, string | number | null> = {};
  for (const field of fields) {
    const next = draft[field.name] ?? "";
    if (next === inputValue(field.kind, row[field.name])) continue;
    if (next.trim() === "") patch[field.name] = null;
    else if (field.kind === "number") patch[field.name] = Number(next);
    else if (field.kind === "datetime") patch[field.name] = darwinAt(next.slice(0, 10), next.slice(11, 16)).toISOString();
    else patch[field.name] = next;
  }
  return patch;
}

export type StoredFile = { bucket: string; path: string };

/** Files to remove, grouped by bucket in chunks the Storage API accepts. */
export function fileBatches(files: StoredFile[], size = 100) {
  const byBucket = new Map<string, string[]>();
  for (const file of files) byBucket.set(file.bucket, [...(byBucket.get(file.bucket) ?? []), file.path]);
  const batches: { bucket: string; paths: string[] }[] = [];
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += size) batches.push({ bucket, paths: paths.slice(i, i + size) });
  }
  return batches;
}

/** "1.5 MB" */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

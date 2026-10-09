import { errorText, PROFILE_COLUMNS, PUNCH_COLUMNS, SHIFT_EVENTS, type Profile, type Punch } from "@/lib/daymark";
import { addDays } from "@/lib/periods";
import { withPhotoUrls } from "@/lib/punches";
import {
  asRecord,
  type AdminKpi,
  type CatchUpSlots,
  type ClockStatus,
  type InternKpi,
  type ProgressRow,
  type RequestPreview,
  type SupervisorKpi,
  type TodayBoard,
} from "@/lib/placement-ui";
import { createClient } from "@/lib/supabase/client";
import type { Database, Json, Tables } from "@/lib/database.types";
import type { ReportInput } from "@/lib/report";

export function unwrap<T>(result: { data: T; error: { message: string } | null }, fallback: string): T {
  if (result.error) throw result.error;
  if (result.data === null || result.data === undefined) throw new Error(fallback);
  return result.data;
}

export async function loadClockStatus(): Promise<ClockStatus | null> {
  const { data, error } = await createClient().rpc("clock_status");
  if (error) throw error;
  const row = asRecord(data);
  return row && typeof row.next_event === "string" ? (data as ClockStatus) : null;
}

export async function loadInternKpi(): Promise<InternKpi | null> {
  const { data, error } = await createClient().rpc("kpi_intern");
  if (error) throw error;
  return asRecord(data) ? (data as InternKpi) : null;
}

export async function loadSupervisorKpi(): Promise<SupervisorKpi> {
  return unwrap(await createClient().rpc("kpi_supervisor"), "Supervisor numbers didn't load.") as SupervisorKpi;
}

export async function loadAdminKpi(): Promise<AdminKpi> {
  return unwrap(await createClient().rpc("kpi_admin"), "Admin numbers didn't load.") as AdminKpi;
}

export async function loadTodayBoard(): Promise<TodayBoard> {
  return unwrap(await createClient().rpc("today_board"), "The today board didn't load.") as TodayBoard;
}

export async function loadCatchUpSlots(placement: string): Promise<CatchUpSlots> {
  return unwrap(await createClient().rpc("catch_up_slots", { placement }), "Free days didn't load.") as CatchUpSlots;
}

export async function previewRequest(req: Record<string, unknown>): Promise<RequestPreview> {
  return unwrap(await createClient().rpc("preview_request", { req: req as Json }), "The preview didn't load.") as RequestPreview;
}

export async function loadNotifications(personId: string, limit = 20) {
  const { data, error } = await createClient()
    .from("daymark_notifications")
    .select("id, title, body, link, created_at, read_at")
    .eq("person_id", personId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function unreadNotificationCount(personId: string) {
  const { count, error } = await createClient()
    .from("daymark_notifications")
    .select("id", { count: "exact", head: true })
    .eq("person_id", personId)
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

export async function loadMyPlacement() {
  const { data, error } = await createClient()
    .from("daymark_placements")
    .select(
      "id, intern_id, supervisor_id, status, start_date, planned_end_date, ended_on, target_minutes, university, course, report_approved_at, report_approved_by, report_approval_note, site_id",
    )
    .in("status", ["active", "extended", "target_reached", "completed", "withdrawn"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadScheduledDays(placementId: string, from: string, to: string) {
  const { data, error } = await createClient()
    .from("daymark_scheduled_days")
    .select("id, work_date, start_time, end_time, planned_minutes, status, leave_kind, source")
    .eq("placement_id", placementId)
    .gte("work_date", from)
    .lte("work_date", to)
    .order("work_date");
  if (error) throw error;
  return data ?? [];
}

/** Who is rostered between two dates (§ roster): admins see everyone, a supervisor their own interns. */
export async function loadRoster(from: string, to: string, supervisorId?: string) {
  let query = createClient()
    .from("daymark_scheduled_days")
    .select(
      "id, work_date, start_time, end_time, status, leave_kind, placement:daymark_placements!inner(id, supervisor_id, intern:daymark_profiles!daymark_placements_intern_id_fkey(id, display_name))",
    )
    .in("status", ["scheduled", "leave"])
    .gte("work_date", from)
    .lte("work_date", to);
  if (supervisorId) query = query.eq("placement.supervisor_id", supervisorId);
  const { data, error } = await query.order("work_date").order("start_time");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    work_date: row.work_date,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    leave_kind: row.leave_kind,
    placement_id: row.placement.id,
    intern_id: row.placement.intern?.id ?? "",
    intern_name: row.placement.intern?.display_name ?? "Intern",
  }));
}

export type RosterRow = Awaited<ReturnType<typeof loadRoster>>[number];

/** Banners the signed-in person should see now (admin's to everyone, their supervisor's to them). */
export async function loadCurrentBanners() {
  const { data, error } = await createClient().rpc("current_banners");
  if (error) throw error;
  return data ?? [];
}

/** Banners the signed-in person can manage: their own, or every banner for an admin. */
export async function loadManagedBanners() {
  const { data, error } = await createClient()
    .from("daymark_banners")
    .select("*, author:daymark_profiles!daymark_banners_created_by_fkey(display_name)")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

export type Banner = Awaited<ReturnType<typeof loadCurrentBanners>>[number];

/** Live placements the signed-in staff member can change: all for an admin, their own for a supervisor. */
export async function loadManagedPlacements(supervisorId?: string) {
  let query = createClient()
    .from("daymark_placements")
    .select("id, start_date, planned_end_date, intern:daymark_profiles!daymark_placements_intern_id_fkey(display_name)")
    .in("status", ["active", "extended", "target_reached"]);
  if (supervisorId) query = query.eq("supervisor_id", supervisorId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? [])
    .map((row) => ({
      id: row.id,
      intern_name: row.intern?.display_name ?? "Intern",
      start_date: row.start_date,
      planned_end_date: row.planned_end_date,
    }))
    .sort((a, b) => a.intern_name.localeCompare(b.intern_name));
}

export type ManagedPlacement = Awaited<ReturnType<typeof loadManagedPlacements>>[number];

/**
 * Timesheets (Dilip, 5 Oct): a week of clock-ins, breaks and clock-outs for every intern the viewer
 * manages (admin: all; supervisor: their own), with day totals and who edited what. Punches replaced
 * by a punch fix or a staff edit are hidden; the replacement shows instead.
 */
export async function loadTimesheet(from: string, to: string, supervisorId?: string) {
  const supabase = createClient();
  let placementQuery = supabase
    .from("daymark_placements")
    .select("id, intern_id, status, start_date, planned_end_date, intern:daymark_profiles!daymark_placements_intern_id_fkey(display_name)");
  if (supervisorId) placementQuery = placementQuery.eq("supervisor_id", supervisorId);
  const { data: placementRows, error: placementError } = await placementQuery;
  if (placementError) throw placementError;
  const placements = (placementRows ?? [])
    .map((row) => ({
      id: row.id,
      intern_id: row.intern_id,
      status: row.status,
      start_date: row.start_date,
      planned_end_date: row.planned_end_date,
      intern_name: row.intern?.display_name ?? "Intern",
    }))
    .sort((a, b) => a.intern_name.localeCompare(b.intern_name));
  const ids = placements.map((row) => row.id);
  if (ids.length === 0) {
    return { placements, punches: [], results: [], editors: {} as Record<string, string>, kinds: [], absences: [] };
  }

  const [punchResult, resultResult, kindResult, absentResult] = await Promise.all([
    supabase
      .from("daymark_punches")
      .select(`${PUNCH_COLUMNS}, placement_id, replaces_punch_id, confirmed_by, confirmed_at`)
      .in("placement_id", ids)
      .in("event_type", SHIFT_EVENTS)
      .gte("occurred_at", `${from}T00:00:00+09:30`)
      .lt("occurred_at", `${addDays(to, 1)}T00:00:00+09:30`)
      .order("occurred_at"),
    supabase
      .from("daymark_day_results")
      .select("placement_id, work_date, counted, scheduled, raw, break, worked, late, auto_closed, unscheduled, unverified")
      .in("placement_id", ids)
      .gte("work_date", from)
      .lte("work_date", to),
    supabase.from("daymark_day_kinds").select("placement_id, work_date, kind, status").in("placement_id", ids).gte("work_date", from).lte("work_date", to),
    supabase
      .from("daymark_scheduled_days")
      .select("placement_id, work_date, leave_kind")
      .in("placement_id", ids)
      .eq("status", "leave")
      .eq("leave_kind", "absent")
      .gte("work_date", from)
      .lte("work_date", to),
  ]);
  for (const result of [punchResult, resultResult, kindResult, absentResult]) if (result.error) throw result.error;
  const rows = (punchResult.data ?? []) as (Punch & {
    placement_id: string;
    replaces_punch_id: string | null;
    confirmed_by: string | null;
    confirmed_at: string | null;
  })[];
  const replaced = new Set(rows.map((row) => row.replaces_punch_id).filter(Boolean));
  const punches = await withPhotoUrls(rows.filter((row) => !replaced.has(row.id)));

  const editorIds = [...new Set(punches.filter((row) => row.source === "staff_edit" && row.confirmed_by).map((row) => row.confirmed_by!))];
  const editors: Record<string, string> = {};
  if (editorIds.length > 0) {
    const { data: people } = await supabase.from("daymark_profiles").select("id, display_name").in("id", editorIds);
    for (const person of people ?? []) editors[person.id] = person.display_name;
  }
  return { placements, punches, results: resultResult.data ?? [], editors, kinds: kindResult.data ?? [], absences: absentResult.data ?? [] };
}

export type Timesheet = Awaited<ReturnType<typeof loadTimesheet>>;

export async function loadDayResults(placementId: string, from: string, to: string) {
  const { data, error } = await createClient()
    .from("daymark_day_results")
    .select("work_date, counted, scheduled, raw, break, worked, short, late, no_show, auto_closed, unscheduled, closed")
    .eq("placement_id", placementId)
    .gte("work_date", from)
    .lte("work_date", to)
    .order("work_date");
  if (error) throw error;
  return data ?? [];
}

export async function loadHeadcounts(from: string, to: string, site?: string) {
  const { data, error } = await createClient().rpc("site_headcounts", { from_date: from, to_date: to, ...(site ? { site } : {}) });
  if (error) throw error;
  return data ?? [];
}

export async function loadClosures(from: string, to: string) {
  const { data, error } = await createClient()
    .from("daymark_closure_days")
    .select("day, name")
    .gte("day", from)
    .lte("day", to)
    .order("day");
  if (error) throw error;
  return data ?? [];
}

export async function loadRequestsForPlacement(placementId: string) {
  const { data, error } = await createClient()
    .from("daymark_requests")
    .select("*")
    .eq("placement_id", placementId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function loadInbox(status?: string) {
  let query = createClient()
    .from("daymark_requests")
    .select("*, daymark_profiles!daymark_requests_intern_id_fkey(display_name)")
    .order("created_at", { ascending: true });
  if (status) query = query.eq("status", status);
  else query = query.in("status", ["pending_supervisor", "pending_admin"]);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as (Tables<"daymark_requests"> & { daymark_profiles: { display_name: string } | null })[];
}

/** Status and age of every request the caller can see (admin: all), for the Progress charts. */
export async function loadRequestStatuses() {
  // ponytail: two short columns per request; add a date floor once the table runs to thousands.
  const { data, error } = await createClient().from("daymark_requests").select("status, created_at");
  if (error) throw error;
  return data ?? [];
}

export async function loadProgressForSupervisor(): Promise<ProgressRow[]> {
  const { data, error } = await createClient().rpc("progress_for_supervisor");
  if (error) throw error;
  return (data ?? []).map((row) => row as ProgressRow);
}

export async function loadProgressAll(): Promise<ProgressRow[]> {
  const { data, error } = await createClient().rpc("progress_all");
  if (error) throw error;
  return (data ?? []).map((row) => row as ProgressRow);
}

export async function loadPlacement(id: string) {
  const { data, error } = await createClient()
    .from("daymark_placements")
    .select(
      "*, intern:daymark_profiles!daymark_placements_intern_id_fkey(display_name, contact_email), supervisor:daymark_profiles!daymark_placements_supervisor_id_fkey(display_name), cohort:daymark_cohorts(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadPlacements() {
  const { data, error } = await createClient()
    .from("daymark_placements")
    .select(
      "id, intern_id, supervisor_id, cohort_id, status, start_date, planned_end_date, target_minutes, university, course, intern:daymark_profiles!daymark_placements_intern_id_fkey(display_name), supervisor:daymark_profiles!daymark_placements_supervisor_id_fkey(display_name), cohort:daymark_cohorts(name)",
    )
    .order("start_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function loadCohorts() {
  const { data, error } = await createClient().from("daymark_cohorts").select("id, name, starts_on, notes").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function loadPeopleDirectory() {
  const { data, error } = await createClient().rpc("people_directory");
  if (error) throw error;
  return data ?? [];
}

export async function loadProfiles(): Promise<Profile[]> {
  const { data, error } = await createClient().from("daymark_profiles").select(PROFILE_COLUMNS).order("display_name");
  if (error) throw error;
  return data ?? [];
}

export async function loadWorkLogs(placementId: string) {
  const { data, error } = await createClient()
    .from("daymark_work_logs")
    .select("work_date, summary")
    .eq("placement_id", placementId)
    .order("work_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** The two settings every signed-in screen needs (idle sign-out, certificate retention). */
export async function loadSessionSettings() {
  const { data, error } = await createClient()
    .from("daymark_settings")
    .select("idle_signout_minutes, cert_retention_days")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadCertRetentionDays() {
  return (await loadSessionSettings())?.cert_retention_days;
}

/** The current fortnight's totals (visa self-check); zeros before any day in it has a result. */
export async function loadPlacementProgress(placementId: string) {
  const { data, error } = await createClient().rpc("placement_progress", { placement: placementId });
  if (error) throw error;
  return asRecord(data) ? (data as unknown as Tables<"daymark_v_placement_progress">) : null;
}

export async function loadWeekHours(placementId: string) {
  const { data, error } = await createClient()
    .from("daymark_v_week_hours")
    .select("week_no, week_start, counted, scheduled")
    .eq("placement_id", placementId)
    .order("week_start");
  if (error) throw error;
  return data ?? [];
}

/** An intern's clock-ins and clock-outs, oldest first, including punches a fix or staff edit replaced. */
export async function loadPunchesForPlacement(internId: string, from: string, to: string) {
  const { data, error } = await createClient()
    .from("daymark_punches")
    .select(`${PUNCH_COLUMNS}, replaces_punch_id, confirmed_at`)
    .eq("user_id", internId)
    .in("event_type", SHIFT_EVENTS)
    .gte("occurred_at", from)
    .lte("occurred_at", to)
    .order("occurred_at");
  if (error) throw error;
  return (data ?? []) as (Punch & { replaces_punch_id: string | null; confirmed_at: string | null })[];
}

/** Full day / work-based choices for one placement (8 Oct). */
export async function loadDayKinds(placementId: string, from: string, to: string) {
  const { data, error } = await createClient()
    .from("daymark_day_kinds")
    .select("work_date, kind, status")
    .eq("placement_id", placementId)
    .gte("work_date", from)
    .lte("work_date", to);
  if (error) throw error;
  return data ?? [];
}

export async function markNotificationsRead(ids?: string[]) {
  const { error } = await createClient().rpc("mark_notifications_read", ids ? { ids } : {});
  if (error) throw error;
}

export async function loadSites() {
  const { data, error } = await createClient()
    .from("daymark_sites")
    .select(
      "id, name, address, latitude, longitude, radius_m, standard_capacity, hard_capacity, window_start, window_end, active",
    )
    .order("name");
  if (error) throw error;
  return data ?? [];
}

/** Every closure day, oldest first, with its site's name (null site = every site). */
export async function loadClosureDays() {
  const { data, error } = await createClient()
    .from("daymark_closure_days")
    .select("id, day, name, kind, site_id, site:daymark_sites(name)")
    .order("day");
  if (error) throw error;
  return data ?? [];
}

/** The settings singleton and the collection notice it points at. */
export async function loadSettings() {
  const client = createClient();
  const { data: settings, error: settingsError } = await client.from("daymark_settings").select("*").eq("id", 1).maybeSingle();
  if (settingsError) throw settingsError;
  if (!settings) throw new Error("Settings didn't load.");
  const { data: notice, error } = await client
    .from("daymark_notices")
    .select("version, title, published_at")
    .eq("version", settings.notice_version)
    .maybeSingle();
  if (error) throw error;
  return { settings, notice };
}

/** Who has reminders on (D40): person id -> device type. A person with no phone isn't in the map. */
export async function loadReminderStatus() {
  const { data, error } = await createClient().rpc("reminder_status");
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.person_id, { device: row.device, lastOk: row.last_ok_at }]));
}

/** Settings → Notifications (D37): what goes to phones, and each active intern's break. */
export async function loadNotificationSettings() {
  const client = createClient();
  const [settings, placements] = await Promise.all([
    client.from("daymark_settings").select("push_kinds").eq("id", 1).maybeSingle(),
    client
      .from("daymark_placements")
      .select("id, break_minutes, intern:daymark_profiles!daymark_placements_intern_id_fkey(display_name)")
      .in("status", ["active", "extended"]),
  ]);
  if (settings.error) throw settings.error;
  if (placements.error) throw placements.error;
  return {
    kinds: settings.data?.push_kinds ?? [],
    interns: (placements.data ?? [])
      .map((row) => ({ id: row.id, name: row.intern?.display_name ?? "Intern", breakMinutes: row.break_minutes }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export type AuditEntry = {
  id: number;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  table_name: string;
  row_id: string | null;
  before: Json | null;
  after: Json | null;
};

export async function searchAudit(args: Database["public"]["Functions"]["audit_search"]["Args"]) {
  const data = unwrap(await createClient().rpc("audit_search", args), "The audit log didn't load.");
  return data as { rows: AuditEntry[]; next_before_id: number | null };
}

export async function loadExitFeedback(placementId: string) {
  const { data, error } = await createClient()
    .from("daymark_exit_feedback")
    .select("answers, submitted_at")
    .eq("placement_id", placementId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadCheckins(placementId: string) {
  const { data, error } = await createClient()
    .from("daymark_checkins")
    .select("id, week_start, reliability, quality, communication, comment, updated_at")
    .eq("placement_id", placementId)
    .order("week_start", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function saveCheckin(args: {
  placement: string;
  week_start: string;
  reliability: number;
  quality: number;
  communication: number;
  comment?: string;
}) {
  const { error } = await createClient().rpc("save_checkin", args);
  if (error) throw error;
}

export async function loadCheckinsDue() {
  const { data, error } = await createClient().rpc("checkins_due");
  if (error) throw error;
  return data ?? [];
}

export async function loadMondaySummary(weekStart: string) {
  const { data, error } = await createClient().rpc("monday_summary", { week_start: weekStart });
  if (error) throw error;
  return data ?? [];
}

export async function loadFlaggedEvents(from: string, to: string) {
  const { data, error } = await createClient().rpc("flagged_events", { from_date: from, to_date: to });
  if (error) throw error;
  return data ?? [];
}

/** Everything the intern report and certificate need (§13), read under the caller's RLS. */
export async function loadReportData(placementId: string): Promise<Omit<ReportInput, "generatedAt" | "documentId">> {
  const client = createClient();
  const { data: placement, error: placementError } = await client
    .from("daymark_placements")
    .select(
      "id, intern_id, supervisor_id, status, start_date, planned_end_date, ended_on, target_minutes, university, course, uni_coordinator_name, report_approved_at, report_approved_by, report_approval_note",
    )
    .eq("id", placementId)
    .single();
  if (placementError) throw placementError;
  const [weeks, days, punches, requests] = await Promise.all([
    client
      .from("daymark_v_week_hours")
      .select("week_no, week_start, scheduled, counted, approved_ot, no_shows, late_days")
      .eq("placement_id", placementId)
      .order("week_start"),
    client
      .from("daymark_day_results")
      .select("work_date, counted, worked, approved_ot")
      .eq("placement_id", placementId)
      .order("work_date"),
    client
      .from("daymark_punches")
      .select("id, occurred_at, source, verification_method, confirmed_by, replaces_punch_id")
      .eq("placement_id", placementId)
      .order("occurred_at"),
    client
      .from("daymark_requests")
      .select("type, status, dates, supervisor_id, admin_id, admin_decision")
      .eq("placement_id", placementId)
      .in("type", ["overtime", "punch_fix"])
      .eq("status", "approved"),
  ]);
  for (const result of [weeks, days, punches, requests]) if (result.error) throw result.error;
  const ids = new Set<string>([placement.intern_id, placement.supervisor_id]);
  if (placement.report_approved_by) ids.add(placement.report_approved_by);
  for (const punch of punches.data ?? []) if (punch.confirmed_by) ids.add(punch.confirmed_by);
  for (const request of requests.data ?? []) {
    if (request.supervisor_id) ids.add(request.supervisor_id);
    if (request.admin_id) ids.add(request.admin_id);
  }
  const { data: people, error } = await client.from("daymark_profiles").select("id, display_name").in("id", [...ids]);
  if (error) throw error;
  const names: Record<string, string> = Object.fromEntries((people ?? []).map((p) => [p.id, p.display_name]));
  return {
    placement,
    internName: names[placement.intern_id] ?? "Intern",
    weeks: weeks.data ?? [],
    days: days.data ?? [],
    punches: punches.data ?? [],
    requests: requests.data ?? [],
    names,
  };
}

export function dataError(error: unknown) {
  return errorText(error, "That didn't load. Try again.");
}

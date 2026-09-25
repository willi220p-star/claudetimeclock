import { errorText, PROFILE_COLUMNS, type Profile } from "@/lib/daymark";
import {
  asRecord,
  type AdminKpi,
  type CatchUpPlan,
  type ClockStatus,
  type InternKpi,
  type ProgressRow,
  type RequestPreview,
  type SupervisorKpi,
  type TodayBoard,
} from "@/lib/placement-ui";
import { createClient } from "@/lib/supabase/client";
import type { Database, Json, Tables } from "@/lib/database.types";

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

export async function loadCatchUp(placement: string): Promise<CatchUpPlan> {
  return unwrap(await createClient().rpc("catch_up_options", { placement }), "Catch-up options didn't load.") as CatchUpPlan;
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

export async function loadHeadcounts(from: string, to: string) {
  const { data, error } = await createClient().rpc("site_headcounts", { from_date: from, to_date: to });
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
export async function loadFortnightHours(placementId: string, fortnightStart: string) {
  const { data, error } = await createClient()
    .from("daymark_v_fortnight_hours")
    .select("counted, scheduled, worked")
    .eq("placement_id", placementId)
    .eq("fortnight_start", fortnightStart)
    .maybeSingle();
  if (error) throw error;
  return { counted: data?.counted ?? 0, scheduled: data?.scheduled ?? 0, worked: data?.worked ?? 0 };
}

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

export async function loadPunchesForPlacement(internId: string, from: string, to: string) {
  const { data, error } = await createClient()
    .from("daymark_punches")
    .select("id, occurred_at, photo_path, event_type, flags")
    .eq("user_id", internId)
    .gte("occurred_at", from)
    .lte("occurred_at", to)
    .order("occurred_at");
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

export function dataError(error: unknown) {
  return errorText(error, "That didn't load. Try again.");
}

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
import type { Json, Tables } from "@/lib/database.types";
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
    .select("id, name, standard_capacity, hard_capacity, active")
    .order("name");
  if (error) throw error;
  return data ?? [];
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

/** Everything the uni report and certificate need (§13), read under the caller's RLS. */
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

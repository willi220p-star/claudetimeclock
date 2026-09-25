import { differenceInMinutes } from "date-fns";
import {
  loadInbox,
  loadProgressForSupervisor,
  loadSupervisorKpi,
  loadTodayBoard,
  previewRequest,
} from "@/lib/data";
import { asRecord, owedLabel, type ProgressRow, type RequestPreview, type TodayPerson } from "@/lib/placement-ui";
import { plannedMinutes } from "@/lib/minutes";
import type { Tables } from "@/lib/database.types";

export type InboxItem = Tables<"daymark_requests"> & {
  daymark_profiles: { display_name: string } | null;
  preview: RequestPreview | null;
};

export function embedName(value: unknown): string | null {
  const row = asRecord(Array.isArray(value) ? value[0] : value);
  return row && typeof row.display_name === "string" ? row.display_name : null;
}

export function internName(row: { daymark_profiles?: { display_name: string } | null }): string {
  return row.daymark_profiles?.display_name ?? "Intern";
}

export function ageHours(createdAt: string, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 3_600_000));
}

export function ageClass(hours: number, escalatedAt: string | null) {
  if (escalatedAt) return "text-bad";
  if (hours > 48) return "text-warn";
  return "text-muted-foreground";
}

export function previewLine(preview: RequestPreview | null, fallback?: string | null) {
  if (preview?.effects[0]) return preview.effects[0];
  if (preview?.message) return preview.message;
  return fallback?.trim() || "—";
}

export function pctText(value: number | null | undefined) {
  return value == null ? "—" : `${value}%`;
}

export function forecastText(row: Pick<ProgressRow, "forecast_finish" | "days_late" | "planned_end_date">, format: (d: string) => string) {
  if (!row.forecast_finish) return "Can't forecast a finish date.";
  const finish = format(row.forecast_finish);
  const plan = format(row.planned_end_date);
  if (row.days_late == null) return `Finishes ${finish} vs ${plan}`;
  if (row.days_late < 0) return `Finishes ${finish} · ${-row.days_late === 1 ? "1 day" : `${-row.days_late} days`} early`;
  if (row.days_late === 0) return `Finishes ${finish} · on plan`;
  return `Finishes ${finish} · ${row.days_late === 1 ? "1 day" : `${row.days_late} days`} late`;
}

export function owedText(minutes: number) {
  return owedLabel(minutes);
}

export function boardHours(person: TodayPerson, now = new Date()) {
  if (person.status === "in" && person.since) {
    return Math.max(0, differenceInMinutes(now, new Date(person.since)));
  }
  if (person.start && person.end) return plannedMinutes(person.start, person.end);
  return null;
}

export function boardStatusKey(person: TodayPerson) {
  if (person.unscheduled && person.status !== "in" && person.status !== "done") return "unscheduled";
  return person.status;
}

export async function loadSupervisorInbox(): Promise<InboxItem[]> {
  const rows = await loadInbox("pending_supervisor");
  return Promise.all(
    rows.map(async (row) => {
      try {
        return { ...row, preview: await previewRequest({ id: row.id }) };
      } catch {
        return { ...row, preview: null };
      }
    }),
  );
}

export async function loadTodayDesk() {
  const [kpi, board, inbox, progress] = await Promise.all([
    loadSupervisorKpi(),
    loadTodayBoard(),
    loadSupervisorInbox(),
    loadProgressForSupervisor(),
  ]);
  return { kpi, board, inbox, progress };
}

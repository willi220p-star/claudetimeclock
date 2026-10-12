import type { Tone } from "@/components/status-chip";
import { formatMinutes } from "@/components/tasks/task-helpers";
import type { Database } from "@/lib/database.types";

type Fns = Database["public"]["Functions"];
type Nullable = "client_name" | "start_date" | "due_date" | "lead_name" | "next_milestone" | "next_milestone_due";
/** The generator marks every function column non-null; these can be null at runtime. */
export type ProjectCard = Omit<Fns["my_projects"]["Returns"][number], Nullable> & { [K in Nullable]: string | null };
export type ActivityRow = Fns["project_activity"]["Returns"][number] & { actor_name: string | null };
export type Lookup = Omit<Fns["project_lookup"]["Returns"][number], "client_name"> & { client_name: string | null };

/** `project_detail(id)` (D49). */
export type ProjectDetail = {
  project: {
    id: string;
    name: string;
    client_name: string | null;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    start_date: string | null;
    due_date: string | null;
    status: string;
    description: string | null;
    links: string[] | null;
    lead_id: string | null;
    lead_name: string | null;
    approved_at: string | null;
    created_by: string | null;
    created_by_name: string | null;
    archived_at: string | null;
  };
  members: { id: string; name: string }[];
  milestones: { id: string; name: string; due_date: string | null; tasks_total: number; tasks_done: number; done: boolean }[];
};

export type ProjectStatus = "planning" | "active" | "on_hold" | "completed";
export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: Tone }> = {
  planning: { label: "Planning", tone: "neutral" },
  active: { label: "Active", tone: "ok" },
  on_hold: { label: "On hold", tone: "warn" },
  completed: { label: "Completed", tone: "info" },
};
export const PROJECT_STATUSES = Object.keys(PROJECT_STATUS) as ProjectStatus[];
export const statusOf = (status: string) => PROJECT_STATUS[status as ProjectStatus] ?? { label: status, tone: "neutral" as Tone };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "31 Oct" from a date key. */
export function shortDate(key: string) {
  const [, month, day] = key.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

/** Done copies out of all copies (D49): "7 of 12 tasks done" and a whole percent; "No tasks yet" when empty. */
export function projectProgress(done: number, total: number) {
  if (total <= 0) return { percent: 0, text: "No tasks yet" };
  const clamped = Math.min(Math.max(done, 0), total);
  return { percent: Math.round((clamped / total) * 100), text: `${clamped} of ${total} tasks done` };
}

/** "18 h of 26 h", "18 h spent" with no estimate, null when there's nothing to say. */
export function hoursText(spent: number, estimate: number) {
  if (estimate > 0) return `${formatMinutes(spent)} of ${formatMinutes(estimate)}`;
  return spent > 0 ? `${formatMinutes(spent)} spent` : null;
}

/** "1 Sep to 31 Oct", "From 1 Sep", "Due 31 Oct" or null. */
export function dateRange(start: string | null, due: string | null) {
  if (start && due) return `${shortDate(start)} to ${shortDate(due)}`;
  if (start) return `From ${shortDate(start)}`;
  return due ? `Due ${shortDate(due)}` : null;
}

/** The project form's link rows: blanks dropped; at most 5, each https:// and up to 500 characters (save_project). */
export function checkLinks(rows: string[]): { links: string[] } | { error: string } {
  const links = rows.map((row) => row.trim()).filter(Boolean);
  if (links.length > 5) return { error: "Keep it to 5 links." };
  const bad = links.find((link) => !/^https:\/\/\S+$/.test(link));
  if (bad) return { error: `Links must start with https:// (check "${bad.slice(0, 40)}").` };
  if (links.some((link) => link.length > 500)) return { error: "Keep each link under 500 characters." };
  return { links };
}

/** The search box: name or client contains the text, ignoring case. */
export function filterProjects<T extends { name: string; client_name: string | null }>(rows: T[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => row.name.toLowerCase().includes(q) || (row.client_name ?? "").toLowerCase().includes(q));
}

/**
 * One activity line (D49). `text` is the thing acted on: a task title, a person, a milestone or the new status.
 * The database writes the actor's name at the time, so a removed person still reads right.
 */
export function activitySentence(row: { actor_name: string | null; kind: string; text: string }) {
  const who = row.actor_name ?? "Someone";
  const what = row.text;
  switch (row.kind) {
    case "task_added":
      return `${who} added ${what}`;
    case "task_done":
      return `${who} finished ${what}`;
    case "review_approved":
      return `${who} approved ${what}`;
    case "changes_asked":
      return `${who} asked for changes on ${what}`;
    case "status_changed":
      return `${who} set the status to ${statusOf(what).label}`;
    case "member_added":
      return `${who} added ${what} to the team`;
    case "milestone_added":
      return `${who} added the milestone ${what}`;
    case "milestone_done":
      return `Milestone ${what} done`;
    case "project_created":
      return `${who} created the project`;
    case "project_approved":
      return `${who} approved the project`;
    default:
      return what ? `${who}: ${what}` : who;
  }
}

/** "Lead Dilip, with Sushant and Vipashyana". */
export function teamText(lead: string | null, members: string[]) {
  const others = members.filter((name) => name !== lead);
  const list = others.length <= 1 ? others.join("") : `${others.slice(0, -1).join(", ")} and ${others.at(-1)}`;
  if (lead && list) return `Lead ${lead}, with ${list}`;
  if (lead) return `Lead ${lead}`;
  return list ? `With ${list}` : "No team yet";
}


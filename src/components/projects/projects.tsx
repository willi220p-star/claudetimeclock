"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronLeft, Mail, Phone, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/app/admin/confirm-dialog";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { FormMessage } from "@/components/form-field";
import { LoadBlock } from "@/components/load-block";
import { ProjectForm } from "@/components/projects/project-form";
import {
  activitySentence,
  dateRange,
  filterProjects,
  hoursText,
  projectProgress,
  shortDate,
  statusOf,
  teamText,
  type ActivityRow,
  type ProjectCard,
  type ProjectDetail,
} from "@/components/projects/project-helpers";
import { StatusChip } from "@/components/status-chip";
import { TaskForm } from "@/components/tasks/task-form";
import { formatMinutes, sortTasks, type TaskItem, type Viewer } from "@/components/tasks/task-helpers";
import { TaskBoard, TaskRow, useWide, ViewSwitch, type View } from "@/components/tasks/task-parts";
import { besidePanel, loadMyTasks, loadStaffTasks, useTaskView } from "@/components/tasks/tasks";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDayTime } from "@/lib/darwin";
import { errorText } from "@/lib/daymark";
import { knownParam } from "@/lib/placement-ui";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";

export type ProjectsBase = "/clock/projects" | "/admin/projects" | "/supervisor/projects";

const group = "overflow-hidden rounded-xl bg-card shadow-card";
const heading = "mx-1 text-[15px] font-semibold text-muted-foreground";

async function loadMe() {
  const { data } = await createClient().auth.getClaims();
  return data?.claims?.sub ?? null;
}

async function loadProjects() {
  const { data, error } = await createClient().rpc("my_projects");
  if (error) throw error;
  return (data ?? []) as ProjectCard[];
}

function ProgressBar({ percent, className }: { percent: number; className?: string }) {
  return (
    <span aria-hidden className={cn("flex h-2 overflow-hidden rounded-full bg-muted", className)}>
      <span className="rounded-full bg-primary" style={{ width: `${percent}%` }} />
    </span>
  );
}

/** One project as a card (Projects mockup). A waiting project is dashed and says what happens next. */
function ProjectCardLink({ project, href, staff }: { project: ProjectCard; href: string; staff: boolean }) {
  const progress = projectProgress(project.tasks_done, project.tasks_total);
  const hours = hoursText(project.spent_minutes, project.estimate_minutes);
  const status = statusOf(project.status);
  const byline = [project.client_name, project.lead_name ? `lead ${project.lead_name}` : null].filter(Boolean).join(" · ");
  return (
    <li>
      <Link
        href={href}
        className={cn(
          "flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card transition-colors hover:bg-muted/40",
          project.waiting ? "border-[1.5px] border-dashed border-input" : null,
        )}
      >
        <span className="flex items-start justify-between gap-2.5">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-lg font-bold">{project.name}</span>
            {byline ? <span className="text-sm text-muted-foreground">{byline}</span> : null}
          </span>
          {project.waiting ? (
            <StatusChip tone="neutral" label="Waiting for approval" />
          ) : (
            <StatusChip tone={status.tone} label={status.label} />
          )}
        </span>
        {project.waiting ? (
          <span className="text-sm text-muted-foreground">
            {staff
              ? "Waiting for your approval below."
              : "Your supervisor has been told. You can add tasks once it's approved."}
          </span>
        ) : (
          <>
            <span className="flex flex-col gap-1.5">
              <span className="flex justify-between gap-2 text-sm">
                <span className="font-semibold">{progress.text}</span>
                {project.due_date ? <span className="text-muted-foreground">Due {shortDate(project.due_date)}</span> : null}
              </span>
              <ProgressBar percent={progress.percent} />
            </span>
            {hours || project.overdue || project.blocked || project.next_milestone ? (
              <span className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-muted-foreground">
                {hours ? <span>{hours}</span> : null}
                {project.overdue ? <span className="font-semibold text-bad">{project.overdue} overdue</span> : null}
                {project.blocked ? <span className="font-semibold text-bad">{project.blocked} blocked</span> : null}
                {project.next_milestone ? (
                  <span>
                    Next: {project.next_milestone}
                    {project.next_milestone_due ? `, ${shortDate(project.next_milestone_due)}` : ""}
                  </span>
                ) : null}
              </span>
            ) : null}
          </>
        )}
      </Link>
    </li>
  );
}

/** Projects (D49): the intern tab and the staff pages. Staff also get "Approve projects". */
export function ProjectsList({ base, staff }: { base: ProjectsBase; staff: boolean }) {
  const router = useRouter();
  const [state, reload] = useLoad(loadProjects);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const rows = state.status === "ready" ? state.data : [];
  const toApprove = staff ? rows.filter((row) => row.waiting) : [];
  const shown = filterProjects(
    rows.filter((row) => !staff || !row.waiting),
    query,
  );
  const add = (
    <Button type="button" onClick={() => setAdding(true)}>
      <Plus aria-hidden />
      Project
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1>Projects</h1>
        {add}
      </div>
      {toApprove.length > 0 ? <ApproveProjects rows={toApprove} base={base} onChanged={reload} /> : null}
      {rows.length > 3 || query ? (
        <div className="relative">
          <Label htmlFor="project-search" className="sr-only">
            Search projects
          </Label>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="project-search"
            type="search"
            placeholder="Search projects or clients"
            className="border-0 bg-muted pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      ) : null}
      <LoadBlock state={state} reload={reload}>
        {() =>
          shown.length === 0 ? (
            query ? (
              <EmptyState>No projects match &ldquo;{query.trim()}&rdquo;.</EmptyState>
            ) : (
              <EmptyState
                action={
                  <Button type="button" variant="secondary" onClick={() => setAdding(true)}>
                    Add a project
                  </Button>
                }
              >
                {staff
                  ? "No projects yet. Add one for a client, then give its tasks to your interns."
                  : "No projects yet. Add one for a client and file your tasks under it."}
              </EmptyState>
            )
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {shown.map((project) => (
                <ProjectCardLink key={project.id} project={project} href={`${base}/view?id=${project.id}`} staff={staff} />
              ))}
            </ul>
          )
        }
      </LoadBlock>
      {adding ? (
        <ProjectForm
          open
          staff={staff}
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            if (id) router.push(`${base}/view?id=${id}`);
            else reload();
          }}
        />
      ) : null}
    </div>
  );
}

/** Staff: interns' projects waiting for approval. Decline asks for a note, which goes to the intern. */
function ApproveProjects({ rows, base, onChanged }: { rows: ProjectCard[]; base: ProjectsBase; onChanged: () => void }) {
  const [declining, setDeclining] = useState<ProjectCard | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function approve(project: ProjectCard) {
    setBusy(project.id);
    const { error } = await createClient().rpc("approve_project", { id: project.id, approve: true });
    setBusy(null);
    if (error) toast.error(errorText(error, "That didn't save. Try again."));
    else {
      toast.success(`${project.name} approved.`);
      onChanged();
    }
  }

  return (
    <section aria-labelledby="approve-projects" className="flex flex-col gap-1.5">
      <h2 id="approve-projects" className={heading}>
        Approve projects
      </h2>
      <ul className={cn(group, "divide-y divide-border")}>
        {rows.map((project) => (
          <li key={project.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Link href={`${base}/view?id=${project.id}`} className="flex min-h-11 min-w-0 flex-1 flex-col justify-center">
              <span className="font-semibold">{project.name}</span>
              <span className="text-sm text-muted-foreground">
                {[project.client_name, project.lead_name ? `lead ${project.lead_name}` : null, dateRange(project.start_date, project.due_date)]
                  .filter(Boolean)
                  .join(" · ") || "No details yet"}
              </span>
            </Link>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                aria-label={`Decline ${project.name}`}
                disabled={busy === project.id}
                onClick={() => {
                  setNote("");
                  setDeclining(project);
                }}
              >
                Decline
              </Button>
              <Button type="button" aria-label={`Approve ${project.name}`} disabled={busy === project.id} onClick={() => void approve(project)}>
                Approve
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={declining !== null}
        title={`Decline ${declining?.name ?? "project"}?`}
        description="The project is archived and the intern gets your note."
        confirmLabel="Decline"
        destructive
        onCancel={() => setDeclining(null)}
        onConfirm={async () => {
          if (!declining) return null;
          if (!note.trim()) return "Write a short note so they know why.";
          const { error } = await createClient().rpc("approve_project", { id: declining.id, approve: false, note: note.trim() });
          if (error) return errorText(error, "That didn't save. Try again.");
          toast.success(`${declining.name} declined.`);
          setDeclining(null);
          onChanged();
          return null;
        }}
      >
        <div className="mt-4 flex flex-col gap-1">
          <Label htmlFor="decline-note">Note to the intern</Label>
          <textarea
            id="decline-note"
            rows={3}
            maxLength={500}
            className="rounded-md border border-input bg-card px-3 py-2"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </ConfirmDialog>
    </section>
  );
}

type Tab = "overview" | "tasks" | "activity";

async function loadProject(id: string) {
  const [{ data, error }, cards, me] = await Promise.all([createClient().rpc("project_detail", { id }), loadProjects(), loadMe()]);
  if (error) throw error;
  const detail = data as ProjectDetail | null;
  return detail ? { detail, card: cards.find((row) => row.id === id) ?? null, me } : null;
}

/** The project page (D49): Overview, Tasks and Activity. One component for interns and staff. */
export function ProjectPage({ base, staff }: { base: ProjectsBase; staff: boolean }) {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const tab = knownParam(params.get("tab"), ["tasks", "activity"], "overview") as Tab;
  const load = useCallback(() => (id ? loadProject(id) : Promise.resolve(null)), [id]);
  const [state, reload] = useLoad(load);
  // Tasks change under the Tasks tab; coming back to Overview shows fresh totals.
  const lastTab = useRef(tab);
  useEffect(() => {
    if (tab === "overview" && lastTab.current !== "overview") reload();
    lastTab.current = tab;
  }, [tab, reload]);
  const back = (
    <Link href={base} className="-ml-2 inline-flex min-h-11 w-fit items-center gap-0.5 pr-2 text-[17px] text-primary">
      <ChevronLeft aria-hidden className="size-5" />
      Projects
    </Link>
  );

  if (!id) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <EmptyState action={<Link href={base} className={buttonVariants({ variant: "secondary" })}>See projects</Link>}>
          Pick a project from the list.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3.5">
      {back}
      <LoadBlock state={state} reload={reload} empty="This project isn't here any more, or it isn't shared with you.">
        {(data) => (data ? <ProjectBody key={data.detail.project.id} {...data} base={base} staff={staff} tab={tab} reload={reload} /> : null)}
      </LoadBlock>
    </div>
  );
}

function ProjectBody({
  detail,
  card,
  me,
  base,
  staff,
  tab,
  reload,
}: {
  detail: ProjectDetail;
  card: ProjectCard | null;
  me: string | null;
  base: ProjectsBase;
  staff: boolean;
  tab: Tab;
  reload: () => void;
}) {
  const router = useRouter();
  const wide = useWide();
  const { project } = detail;
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const approved = Boolean(project.approved_at);
  const lead = Boolean(me) && project.lead_id === me;
  const creator = Boolean(me) && project.created_by === me;
  const can = {
    edit: staff || lead || (creator && !approved),
    archive: staff || lead || creator,
    milestones: staff || lead,
    addTask: approved && !project.archived_at,
  };
  const status = statusOf(project.status);
  const progress = projectProgress(card?.tasks_done ?? 0, card?.tasks_total ?? 0);
  const dates = dateRange(project.start_date, project.due_date);
  const href = (next: Tab) => `${base}/view?id=${project.id}${next === "overview" ? "" : `&tab=${next}`}`;
  // At 1024px+ Activity sits beside the page (DesktopProject mockup), so it isn't a segment there.
  const tabs: Tab[] = wide ? ["overview", "tasks"] : ["overview", "tasks", "activity"];
  const current: Tab = wide && tab === "activity" ? "overview" : tab;
  const TAB_LABEL: Record<Tab, string> = { overview: "Overview", tasks: "Tasks", activity: "Activity" };

  const main = (
    <div className="flex min-w-0 flex-col gap-3.5">
      <nav aria-label="Project sections">
        <ul className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-[10px] bg-muted p-0.5">
          {tabs.map((item) => (
            <li key={item}>
              <Link
                href={href(item)}
                replace
                scroll={false}
                aria-current={current === item ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-[15px] transition-colors",
                  current === item ? "bg-card font-semibold shadow-card" : "text-foreground hover:bg-card/60",
                )}
              >
                {TAB_LABEL[item]}
                {item === "tasks" && card?.tasks_total ? <span className="text-muted-foreground tabular-nums">{card.tasks_total}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {!approved && !project.archived_at ? (
        <p className="rounded-xl border-[1.5px] border-dashed border-input bg-card px-4 py-3 text-[15px] text-muted-foreground">
          {creator && !staff
            ? "Waiting for approval. Your supervisor has been told; you can add tasks once it's approved."
            : "Waiting for approval. Tasks can go under it once it's approved."}
        </p>
      ) : null}
      {current === "overview" ? (
        <Overview detail={detail} card={card} progress={progress} canMilestones={can.milestones} wide={wide} onChanged={reload} />
      ) : current === "tasks" ? (
        <ProjectTasks project={project} staff={staff} canAdd={can.addTask} />
      ) : (
        <ActivityFeed projectId={project.id} />
      )}
      {can.archive && current === "overview" ? (
        <Button type="button" variant="ghost" className="w-fit text-bad" onClick={() => setArchiving(true)}>
          Archive project
        </Button>
      ) : null}
    </div>
  );

  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-[1.75rem] leading-tight">{project.name}</h1>
            {can.edit && !wide ? (
              <Button type="button" variant="ghost" className="-mr-3" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-muted-foreground">
            <StatusChip tone={approved ? status.tone : "neutral"} label={approved ? status.label : "Waiting for approval"} />
            {wide ? (
              <span>
                {[project.client_name, project.lead_name ? `lead ${project.lead_name}` : null, dates].filter(Boolean).join(" · ")}
              </span>
            ) : dates ? (
              <span>{dates}</span>
            ) : null}
          </p>
        </div>
        {wide ? (
          <div className="flex items-center gap-4">
            <div className="flex w-48 flex-col gap-1.5">
              <span className="flex justify-between gap-2 text-sm">
                <strong>{progress.text.replace(" tasks", "")}</strong>
                {card ? <span className="text-muted-foreground">{hoursText(card.spent_minutes, card.estimate_minutes)}</span> : null}
              </span>
              <ProgressBar percent={progress.percent} />
            </div>
            {can.edit ? (
              <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {wide ? (
        <div className="grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-6">
          {main}
          <aside aria-label="Project activity and client" className="flex flex-col gap-4">
            <ActivityFeed projectId={project.id} compact />
            <ClientCard detail={detail} />
          </aside>
        </div>
      ) : (
        main
      )}

      {editing ? (
        <ProjectForm
          open
          initial={detail}
          staff={staff}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={archiving}
        title={`Archive ${project.name}?`}
        description="It leaves everyone's project list. Its tasks stay, without the project."
        confirmLabel="Archive"
        destructive
        onCancel={() => setArchiving(false)}
        onConfirm={async () => {
          const { error } = await createClient().rpc("archive_project", { id: project.id });
          if (error) return errorText(error, "It didn't archive. Try again.");
          toast.success("Project archived.");
          router.push(base);
          return null;
        }}
      />
    </>
  );
}

function Overview({
  detail,
  card,
  progress,
  canMilestones,
  wide,
  onChanged,
}: {
  detail: ProjectDetail;
  card: ProjectCard | null;
  progress: { percent: number; text: string };
  canMilestones: boolean;
  wide: boolean;
  onChanged: () => void;
}) {
  const { project } = detail;
  const spent = card?.spent_minutes ?? 0;
  const estimate = card?.estimate_minutes ?? 0;
  return (
    <>
      <section aria-label="Progress" className={cn(group, "flex flex-col gap-3 p-4")}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[2.125rem] leading-none font-bold tracking-tight">{progress.percent}%</span>
          <span className="text-[15px] text-muted-foreground">{progress.text}</span>
        </div>
        <ProgressBar percent={progress.percent} />
        <dl className="grid grid-cols-3 gap-2">
          <Stat value={formatMinutes(spent)} label={estimate ? `spent of ${formatMinutes(estimate)}` : "spent"} />
          <Stat value={String(card?.overdue ?? 0)} label="overdue" bad={Boolean(card?.overdue)} />
          <Stat value={String(card?.in_review ?? 0)} label="in review" />
        </dl>
        {card?.blocked ? <p className="text-sm font-semibold text-bad">{card.blocked} blocked</p> : null}
      </section>

      {project.description || project.links?.length ? (
        <section aria-labelledby="about-project" className="flex flex-col gap-1.5">
          <h2 id="about-project" className={heading}>
            About
          </h2>
          <div className={cn(group, "flex flex-col gap-2 p-4")}>
            {project.description ? <p className="text-[15px] whitespace-pre-line">{project.description}</p> : null}
            {project.links?.length ? (
              <ul className="flex flex-col">
                {project.links.map((link) => (
                  <li key={link}>
                    <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center break-all text-primary underline">
                      {link.replace(/^https:\/\//, "")}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      ) : null}

      <Milestones detail={detail} canManage={canMilestones} onChanged={onChanged} />
      {wide ? null : <ClientCard detail={detail} />}
    </>
  );
}

function Stat({ value, label, bad = false }: { value: string; label: string; bad?: boolean }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-[17px] font-bold", bad ? "text-bad" : null)}>{value}</dd>
    </div>
  );
}

function Milestones({ detail, canManage, onChanged }: { detail: ProjectDetail; canManage: boolean; onChanged: () => void }) {
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = detail.milestones;
  // The next open milestone is the one to look at, as in the mockup.
  const next = items.find((item) => !item.done)?.id;

  async function add() {
    if (!name.trim()) return setError("Give the milestone a name.");
    setBusy(true);
    setError(null);
    const { error: fail } = await createClient().rpc("save_milestone", {
      id: null,
      project: detail.project.id,
      name: name.trim(),
      due_date: due || null,
    } as unknown as { id: string; project: string; name: string; due_date: string });
    setBusy(false);
    if (fail) return setError(errorText(fail, "The milestone didn't save. Try again."));
    setName("");
    setDue("");
    setAdding(false);
    onChanged();
  }

  async function archive(milestone: ProjectDetail["milestones"][number]) {
    const { error: fail } = await createClient().rpc("archive_milestone", { id: milestone.id });
    if (fail) toast.error(errorText(fail, "It didn't remove. Try again."));
    else {
      toast.success(`${milestone.name} removed.`);
      onChanged();
    }
  }

  if (items.length === 0 && !canManage) return null;
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <h2 id={`${id}-title`} className={heading}>
          Milestones
        </h2>
        {canManage && !adding ? (
          <Button type="button" variant="ghost" size="icon" aria-label="Add milestone" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
          </Button>
        ) : null}
      </div>
      <ul className={cn(group, "divide-y divide-border")}>
        {items.length === 0 && !adding ? (
          <li className="px-3.5 py-3 text-[15px] text-muted-foreground">No milestones yet. Add one to group tasks by stage.</li>
        ) : null}
        {items.map((item) => (
          <li key={item.id} className="flex min-h-13 items-center gap-3 py-1.5 pr-1.5 pl-3.5">
            {item.done ? (
              <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-ok text-card">
                <Check aria-hidden className="size-3.5" strokeWidth={3} />
                <span className="sr-only">Done:</span>
              </span>
            ) : (
              <span
                aria-hidden
                className={cn("size-[22px] shrink-0 rounded-full border-2", item.id === next ? "border-primary" : "border-input")}
              />
            )}
            <span className={cn("min-w-0 flex-1 text-base", item.id === next ? "font-semibold" : null)}>{item.name}</span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {item.tasks_done} of {item.tasks_total}
              {item.due_date ? ` · ${shortDate(item.due_date)}` : ""}
            </span>
            {canManage ? (
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove milestone ${item.name}`} onClick={() => void archive(item)}>
                <X aria-hidden className="text-muted-foreground" />
              </Button>
            ) : null}
          </li>
        ))}
        {adding ? (
          <li className="p-3.5">
            <form
              aria-label="New milestone"
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void add();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${id}-name`}>Milestone name</Label>
                  <Input id={`${id}-name`} maxLength={80} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${id}-due`}>Due date</Label>
                  <Input id={`${id}-due`} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
                </div>
              </div>
              {error ? <FormMessage>{error}</FormMessage> : null}
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Add milestone"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function ClientCard({ detail }: { detail: ProjectDetail }) {
  const { project, members } = detail;
  const names = members.map((member) => member.name);
  const team = [...new Set([...(project.lead_name ? [project.lead_name] : []), ...names])];
  const who = [project.contact_name, project.client_name].filter(Boolean).join(", ");
  const call = project.contact_phone?.replace(/[^\d+]/g, "");
  return (
    <section aria-labelledby="client-team" className="flex flex-col gap-1.5">
      <h2 id="client-team" className={heading}>
        Client and team
      </h2>
      <div className={cn(group, "divide-y divide-border")}>
        {who || project.contact_email || call ? (
          <div className="flex items-center gap-2 py-2.5 pr-1.5 pl-3.5">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">{who || "Client contact"}</span>
              {project.contact_email ? <span className="truncate text-sm text-muted-foreground">{project.contact_email}</span> : null}
            </div>
            {call ? (
              <a
                href={`tel:${call}`}
                aria-label={`Call ${project.contact_name ?? "the client"}`}
                className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
              >
                <Phone aria-hidden className="size-[18px]" />
              </a>
            ) : null}
            {project.contact_email ? (
              <a
                href={`mailto:${project.contact_email}`}
                aria-label={`Email ${project.contact_name ?? "the client"}`}
                className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
              >
                <Mail aria-hidden className="size-[18px]" />
              </a>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center gap-2.5 px-3.5 py-3">
          {team.length ? (
            <span className="flex shrink-0">
              {team.slice(0, 4).map((name, index) => (
                <Avatar key={name} url={null} name={name} size={32} className={index ? "-ml-2" : undefined} />
              ))}
            </span>
          ) : null}
          <span className="text-[15px]">{teamText(project.lead_name, names)}</span>
        </div>
      </div>
    </section>
  );
}

async function loadProjectTasks(staff: boolean, project: string) {
  const { rows, me } = staff ? await loadStaffTasks() : { rows: await loadMyTasks(), me: await loadMe() };
  return { rows: (rows as TaskItem[]).filter((row) => row.project_id === project), me };
}

/** The Tasks segment: the project's copies the viewer can see, as a list or board, and "+ Task" with the project picked. */
function ProjectTasks({ project, staff, canAdd }: { project: ProjectDetail["project"]; staff: boolean; canAdd: boolean }) {
  const load = useCallback(() => loadProjectTasks(staff, project.id), [staff, project.id]);
  const [state, reload] = useLoad(load);
  const [view, setView] = useState<View>("list");
  const [adding, setAdding] = useState(false);
  const tasks = useTaskView(reload);
  const me = state.status === "ready" ? state.data.me : null;
  const rows = state.status === "ready" ? sortTasks(state.data.rows) : [];
  const viewerOf = (row: TaskItem): Viewer =>
    staff
      ? { person: Boolean(me) && row.person_id === me, reviewer: Boolean(me) && row.reviewer_id === me, manager: true }
      : { person: Boolean(row.own), reviewer: Boolean(me) && row.reviewer_id === me, manager: false };

  return (
    <div className={cn("flex flex-col gap-3", tasks.opened ? besidePanel : null)}>
      <div className="flex items-center gap-2">
        <ViewSwitch view={view} setView={setView} views={["list", "board"]} />
        {canAdd ? (
          <Button type="button" className="ml-auto" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Task
          </Button>
        ) : null}
      </div>
      <LoadBlock state={state} reload={reload}>
        {() =>
          rows.length === 0 ? (
            <EmptyState>
              {canAdd ? "No tasks in this project yet. Add the first one." : "No tasks in this project yet."}
            </EmptyState>
          ) : view === "board" ? (
            <TaskBoard
              rows={rows}
              viewerOf={viewerOf}
              busy={tasks.busy}
              onOpen={tasks.open}
              onMove={(row, status) => void tasks.move(row, status)}
              showPerson={staff}
            />
          ) : (
            <ul className={cn(group, "divide-y divide-border")}>
              {rows.map((row) => (
                <TaskRow
                  key={row.item_id}
                  row={{ ...row, project_name: null }}
                  name={staff && row.person_name ? `${row.title} · ${row.person_name}` : undefined}
                  onOpen={() => tasks.open(row)}
                />
              ))}
            </ul>
          )
        }
      </LoadBlock>
      {tasks.detail(rows, viewerOf)}
      <Dialog open={adding} onOpenChange={(open) => setAdding(open)}>
        <DialogContent className="sm:w-[min(100%-2rem,36rem)]">
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>It goes under {project.name}.</DialogDescription>
          <div className="mt-4">
            <TaskForm
              mode={staff ? "staff" : "intern"}
              project={{ id: project.id, name: project.name }}
              onSaved={() => {
                setAdding(false);
                reload();
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Activity, newest first, 30 at a time (last 90 days), with "Load earlier". */
function ActivityFeed({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  const load = useCallback(() => loadActivity(projectId), [projectId]);
  const [state, reload] = useLoad(load);
  const [older, setOlder] = useState<ActivityRow[]>([]);
  const [more, setMore] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const first = state.status === "ready" ? state.data : [];
  const rows = [...first, ...older];
  const hasMore = more ?? first.length >= 30;

  async function loadEarlier() {
    const last = rows.at(-1);
    if (!last) return;
    setBusy(true);
    try {
      const next = await loadActivity(projectId, last.created_at);
      setOlder((current) => [...current, ...next]);
      setMore(next.length >= 30);
    } catch (error) {
      toast.error(errorText(error, "That didn't load. Try again."));
    }
    setBusy(false);
  }

  const body: ReactNode = (
    <LoadBlock state={state} reload={reload}>
      {() =>
        rows.length === 0 ? (
          <p className="px-3.5 py-3 text-[15px] text-muted-foreground">No activity yet. Adding a task starts the feed.</p>
        ) : (
          <>
            <ol className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.id} className="px-3.5 py-2.5">
                  <p className="text-[15px]">{activitySentence(row)}</p>
                  <p className="text-[13px] text-muted-foreground">
                    <time dateTime={row.created_at}>{formatDayTime(row.created_at)}</time>
                  </p>
                </li>
              ))}
            </ol>
            {hasMore ? (
              <div className="border-t border-border p-1.5">
                <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={() => void loadEarlier()}>
                  {busy ? "Loading…" : "Load earlier"}
                </Button>
              </div>
            ) : null}
          </>
        )
      }
    </LoadBlock>
  );

  return (
    <section aria-labelledby={`activity-${projectId}`} className="flex flex-col gap-1.5">
      <h2 id={`activity-${projectId}`} className={compact ? heading : "sr-only"}>
        Activity
      </h2>
      <div className={group}>{body}</div>
    </section>
  );
}

async function loadActivity(id: string, before?: string) {
  const { data, error } = await createClient().rpc("project_activity", before ? { id, before } : { id });
  if (error) throw error;
  return (data ?? []) as ActivityRow[];
}

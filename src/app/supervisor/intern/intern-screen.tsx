"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { embedName, forecastText, owedText, pctText } from "@/app/supervisor/supervisor";
import { CheckinPanel } from "@/components/supervisor/checkin-panel";
import { PlacementActions } from "@/components/supervisor/placement-actions";
import { DayStatusBadge } from "@/components/day-status-badge";
import { DeskGate } from "@/components/desk-gate";
import { StaffShell } from "@/components/desk-shell";
import { EmptyState } from "@/components/empty-state";
import { LoadBlock } from "@/components/load-block";
import { MetricCard } from "@/components/metric-card";
import { MinutesText } from "@/components/minutes-text";
import { PaceChip } from "@/components/pace-chip";
import { PageHeader } from "@/components/page-header";
import { ProgressRing } from "@/components/progress-ring";
import { SelfieImage } from "@/components/selfie-image";
import { StatusChip } from "@/components/status-chip";
import { buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { darwinDateKey, formatDay, formatTime, formatTimeOfDay } from "@/lib/darwin";
import {
  loadCheckins,
  loadDayKinds,
  loadDayResults,
  loadFlaggedEvents,
  loadPlacement,
  loadProgressForSupervisor,
  loadPunchesForPlacement,
  loadRequestsForPlacement,
  loadScheduledDays,
  loadWorkLogs,
} from "@/lib/data";
import { FLAG_LABEL, errorText, formatDistance, type Profile } from "@/lib/daymark";
import { formatMinutes } from "@/lib/minutes";
import { addDays } from "@/lib/periods";
import { PLACEMENT_STATUS_LABEL, REQUEST_STATUS_LABEL, asRecord, dayCellStatus, requestLabel } from "@/lib/placement-ui";
import { dayTimes, filterDays, profileDays, profileSummary, type ProfileDay, type ProfileFilter } from "@/lib/profile-stats";
import { selfieUrl, signSelfies } from "@/lib/punches";
import { useLoad } from "@/lib/use-load";

const TABS = ["Timesheet", "Schedule", "Hours", "Requests", "Work logs", "Check-ins", "Flags", "Selfies"] as const;
/** ?tab= values, so a link can open a tab (the Monday summary links to Check-ins). */
const TAB_PARAM: Record<string, Tab> = { checkins: "Check-ins", flags: "Flags" };
type Tab = (typeof TABS)[number];

type PlacementView = {
  id: string;
  intern_id: string;
  supervisor_id: string;
  status: string;
  start_date: string;
  planned_end_date: string;
  ended_on: string | null;
  target_minutes: number;
  university: string;
  course: string;
  report_approved_at: string | null;
  report_approved_by: string | null;
  intern_name: string;
  supervisor_name: string | null;
};

type PunchThumb = {
  id: string;
  occurred_at: string;
  event_type: string;
  photo_path: string;
  flags: string[];
};

function asPlacement(data: unknown): PlacementView | null {
  const row = asRecord(data);
  if (!row || typeof row.id !== "string" || typeof row.intern_id !== "string") return null;
  return {
    id: row.id,
    intern_id: row.intern_id,
    supervisor_id: typeof row.supervisor_id === "string" ? row.supervisor_id : "",
    status: typeof row.status === "string" ? row.status : "",
    start_date: typeof row.start_date === "string" ? row.start_date : "",
    planned_end_date: typeof row.planned_end_date === "string" ? row.planned_end_date : "",
    ended_on: typeof row.ended_on === "string" ? row.ended_on : null,
    target_minutes: typeof row.target_minutes === "number" ? row.target_minutes : 0,
    university: typeof row.university === "string" ? row.university : "",
    course: typeof row.course === "string" ? row.course : "",
    report_approved_at: typeof row.report_approved_at === "string" ? row.report_approved_at : null,
    report_approved_by: typeof row.report_approved_by === "string" ? row.report_approved_by : null,
    intern_name: embedName(row.intern) ?? "Intern",
    supervisor_name: embedName(row.supervisor),
  };
}

async function loadInternDesk(id: string) {
  const raw = await loadPlacement(id);
  const placement = asPlacement(raw as unknown);
  if (!placement) return null;
  const today = darwinDateKey(new Date());
  const from = placement.start_date || today;
  const latest = [placement.planned_end_date, placement.ended_on ?? from, today].reduce((a, b) => (a > b ? a : b));
  const to = addDays(latest, 14);
  const [progressRows, days, results, requests, logs, punches, checkins, flagged, kinds] = await Promise.all([
    loadProgressForSupervisor(),
    loadScheduledDays(id, from, to),
    loadDayResults(id, from, to),
    loadRequestsForPlacement(id),
    loadWorkLogs(id),
    loadPunchesForPlacement(placement.intern_id, `${from}T00:00:00+09:30`, `${to}T23:59:59+09:30`),
    loadCheckins(id),
    loadFlaggedEvents(addDays(today, -60), today),
    loadDayKinds(id, from, to),
  ]);
  // Selfie links are signed when the Selfies or Flags tab opens: a 60-second link signed here is dead by then.
  const thumbs: PunchThumb[] = punches.flatMap((punch) =>
    punch.photo_path
      ? [{ id: punch.id, occurred_at: punch.occurred_at, event_type: punch.event_type, photo_path: punch.photo_path, flags: punch.flags ?? [] }]
      : [],
  );
  return {
    placement,
    progress: progressRows.find((row) => row.placement_id === id) ?? null,
    days,
    results,
    requests,
    logs,
    thumbs,
    punches,
    kinds,
    checkins,
    flagged: flagged.filter((row) => row.intern_id === placement.intern_id),
  };
}

function attendanceFromResults(results: Awaited<ReturnType<typeof loadDayResults>>) {
  const past = results.filter((row) => !row.unscheduled && row.scheduled > 0);
  const attended = past.filter((row) => row.worked > 0 || row.counted > 0);
  const onTime = attended.filter((row) => !row.late);
  return {
    attendance_pct: past.length ? Math.round((attended.length / past.length) * 100) : null,
    on_time_pct: attended.length ? Math.round((onTime.length / attended.length) * 100) : null,
  };
}

export function InternScreen() {
  return (
    <DeskGate role="supervisor">
      {(profile) => (
        <StaffShell profile={profile} role="supervisor" title="Intern">
          <InternDesk profile={profile} />
        </StaffShell>
      )}
    </DeskGate>
  );
}

function InternDesk({ profile }: { profile: Profile }) {
  const params = useSearchParams();
  const id = params.get("id");
  const tabParam = params.get("tab");
  const load = useCallback(() => (id ? loadInternDesk(id) : Promise.resolve(null)), [id]);
  const [state, reload] = useLoad(load);

  if (!id) {
    return (
      <>
        <PageHeader title="Intern" />
        <EmptyState
          action={
            <Link href="/supervisor/interns" className={buttonVariants({ variant: "secondary" })}>
              Back to interns
            </Link>
          }
        >
          Pick an intern from the list.
        </EmptyState>
      </>
    );
  }

  return (
    <LoadBlock
      state={state}
      reload={reload}
      empty="You don't have access to this placement."
      action={
        <Link href="/supervisor/interns" className={buttonVariants({ variant: "secondary" })}>
          Back to interns
        </Link>
      }
      skeleton={
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      }
    >
      {(data) => (
        <InternDetail data={data!} profile={profile} onDone={reload} initialTab={TAB_PARAM[tabParam ?? ""]} />
      )}
    </LoadBlock>
  );
}

function InternDetail({
  data,
  profile,
  onDone,
  initialTab,
}: {
  data: NonNullable<Awaited<ReturnType<typeof loadInternDesk>>>;
  profile: Profile;
  onDone: () => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "Timesheet");
  const { placement, progress, days, results, requests, logs, thumbs, punches, kinds, checkins, flagged } = data;
  const rates = attendanceFromResults(results);
  const attendance = progress?.attendance_pct ?? rates.attendance_pct;
  const onTime = rates.on_time_pct;
  const counted = progress?.counted_total ?? results.reduce((sum, row) => sum + row.counted, 0);
  const target = progress?.target_minutes ?? placement.target_minutes;
  const approvedName =
    placement.report_approved_by === profile.id
      ? profile.display_name
      : (placement.supervisor_name ?? profile.display_name);
  const today = darwinDateKey(new Date());
  const list = profileDays({ days, results, kinds, punches, today });
  const summary = profileSummary(list, results, today);
  const weeks = summary.weeksMet + summary.weeksMissed;

  return (
    <>
      <PageHeader
        title={placement.intern_name}
        description={`${placement.university} · ${placement.course}`}
        actions={
          <StatusChip tone="info" label={PLACEMENT_STATUS_LABEL[placement.status] ?? placement.status} />
        }
      />

      <div className="flex flex-col gap-6 rounded-xl bg-card p-6 shadow-card sm:flex-row sm:items-center">
        <ProgressRing counted={counted} target={target} size={140} label={`${counted} of ${target} minutes counted`}>
          <div>
            <p className="text-2xl font-bold tabular-nums">{target > 0 ? Math.round((counted / target) * 100) : 0}%</p>
            <p className="caption text-muted-foreground">counted</p>
          </div>
        </ProgressRing>
        <div className="flex min-w-0 flex-col gap-2">
          {progress ? <PaceChip daysLate={progress.days_late} /> : null}
          <p>{progress ? forecastText(progress, formatDay) : `Planned end ${formatDay(placement.planned_end_date)}`}</p>
          <p className="text-muted-foreground">{progress ? owedText(progress.owed) : "Owed —"}</p>
          {attendance != null || onTime != null ? (
            <p className="text-sm text-muted-foreground">
              Attendance {pctText(attendance)}
              {onTime != null ? ` · On time ${pctText(onTime)}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Days worked" value={String(summary.worked)} />
        <MetricCard
          label="Days absent"
          value={String(summary.absent)}
          sub={summary.absent > 0 ? "Marked absent" : undefined}
          tone={summary.absent > 0 ? "bad" : "neutral"}
        />
        <MetricCard label="Days swapped" value={String(summary.moved)} sub={summary.moved > 0 ? "Moved to another day" : undefined} />
        <MetricCard
          label="Days late"
          value={String(summary.late)}
          sub={summary.late > 0 ? "Clocked in late" : undefined}
          tone={summary.late > 0 ? "warn" : "neutral"}
        />
        <MetricCard
          label="Weekly hours met"
          value={weeks > 0 ? `${summary.weeksMet} of ${weeks}` : "—"}
          sub={weeks === 0 ? "No full week yet" : summary.weeksMissed > 0 ? `${summary.weeksMissed} short` : "Every week"}
          tone={summary.weeksMissed > 0 ? "warn" : "ok"}
        />
        <MetricCard
          label="This week"
          value={formatMinutes(summary.thisWeek.counted)}
          sub={`of ${formatMinutes(summary.thisWeek.scheduled)} rostered`}
          tone={summary.thisWeek.scheduled > 0 && summary.thisWeek.counted >= summary.thisWeek.scheduled ? "ok" : "neutral"}
        />
        <MetricCard
          label="Total counted"
          value={formatMinutes(counted)}
          sub={`of ${formatMinutes(target)} placement target`}
          className="col-span-2"
        />
      </section>

      {placement.report_approved_at ? (
        <p className="rounded-lg bg-ok-bg px-4 py-3 text-ok">
          Intern report <span className="font-semibold">approved</span> · {approvedName} · {formatDay(placement.report_approved_at)}
        </p>
      ) : null}

      <PlacementActions
        placementId={placement.id}
        status={placement.status}
        plannedEnd={placement.planned_end_date}
        reportApprovedAt={placement.report_approved_at}
        onDone={onDone}
      />

      <div role="tablist" aria-label="Intern records" className="flex flex-wrap gap-1">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            onClick={() => setTab(item)}
            className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold ${
              tab === item ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === "Timesheet" ? <TimesheetTab list={list} today={today} /> : null}
      {tab === "Schedule" ? <ScheduleTab days={days} results={results} today={today} /> : null}
      {tab === "Hours" ? <HoursTab results={results} /> : null}
      {tab === "Requests" ? <RequestsTab requests={requests} /> : null}
      {tab === "Work logs" ? <LogsTab logs={logs} /> : null}
      {tab === "Check-ins" ? (
        <CheckinPanel
          placementId={placement.id}
          startDate={placement.start_date}
          endDate={placement.ended_on ?? placement.planned_end_date}
          today={today}
          checkins={checkins}
          onSaved={onDone}
        />
      ) : null}
      {tab === "Flags" ? <FlagsTab flagged={flagged} thumbs={thumbs} /> : null}
      {tab === "Selfies" ? <SelfiesTab thumbs={thumbs} /> : null}
    </>
  );
}

const FILTERS: { value: ProfileFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "worked", label: "Worked" },
  { value: "absent", label: "Absent" },
  { value: "moved", label: "Swapped" },
  { value: "late", label: "Late" },
];

/** Every day's clock-in, breaks, clock-out, sessions and total, with a filter and a date range (Dilip, 8 Oct). */
function TimesheetTab({
  list,
  today,
}: {
  list: ProfileDay<Awaited<ReturnType<typeof loadPunchesForPlacement>>[number]>[];
  today: string;
}) {
  const [filter, setFilter] = useState<ProfileFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const shown = filterDays(list, filter, from, to);
  const time = (punch: { occurred_at: string } | null) => (punch ? formatTime(punch.occurred_at) : "—");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Show days" className="flex flex-wrap gap-1">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
              className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold ${
                filter === item.value ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          From
          <Input type="date" value={from} max={to || today} onChange={(event) => setFrom(event.target.value)} className="w-auto" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          To
          <Input type="date" value={to} min={from || undefined} max={today} onChange={(event) => setTo(event.target.value)} className="w-auto" />
        </label>
      </div>
      {shown.length === 0 ? (
        <EmptyState>No days match.</EmptyState>
      ) : (
        <StackTable
          columns={["Date", "Clock in", "Breaks", "Clock out", "Sessions", "Day total", "Status"]}
          rows={shown.map((day) => {
            const times = dayTimes(day.rows);
            const status = dayCellStatus({
              workDate: day.date,
              today,
              dayStatus: day.day?.status,
              leaveKind: day.day?.leave_kind,
              counted: day.result?.counted,
              noShow: day.result?.no_show,
            });
            return [
              formatDay(day.date),
              time(times.clockIn),
              times.breaks.length === 0 ? (
                "—"
              ) : (
                <ul key={`${day.date}-breaks`}>
                  {times.breaks.map((item) => (
                    <li key={item.start.id} className="whitespace-nowrap">
                      {time(item.start)} – {item.end ? time(item.end) : "not ended"}
                      {item.minutes !== null ? <span className="text-muted-foreground"> · {formatMinutes(item.minutes)}</span> : null}
                    </li>
                  ))}
                </ul>
              ),
              time(times.clockOut),
              times.sessions.length === 0
                ? "—"
                : times.sessions.map((minutes) => (minutes === null ? "open" : formatMinutes(minutes))).join(" + "),
              day.result ? <MinutesText key={`${day.date}-total`} minutes={day.result.counted} /> : "—",
              <div key={`${day.date}-status`} className="flex flex-wrap gap-1">
                <DayStatusBadge status={status} />
                {day.late ? <StatusChip tone="warn" label="Late" /> : null}
                {day.edited ? <StatusChip tone="neutral" label="Edited" /> : null}
                {day.waiting ? <StatusChip tone="warn" label={day.waiting} /> : null}
                {day.kind?.kind === "work_based" ? (
                  <StatusChip
                    tone={day.kind.status === "approved" ? "ok" : day.kind.status === "declined" ? "bad" : "warn"}
                    label={`Work-based · ${day.kind.status ?? "pending"}`}
                  />
                ) : null}
              </div>,
            ];
          })}
        />
      )}
    </div>
  );
}

function ScheduleTab({
  days,
  results,
  today,
}: {
  days: Awaited<ReturnType<typeof loadScheduledDays>>;
  results: Awaited<ReturnType<typeof loadDayResults>>;
  today: string;
}) {
  const byDate = new Map(results.map((row) => [row.work_date, row]));
  if (days.length === 0) return <EmptyState>No scheduled days in this range.</EmptyState>;
  const rows = days.map((day) => {
    const result = byDate.get(day.work_date);
    const status = dayCellStatus({
      workDate: day.work_date,
      today,
      dayStatus: day.status,
      leaveKind: day.leave_kind,
      counted: result?.counted,
      noShow: result?.no_show,
    });
    return { day, result, status };
  });
  return (
    <StackTable
      columns={["Date", "Start", "End", "Status"]}
      rows={rows.map(({ day, status }) => [
        formatDay(day.work_date),
        formatTimeOfDay(day.start_time),
        formatTimeOfDay(day.end_time),
        <DayStatusBadge key={day.id} status={status} />,
      ])}
    />
  );
}

function HoursTab({ results }: { results: Awaited<ReturnType<typeof loadDayResults>> }) {
  if (results.length === 0) return <EmptyState>No day results yet.</EmptyState>;
  return (
    <StackTable
      columns={["Date", "Raw", "Break", "Worked", "Counted", "Short", "Flags"]}
      rows={results.map((row) => [
        formatDay(row.work_date),
        <MinutesText key={`${row.work_date}-raw`} minutes={row.raw} />,
        <MinutesText key={`${row.work_date}-break`} minutes={row.break} />,
        <MinutesText key={`${row.work_date}-worked`} minutes={row.worked} />,
        <MinutesText key={`${row.work_date}-counted`} minutes={row.counted} />,
        row.short == null ? "—" : <MinutesText key={`${row.work_date}-short`} minutes={row.short} />,
        <HoursFlags key={`${row.work_date}-flags`} row={row} />,
      ])}
    />
  );
}

function HoursFlags({ row }: { row: Awaited<ReturnType<typeof loadDayResults>>[number] }) {
  const flags = [
    row.late ? "Late" : null,
    row.no_show ? "No-show" : null,
    row.auto_closed ? "Auto-closed" : null,
    row.unscheduled ? "Unscheduled" : null,
  ].filter((label): label is string => Boolean(label));
  if (flags.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((label) => (
        <StatusChip key={label} tone={label === "No-show" ? "bad" : "warn"} label={label} />
      ))}
    </div>
  );
}

function RequestsTab({ requests }: { requests: Awaited<ReturnType<typeof loadRequestsForPlacement>> }) {
  if (requests.length === 0) return <EmptyState>No requests on this placement.</EmptyState>;
  return (
    <StackTable
      columns={["Type", "Dates", "Status"]}
      rows={requests.map((row) => [
        requestLabel(row.type),
        row.dates.length ? row.dates.map((d) => formatDay(d)).join(", ") : "—",
        <div key={row.id} className="flex flex-wrap gap-1">
          <StatusChip
            tone={row.status === "approved" ? "ok" : row.status === "declined" ? "bad" : "info"}
            label={REQUEST_STATUS_LABEL[row.status] ?? row.status}
          />
          {row.escalated_at ? <StatusChip tone="bad" label="Escalated" /> : null}
        </div>,
      ])}
    />
  );
}

function LogsTab({ logs }: { logs: Awaited<ReturnType<typeof loadWorkLogs>> }) {
  if (logs.length === 0) return <EmptyState>No work logs yet.</EmptyState>;
  return (
    <ul className="flex flex-col gap-2">
      {logs.map((log) => (
        <li key={log.work_date} className="flex flex-col gap-1 rounded-lg bg-card p-4 shadow-card">
          <p className="font-semibold">{formatDay(log.work_date)}</p>
          <p className="text-sm">{log.summary}</p>
        </li>
      ))}
    </ul>
  );
}

function FlagsTab({
  flagged,
  thumbs,
}: {
  flagged: Awaited<ReturnType<typeof loadFlaggedEvents>>;
  thumbs: PunchThumb[];
}) {
  const shown = useMemo(() => thumbs.filter((thumb) => flagged.some((row) => row.punch_id === thumb.id)), [thumbs, flagged]);
  const [state] = useSelfieUrls(shown);
  if (flagged.length === 0) return <EmptyState>No flagged clock-ins in the last 60 days.</EmptyState>;
  const paths = new Map(shown.map((thumb) => [thumb.id, thumb.photo_path]));
  return (
    <StackTable
      columns={["When", "Event", "Flags", "Distance", "Accuracy", "Selfie"]}
      rows={flagged.map((row) => {
        const path = paths.get(row.punch_id);
        return [
          `${formatDay(row.occurred_at)}, ${formatTime(row.occurred_at)}`,
          row.event_type === "shift_in" ? "Clock in" : row.event_type === "shift_out" ? "Clock out" : row.event_type,
          <div key={`${row.punch_id}-flags`} className="flex flex-wrap gap-1">
            {row.flags.map((flag) => (
              <StatusChip key={flag} tone="warn" label={FLAG_LABEL[flag] ?? flag} />
            ))}
          </div>,
          row.distance_m == null ? "—" : formatDistance(row.distance_m),
          row.accuracy_m == null ? "—" : `± ${Math.round(row.accuracy_m)} m`,
          !path ? (
            "—"
          ) : state.status === "loading" ? (
            <Skeleton key={`${row.punch_id}-photo`} className="size-12 rounded-md" />
          ) : (
            <SelfieImage
              key={`${row.punch_id}-photo`}
              path={path}
              url={state.status === "ready" ? (state.data.get(path) ?? null) : null}
              alt={`Selfie, ${formatDay(row.occurred_at)}`}
              className="size-12 rounded-md object-cover"
              compact
            />
          ),
        ];
      })}
    />
  );
}

/** Signs the selfie links when a tab that shows them opens: they only live 60 seconds (§14). */
function useSelfieUrls(thumbs: PunchThumb[]) {
  const load = useCallback(() => signSelfies(thumbs.map((thumb) => thumb.photo_path)), [thumbs]);
  return useLoad(load);
}

function SelfiesTab({ thumbs }: { thumbs: PunchThumb[] }) {
  const [state, reload] = useSelfieUrls(thumbs);
  const [photo, setPhoto] = useState<PunchThumb | null>(null);
  const [full, setFull] = useState<string | null>(null);

  async function open(thumb: PunchThumb) {
    setPhoto(thumb);
    try {
      setFull(await selfieUrl(thumb.photo_path));
    } catch (error) {
      setPhoto(null);
      toast.error(errorText(error, "That selfie didn't open. Try again."));
    }
  }

  if (thumbs.length === 0) return <EmptyState>No selfies on file.</EmptyState>;

  return (
    <>
      <LoadBlock
        state={state}
        reload={reload}
        skeleton={
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {thumbs.slice(0, 12).map((thumb) => (
              <Skeleton key={thumb.id} className="aspect-square w-full rounded-md" />
            ))}
          </div>
        }
      >
        {(urls) => (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {thumbs.map((thumb) => (
              <li key={thumb.id}>
                <button
                  type="button"
                  onClick={() => void open(thumb)}
                  className="aspect-square w-full overflow-hidden rounded-md border border-border"
                  aria-label={`Selfie from ${formatDay(thumb.occurred_at)}, ${formatTime(thumb.occurred_at)}`}
                >
                  <SelfieImage path={thumb.photo_path} url={urls.get(thumb.photo_path) ?? null} className="size-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </LoadBlock>
      <Dialog
        open={photo !== null}
        onOpenChange={(next) => {
          if (!next) {
            setPhoto(null);
            setFull(null);
          }
        }}
      >
        <DialogContent>
          {photo ? (
            <>
              <DialogTitle>
                {formatDay(photo.occurred_at)}, {formatTime(photo.occurred_at)}
              </DialogTitle>
              <DialogDescription>Selfies are private. Each view uses a link that expires after 60 seconds.</DialogDescription>
              {photo.flags.filter((flag) => FLAG_LABEL[flag]).length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {photo.flags.map((flag) =>
                    FLAG_LABEL[flag] ? <StatusChip key={flag} tone="warn" label={FLAG_LABEL[flag]} /> : null,
                  )}
                </div>
              ) : null}
              {full ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={full} alt="" className="mt-4 max-h-[70vh] w-full rounded-lg object-contain" />
              ) : (
                <Skeleton className="mt-4 h-64 w-full rounded-lg" />
              )}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function StackTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg bg-card shadow-card sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {columns.map((col) => (
                <th key={col} className="px-4 py-3 font-semibold">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-border last:border-0">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-4 py-3">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-2 sm:hidden">
        {rows.map((row, index) => (
          <li key={index} className="flex flex-col gap-2 rounded-lg bg-card p-4 shadow-card">
            {row.map((cell, cellIndex) => (
              <div key={cellIndex}>
                <p className="caption text-muted-foreground">{columns[cellIndex]}</p>
                <div>{cell}</div>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}

"use client";

import { use, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Coffee, LogIn, LogOut, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { ClockSheet } from "@/app/clock/clock-sheet";
import { cacheStatus, readCachedStatus, readLocalDayKind, saveLocalDayKind, useOfflineClocks } from "@/app/clock/use-offline-clocks";
import { Avatar } from "@/components/avatar";
import { CatchUpSheet } from "@/components/catch-up-sheet";
import { EmptyState } from "@/components/empty-state";
import { FormMessage } from "@/components/form-field";
import { MinutesText } from "@/components/minutes-text";
import { PaceChip } from "@/components/pace-chip";
import { PunchDayTable } from "@/components/punch-day-table";
import { StatusChip } from "@/components/status-chip";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkLogSheet } from "@/components/work-log-sheet";
import { sessionConsent } from "@/lib/browser-session";
import { canClockWithApp } from "@/lib/consent";
import { addDays, rollingWeek, type RosterDot } from "@/lib/periods";
import { loadClockStatus, loadInternKpi, loadNotifications, loadScheduledDays, loadTodayBoard } from "@/lib/data";
import { darwinDateKey, formatDay, formatDayTime, formatTime, formatTimeOfDay, relativeOrDate } from "@/lib/darwin";
import { ACTION_LABEL, errorText, type ClockAction, type Profile } from "@/lib/daymark";
import { formatMinutes } from "@/lib/minutes";
import { asRecord, owedLabel, type ClockStatus, type InternKpi, type TodayBoard } from "@/lib/placement-ui";
import { applyQueue, removeFromQueue } from "@/lib/offline-queue";
import { isNetworkError } from "@/lib/offline-sync";
import { loadPunches, type PunchCard } from "@/lib/punches";
import { clockState, minutesOnDay, minutesSince } from "@/lib/time";
import { createClient } from "@/lib/supabase/client";
import { useLoad, useOnline } from "@/lib/use-load";
import { cn } from "@/lib/utils";

type DeskExtras = {
  status: ClockStatus | null;
  kpi: InternKpi | null;
  board: TodayBoard | null;
  notes: Awaited<ReturnType<typeof loadNotifications>>;
  roster: RosterDot[];
  dayKind: DayKind | null;
};

type DayKind = { kind: "full_day" | "work_based"; status: string | null };

const tick = (onChange: () => void) => {
  const timer = window.setInterval(onChange, 15_000);
  return () => window.clearInterval(timer);
};

/** The current minute, for display only: re-renders once a minute. */
function useMinute() {
  const minute = useSyncExternalStore(tick, () => Math.floor(Date.now() / 60_000), () => 0);
  return new Date(minute * 60_000);
}

function readKpi(value: unknown): InternKpi | null {
  const row = asRecord(value);
  if (!row || typeof row.placement_id !== "string") return null;
  return value as InternKpi;
}

function readBoard(value: unknown): TodayBoard | null {
  const row = asRecord(value);
  if (!row || !Array.isArray(row.people)) return null;
  return value as TodayBoard;
}

export function ClockDesk({ profile }: { profile: Profile }) {
  const online = useOnline();
  const now = useMinute();
  const consent = use(sessionConsent());
  const load = useCallback(() => loadPunches({ userId: profile.id, limit: 20 }), [profile.id]);
  const [punches, reload] = useLoad(load);
  const loadExtras = useCallback(async (): Promise<DeskExtras> => {
    const [status, kpi, board, notes] = await Promise.all([
      loadClockStatus().catch(() => null),
      loadInternKpi().catch(() => null),
      loadTodayBoard().catch(() => null),
      loadNotifications(profile.id, 2).catch(() => []),
    ]);
    // Your roster: today and the next six days, from the server's Darwin date.
    const today = status?.today ?? darwinDateKey(new Date());
    const pid = status?.placement?.id ?? readKpi(kpi)?.placement_id ?? null;
    const [days, dayKind] = await Promise.all([
      pid ? loadScheduledDays(pid, today, addDays(today, 6)).catch(() => []) : [],
      pid
        ? createClient()
            .from("daymark_day_kinds")
            .select("kind, status")
            .eq("placement_id", pid)
            .eq("work_date", today)
            .maybeSingle()
            .then(({ data }) => (data as DayKind | null) ?? null)
        : null,
    ]);
    const roster = rollingWeek(today, days.filter((day) => day.status === "scheduled").map((day) => day.work_date));
    return { status, kpi: readKpi(kpi), board: readBoard(board), notes, roster, dayKind };
  }, [profile.id]);
  const [extras, reloadExtras] = useLoad(loadExtras);
  const extrasData = extras.status === "ready" ? extras.data : null;
  const placementId = extrasData?.status?.placement?.id ?? extrasData?.kpi?.placement_id ?? null;
  const owed = extrasData?.kpi?.owed ?? 0;
  const [sheet, setSheet] = useState<ClockAction | null>(null);
  const [logDate, setLogDate] = useState<string | null>(null);
  const [catchUpOpen, setCatchUpOpen] = useState(false);
  const reloadAll = useCallback(() => {
    reload();
    reloadExtras();
  }, [reload, reloadExtras]);
  const { queued, needsConsent } = useOfflineClocks(profile.id, reloadAll);
  // With no signal, Home runs on the last status this phone saw plus the clocks waiting to send (D35).
  const [cachedStatus] = useState(() => readCachedStatus(profile.id));
  const [localKind, setLocalKind] = useState(() => readLocalDayKind(profile.id, darwinDateKey(new Date())));
  useEffect(() => {
    if (extrasData?.status) cacheStatus(profile.id, extrasData.status);
  }, [extrasData, profile.id]);

  function chooseOffline(kind: DayKind["kind"]) {
    saveLocalDayKind(profile.id, darwinDateKey(new Date()), kind);
    setLocalKind(kind);
  }

  function clocked(action: ClockAction, occurredAt: string, offline: boolean) {
    const at = formatTime(occurredAt);
    if (offline) {
      toast.success(`Saved on this phone at ${at}. It sends when you're back online; your supervisor confirms it.`);
      setSheet(null);
      return;
    }
    toast.success(
      action === "shift_in"
        ? `You're clocked in at ${at}.`
        : action === "break_start"
          ? `Your break started at ${at}.`
          : action === "break_end"
            ? `Welcome back. Your break ended at ${at}.`
            : `You're clocked out at ${at}.`,
    );
    setSheet(null);
    reloadAll();
  }

  const firstName = profile.display_name.split(/\s+/)[0];
  // Yesterday's saved status would show a shift that's long over: only today's counts.
  const status = extrasData?.status ?? (online || cachedStatus?.today !== darwinDateKey(now) ? null : cachedStatus);
  // The server's Darwin date and state win: they're what the clock rules use.
  const todayKey = status?.today ?? darwinDateKey(now);
  const kpi = extrasData?.kpi ?? null;
  const board = extrasData?.board ?? null;
  const todayPunches = punches.status === "ready" ? punches.data.filter((punch) => darwinDateKey(punch.occurred_at) === todayKey) : [];
  const latestPhoto = punches.status === "ready" ? (punches.data.find((punch) => punch.photoUrl)?.photoUrl ?? null) : null;
  const clock = punches.status === "ready" ? clockState(punches.data, todayKey) : null;
  const state = applyQueue(status?.state ?? (clock?.clockedIn ? "in" : clock?.onBreak ? "break" : "out"), queued);
  const dayKind = extrasData?.dayKind ?? (localKind ? { kind: localKind as DayKind["kind"], status: localKind === "work_based" ? "pending" : null } : null);
  const waiting = queued.filter((item) => item.kind === "clock" && !item.refused).length;
  const refused = queued.filter((item) => item.refused);
  const refusedWhy = [...new Set(refused.map((item) => item.refused?.replace(/\.$/, "")))].join("; ");
  const since = (state === "in" ? status?.open_since : state === "break" ? status?.break_since : null) ?? clock?.since ?? null;
  const actions = status?.actions ?? {};

  return (
    <div className="flex flex-col gap-6">
      {!online ? (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-warn-bg px-4 py-3 text-warn">
          <WifiOff aria-hidden className="size-4 shrink-0" />
          You&apos;re offline — you can still clock; it sends when you&apos;re back online
        </p>
      ) : null}
      {waiting > 0 ? (
        <p role="status" className="rounded-lg bg-muted px-4 py-3">
          {waiting === 1 ? "1 clock is" : `${waiting} clocks are`} waiting to send from this phone. Your supervisor confirms{" "}
          {waiting === 1 ? "it" : "them"} once sent.
          {needsConsent ? (
            <>
              {" "}
              <Link href="/consent" className="font-semibold text-primary underline">
                Review the notice
              </Link>{" "}
              first to send {waiting === 1 ? "it" : "them"}.
            </>
          ) : null}
        </p>
      ) : null}
      {refused.length > 0 ? (
        <div role="status" className="flex flex-col items-start gap-3 rounded-lg bg-warn-bg px-4 py-3 text-warn">
          <p>
            {refused.length === 1 ? "1 clock" : `${refused.length} clocks`} couldn&apos;t be sent: {refusedWhy}. Ask your
            supervisor to add the time.
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void Promise.all(refused.map((item) => removeFromQueue(item.id))).catch(() => undefined)}
          >
            Dismiss
          </Button>
        </div>
      ) : null}

      {status?.placement?.read_only ? (
        <p role="status" className="rounded-lg bg-muted px-4 py-3">
          Your placement has ended. You can still view your records until{" "}
          {status.placement.delete_on ? formatDay(status.placement.delete_on) : "the retention date"}.
        </p>
      ) : null}

      <section aria-labelledby="clock-title" className="flex flex-col gap-5 rounded-xl bg-card p-5 shadow-card sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 id="clock-title">Hi {firstName} 👋</h1>
            <p className="text-muted-foreground">DGK Business Consultancy</p>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{kpi ? `Week ${kpi.week_no} of ${kpi.total_weeks}` : formatDay(now)}</span>
              {kpi ? <PaceChip daysLate={kpi.days_late} /> : null}
            </div>
          </div>
          <Avatar url={latestPhoto} name={profile.display_name} size={64} />
        </div>
        {punches.status === "loading" ? (
          <div role="status" className="flex flex-col gap-4">
            <span className="sr-only">Checking location…</span>
            <p className="text-lg font-semibold">Checking location…</p>
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-16 w-full rounded-[1584px]" />
          </div>
        ) : punches.status === "error" && online ? (
          <div className="flex flex-col items-start gap-3">
            <FormMessage>{punches.message}</FormMessage>
            <Button type="button" variant="secondary" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : !canClockWithApp(consent) ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-lg font-semibold">Allow location and selfie to clock in</p>
            <p className="text-muted-foreground">
              DGK Clock takes your location and a live selfie each time you clock in, take a break or clock out. Without
              both, you can&apos;t clock.
            </p>
            <Link href="/consent" className={buttonVariants()}>
              Review and allow
            </Link>
          </div>
        ) : (
          <ClockPanel
            state={state}
            since={since}
            now={now}
            todayKey={todayKey}
            punches={punches.status === "ready" ? punches.data : []}
            status={status}
            dayKind={dayKind}
            onOpen={setSheet}
            onWriteLog={setLogDate}
            onDayKind={reloadExtras}
            onDayKindOffline={chooseOffline}
          />
        )}
      </section>

      {extrasData && extrasData.roster.length > 0 && placementId ? <RosterDots days={extrasData.roster} /> : null}

      <TodayStrip status={status} board={board} loading={extras.status === "loading"} />

      {kpi ? (
        <section aria-labelledby="week-metrics" className="grid gap-3 sm:grid-cols-2">
          <h2 id="week-metrics" className="sr-only">
            This week
          </h2>
          <div className="rounded-xl bg-card p-4 shadow-card">
            <p className="caption font-semibold text-muted-foreground">This week</p>
            <p className="text-lg font-semibold">
              <MinutesText minutes={kpi.this_week.counted} /> / <MinutesText minutes={kpi.this_week.scheduled} />
            </p>
          </div>
          <div className="rounded-xl bg-card p-4 shadow-card">
            <p className="caption font-semibold text-muted-foreground">Balance</p>
            <p className="text-lg font-semibold">{owedLabel(kpi.owed)}</p>
          </div>
        </section>
      ) : extras.status === "loading" ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : extras.status === "error" ? (
        <div className="flex flex-col items-start gap-3">
          <FormMessage>{extras.message}</FormMessage>
          <Button type="button" variant="secondary" onClick={reloadExtras}>
            Try again
          </Button>
        </div>
      ) : null}

      {owed > 0 ? (
        <section aria-labelledby="catch-up-title" className="flex flex-col gap-3 rounded-xl bg-card p-6 shadow-card">
          <h2 id="catch-up-title">Catch up</h2>
          <p className="text-muted-foreground">{owedLabel(owed)}</p>
          <Button type="button" disabled={!placementId} onClick={() => setCatchUpOpen(true)}>
            Pick catch-up days
          </Button>
        </section>
      ) : null}

      <section aria-labelledby="today-title" className="flex flex-col gap-3">
        <h2 id="today-title">Today</h2>
        {punches.status === "loading" ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : punches.status === "ready" ? (
          todayPunches.length > 0 ? (
            <PunchDayTable punches={todayPunches} />
          ) : (
            <EmptyState>No clock-ins yet today. When you clock in, the time and your selfie show here.</EmptyState>
          )
        ) : null}
      </section>

      <section aria-labelledby="notes-title" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="notes-title">Notifications</h2>
          <Link href="/notifications" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary">
            See all
          </Link>
        </div>
        {extras.status === "loading" ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : extrasData && extrasData.notes.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {extrasData.notes.map((note) => (
              <li key={note.id} className="rounded-xl bg-card p-4 shadow-card">
                <p className="font-semibold">{note.title}</p>
                <p className="text-sm text-muted-foreground">{note.body}</p>
                <p className="caption mt-1 text-muted-foreground">{relativeOrDate(note.created_at, now)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState action={<Link href="/notifications" className={buttonVariants({ variant: "secondary" })}>Open notifications</Link>}>
            No notifications yet.
          </EmptyState>
        )}
      </section>

      {sheet ? (
        <ClockSheet
          state={state}
          initial={sheet}
          actions={actions}
          site={status?.site ?? null}
          logDate={status?.open_work_date ?? todayKey}
          userId={profile.id}
          dayKind={dayKind?.kind ?? null}
          onClose={() => {
            setSheet(null);
            reloadAll(); // a typed-in time may have saved before the live clock
          }}
          onDone={clocked}
        />
      ) : null}

      {logDate ? (
        <WorkLogSheet key={logDate} open onClose={() => setLogDate(null)} workDate={logDate} onSaved={reloadAll} />
      ) : null}

      {catchUpOpen && placementId ? (
        <CatchUpSheet placementId={placementId} onClose={() => setCatchUpOpen(false)} onDone={reloadExtras} />
      ) : null}
    </div>
  );
}

function ClockPanel({
  state,
  since,
  now,
  todayKey,
  punches,
  status,
  dayKind,
  onOpen,
  onWriteLog,
  onDayKind,
  onDayKindOffline,
}: {
  state: ClockStatus["state"];
  since: string | null;
  now: Date;
  todayKey: string;
  punches: PunchCard[];
  status: ClockStatus | null;
  onOpen: (action: ClockAction) => void;
  dayKind: DayKind | null;
  onWriteLog: (date: string) => void;
  onDayKind: () => void;
  onDayKindOffline: (kind: DayKind["kind"]) => void;
}) {
  const actions = status?.actions ?? {};
  // Break shows from 10 am to 2 pm (the server says when); Finish is always there (Dilip, 5 Oct).
  const breakOpen = state === "in" && actions.break_start === null;
  const sinceText = since ? (darwinDateKey(since) === todayKey ? formatTime(since) : formatDayTime(since)) : "";

  if (state === "in") {
    return (
      <>
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-lg font-semibold">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-ok" />
            Clocked in since {sinceText}
          </p>
          <p aria-live="polite" className="text-muted-foreground">
            {formatMinutes(minutesOnDay(punches, todayKey, now))} today
          </p>
        </div>
        <div className={cn("grid gap-2", breakOpen && "grid-cols-2")}>
          {breakOpen ? (
            <Button type="button" size="lg" onClick={() => onOpen("break_start")}>
              <Coffee aria-hidden />
              {ACTION_LABEL.break_start}
            </Button>
          ) : null}
          <Button type="button" size="lg" variant={breakOpen ? "secondary" : "default"} onClick={() => onOpen("shift_out")}>
            <LogOut aria-hidden />
            {ACTION_LABEL.shift_out}
          </Button>
        </div>
      </>
    );
  }

  if (state === "break") {
    return (
      <>
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-lg font-semibold">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-warn" />
            On a break since {sinceText}
          </p>
          <p aria-live="polite" className="text-muted-foreground">
            {since ? `${formatMinutes(minutesSince(since, now))} so far` : null}
          </p>
        </div>
        <Button type="button" size="lg" className="w-full" onClick={() => onOpen("break_end")}>
          <LogIn aria-hidden />
          {ACTION_LABEL.break_end}
        </Button>
        <Button type="button" size="lg" variant="secondary" className="w-full" onClick={() => onOpen("shift_out")}>
          <LogOut aria-hidden />
          Not coming back? {ACTION_LABEL.shift_out}
        </Button>
      </>
    );
  }

  const blocked = status?.state === "out" ? status.blocked : null;
  if (blocked) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-lg font-semibold">{blocked}</p>
        {status?.block_code === "work_log" ? (
          <Button type="button" onClick={() => onWriteLog(previousShiftDate(punches, todayKey))}>
            Write log
          </Button>
        ) : status?.block_code === "full" ? (
          <Link href="/clock/schedule" className={buttonVariants()}>
            Request an extra spot
          </Link>
        ) : (
          <p className="text-muted-foreground">{blockFix(status?.block_code)}</p>
        )}
      </div>
    );
  }

  const worked = minutesOnDay(punches, todayKey, now);
  const lastOut = punches.find((punch) => punch.event_type === "shift_out" && darwinDateKey(punch.occurred_at) === todayKey);
  return (
    <>
      <p className="text-lg font-semibold">
        {lastOut && worked > 0
          ? `Clocked out at ${formatTime(lastOut.occurred_at)} · ${formatMinutes(worked)} today`
          : "You're not clocked in."}
      </p>
      <DayKindPicker value={dayKind} onSaved={onDayKind} onOffline={onDayKindOffline} />
      <Button type="button" size="lg" className="w-full" disabled={!dayKind} onClick={() => onOpen("shift_in")}>
        <LogIn aria-hidden />
        {ACTION_LABEL.shift_in}
      </Button>
      <p className="text-sm text-muted-foreground">
        {lastOut ? "Clocked out by mistake? Clock in again any time." : "We'll ask for your location and a selfie each time you clock."}
      </p>
    </>
  );
}

const DAY_KINDS = [
  { kind: "full_day", label: "Full day", hint: "9–5 · 8 h with a break" },
  { kind: "work_based", label: "Work-based", hint: "5 h · no break · finish your tasks" },
] as const;

/** Required before the first clock-in of a day (8 Oct): a work-based day counts as full once staff approve it. */
function DayKindPicker({
  value,
  onSaved,
  onOffline,
}: {
  value: DayKind | null;
  onSaved: () => void;
  onOffline: (kind: DayKind["kind"]) => void;
}) {
  const [saving, setSaving] = useState(false);
  const decided = value?.kind === "work_based" && value.status !== null && value.status !== "pending";

  async function choose(kind: DayKind["kind"]) {
    if (kind === value?.kind) return;
    if (!navigator.onLine) return onOffline(kind); // sent with the offline clock-in
    setSaving(true);
    const { error } = await createClient().rpc("choose_day_kind", { kind });
    setSaving(false);
    if (error && isNetworkError(error)) onOffline(kind);
    else if (error) toast.error(errorText(error, "That didn't save. Try again."));
    else onSaved();
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-semibold">Today is a…</legend>
      <div role="radiogroup" aria-label="Today is a" className="grid grid-cols-2 gap-2">
        {DAY_KINDS.map((item) => (
          <button
            key={item.kind}
            type="button"
            role="radio"
            aria-checked={value?.kind === item.kind}
            disabled={saving || decided}
            onClick={() => void choose(item.kind)}
            className={cn(
              "flex min-h-11 flex-col items-start rounded-lg border-2 p-3 text-left transition-colors",
              value?.kind === item.kind ? "border-primary bg-primary/10" : "border-border",
            )}
          >
            <span className="font-semibold">{item.label}</span>
            <span className="text-sm text-muted-foreground">{item.hint}</span>
          </button>
        ))}
      </div>
      {value?.kind === "work_based" ? (
        <p className="text-sm text-muted-foreground">
          {value.status === "approved"
            ? "Approved: today counts as a full day."
            : value.status === "declined"
              ? "Declined: the hours you work count."
              : "Your supervisor approves it; then it counts as a full day."}
        </p>
      ) : !value ? (
        <p className="text-sm text-muted-foreground">Pick one to clock in.</p>
      ) : null}
    </fieldset>
  );
}

const WEEKDAY_LETTER = ["M", "T", "W", "T", "F", "S", "S"];

/** Home's "Your roster": today and the next six days; a filled dot is a scheduled day. */
function RosterDots({ days }: { days: RosterDot[] }) {
  return (
    <Link
      href="/clock/schedule"
      aria-label={`Your roster: ${days.map((day) => `${formatDay(day.date)} ${day.scheduled ? "working" : "off"}`).join(", ")}. Open your schedule.`}
      className="flex flex-col gap-3 rounded-xl bg-primary p-5 text-primary-foreground shadow-card"
    >
      <p className="caption font-semibold uppercase tracking-wide opacity-80">Your roster</p>
      <ol aria-hidden className="grid grid-cols-7 gap-1 text-center">
        {days.map((day) => (
          <li key={day.date} className="flex flex-col items-center gap-2">
            <span className={cn("text-[15px]", day.today ? "font-bold" : "font-medium opacity-90")}>
              {WEEKDAY_LETTER[day.weekday - 1]}
            </span>
            <span
              className={cn(
                "size-7 rounded-full border-2",
                day.scheduled ? "border-primary-foreground bg-primary-foreground/70" : "border-primary-foreground/40",
                day.today && "ring-2 ring-primary-foreground ring-offset-2 ring-offset-primary",
              )}
            />
          </li>
        ))}
      </ol>
    </Link>
  );
}

function TodayStrip({
  status,
  board,
  loading,
}: {
  status: ClockStatus | null;
  board: TodayBoard | null;
  loading: boolean;
}) {
  if (loading && !status && !board) return <Skeleton className="h-20 w-full rounded-xl" />;
  const scheduled = status?.scheduled;
  const me = board?.people.find((person) => person.me);
  return (
    <section aria-labelledby="today-strip" className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card">
      <h2 id="today-strip" className="sr-only">
        Today&apos;s office
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {scheduled ? (
          <p className="font-semibold">
            {formatTimeOfDay(scheduled.start)} – {formatTimeOfDay(scheduled.end)}
          </p>
        ) : (
          <p className="text-muted-foreground">Not scheduled today</p>
        )}
        {me?.status === "late" || me?.late ? <StatusChip tone="warn" label="Late" /> : null}
        {board?.label ? <p className="text-muted-foreground">{board.label} in today</p> : null}
      </div>
      {board && board.people.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {board.people.map((person) => (
            <li
              key={`${person.display_name}-${person.initials}`}
              title={person.display_name}
              className="grid size-11 place-items-center rounded-[1584px] bg-muted text-xs font-semibold"
            >
              {person.initials}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function previousShiftDate(punches: PunchCard[], today: string) {
  const dates = punches.map((punch) => darwinDateKey(punch.occurred_at)).filter((date) => date < today);
  return dates.sort().at(-1) ?? addDays(today, -1);
}

// Clocking is always on (26 Sep, Dilip): no more "weekend"/"closure"/"window" block codes.
function blockFix(code: string | null | undefined) {
  if (code === "read_only") return "Your placement has ended.";
  return "Check the reason, then try again.";
}

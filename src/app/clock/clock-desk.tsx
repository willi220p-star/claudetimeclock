"use client";

import { use, useCallback, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn, LogOut, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { PrivacyCard } from "@/app/clock/privacy-card";
import { SelfieCamera } from "@/app/clock/selfie-camera";
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
import { addDays } from "@/lib/periods";
import {
  loadCatchUp,
  loadClockStatus,
  loadInternKpi,
  loadNotifications,
  loadTodayBoard,
} from "@/lib/data";
import { darwinDateKey, formatDay, formatDayTime, formatTime, formatTimeOfDay, relativeOrDate } from "@/lib/darwin";
import { EVENT_LABEL, PHOTO_BUCKET, errorText, type ClockChallenge, type EventType, type Profile } from "@/lib/daymark";
import { formatMinutes } from "@/lib/minutes";
import { asRecord, owedLabel, type ClockStatus, type InternKpi, type TodayBoard } from "@/lib/placement-ui";
import { loadPunches, type PunchCard } from "@/lib/punches";
import { createClient } from "@/lib/supabase/client";
import { clockState, minutesSince } from "@/lib/time";
import { useLoad, useOnline } from "@/lib/use-load";

type Phase =
  | { name: "idle" }
  | { name: "starting"; eventType: EventType }
  | { name: "camera"; challenge: ClockChallenge }
  | { name: "saving"; challenge: ClockChallenge; step: string };

type DeskExtras = {
  status: ClockStatus | null;
  kpi: InternKpi | null;
  board: TodayBoard | null;
  notes: Awaited<ReturnType<typeof loadNotifications>>;
};

const tick = (onChange: () => void) => {
  const timer = window.setInterval(onChange, 15_000);
  return () => window.clearInterval(timer);
};

/** The current minute, for display only: re-renders once a minute. */
function useMinute() {
  const minute = useSyncExternalStore(tick, () => Math.floor(Date.now() / 60_000), () => 0);
  return new Date(minute * 60_000);
}

function locationMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location is blocked. Allow location for this site in your browser settings, then tap Clock in again.";
  }
  if (error.code === error.TIMEOUT) {
    return "Your location took too long. Step outside or near a window, then tap Clock in again.";
  }
  return "Your phone couldn't find your location. Turn on location services, then tap Clock in again.";
}

/** Read the location once, only after the tap; never a continuous watch (security review §2.4). */
function readLocation() {
  return new Promise<GeolocationCoordinates>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser can't share your location. Try Chrome or Safari on your phone."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position.coords),
      (error) => reject(new Error(locationMessage(error))),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
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
  const router = useRouter();
  const online = useOnline();
  const now = useMinute();
  const initialConsent = use(sessionConsent());
  const [consent, setConsent] = useState(initialConsent);
  const load = useCallback(() => loadPunches({ userId: profile.id, limit: 20 }), [profile.id]);
  const [punches, reload] = useLoad(load);
  const loadExtras = useCallback(async (): Promise<DeskExtras> => {
    const [status, kpi, board, notes] = await Promise.all([
      loadClockStatus().catch(() => null),
      loadInternKpi().catch(() => null),
      loadTodayBoard().catch(() => null),
      loadNotifications(profile.id, 2).catch(() => []),
    ]);
    return { status, kpi: readKpi(kpi), board: readBoard(board), notes };
  }, [profile.id]);
  const [extras, reloadExtras] = useLoad(loadExtras);
  const extrasData = extras.status === "ready" ? extras.data : null;
  const placementId = extrasData?.status?.placement?.id ?? extrasData?.kpi?.placement_id ?? null;
  const owed = extrasData?.kpi?.owed ?? 0;
  const loadPlan = useCallback(
    () => (placementId && owed > 0 ? loadCatchUp(placementId).catch(() => null) : Promise.resolve(null)),
    [placementId, owed],
  );
  const [plan, reloadPlan] = useLoad(loadPlan);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [catchUpOpen, setCatchUpOpen] = useState(false);
  const [asking, setAsking] = useState(false);

  function fail(error: unknown, fallback: string) {
    setPhase({ name: "idle" });
    if (typeof error === "object" && error !== null && "hint" in error && error.hint === "consent") {
      router.push("/consent");
      return;
    }
    setProblem(errorText(error, fallback));
  }

  async function start(eventType: EventType) {
    setProblem(null);
    setPhase({ name: "starting", eventType });
    const { data, error } = await createClient().rpc("start_clock", { event_type: eventType });
    if (error) return fail(error, "That didn't start. Try again.");
    setPhase({ name: "camera", challenge: data as ClockChallenge });
  }

  async function save(challenge: ClockChallenge, photo: Blob) {
    const supabase = createClient();
    try {
      setPhase({ name: "saving", challenge, step: "Checking your location…" });
      const coords = await readLocation();
      setPhase({ name: "saving", challenge, step: "Saving your selfie…" });
      const { error: uploadError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(challenge.photo_path, photo, { contentType: "image/jpeg", upsert: false });
      if (uploadError) throw uploadError;
      setPhase({ name: "saving", challenge, step: challenge.event_type === "shift_in" ? "Saving your clock-in…" : "Saving your clock-out…" });
      const { data, error } = await supabase.rpc("clock_punch", {
        challenge_id: challenge.challenge_id,
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy_m: coords.accuracy,
        client_reported_at: new Date().toISOString(), // forensics only; the server stamps the time
      });
      if (error) throw error;
      const at = formatTime((data as { occurred_at: string }).occurred_at);
      toast.success(challenge.event_type === "shift_in" ? `You're clocked in at ${at}.` : `You're clocked out at ${at}.`);
      setPhase({ name: "idle" });
      reload();
      reloadExtras();
    } catch (error) {
      fail(error, "That didn't save. Tap the button to try again.");
    }
  }

  async function askSupervisor(eventType: EventType) {
    setAsking(true);
    setProblem(null);
    const { error } = await createClient().rpc("request_supervisor_confirmation", { event_type: eventType });
    setAsking(false);
    if (error) {
      setProblem(errorText(error, "That request didn't send. Try again."));
      return;
    }
    toast.success(eventType === "shift_in" ? "Asked your supervisor to confirm you're in." : "Asked your supervisor to confirm you left.");
    reloadExtras();
  }

  const firstName = profile.display_name.split(/\s+/)[0];
  const todayKey = darwinDateKey(now);
  const status = extrasData?.status ?? null;
  const kpi = extrasData?.kpi ?? null;
  const board = extrasData?.board ?? null;
  const todayPunches = punches.status === "ready" ? punches.data.filter((punch) => darwinDateKey(punch.occurred_at) === todayKey) : [];
  const logDate = previousShiftDate(punches.status === "ready" ? punches.data : [], todayKey);
  const catchUp = plan.status === "ready" ? plan.data : null;

  return (
    <div className="flex flex-col gap-6">
      {!online ? (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-warn-bg px-4 py-3 text-warn">
          <WifiOff aria-hidden className="size-4 shrink-0" />
          You&apos;re offline — clocking needs a connection
        </p>
      ) : null}

      {status?.placement?.read_only ? (
        <p role="status" className="rounded-lg bg-muted px-4 py-3">
          Your placement has ended. You can still view your records until{" "}
          {status.placement.delete_on ? formatDay(status.placement.delete_on) : "the retention date"}.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1>Hi {firstName}</h1>
          {kpi ? <PaceChip daysLate={kpi.days_late} /> : null}
        </div>
        <p className="text-muted-foreground">
          {kpi ? `Week ${kpi.week_no} of ${kpi.total_weeks}` : formatDay(now)}
        </p>
      </div>

      <section aria-labelledby="clock-title" className="flex flex-col gap-4 rounded-xl bg-card p-6 shadow-card">
        <h2 id="clock-title" className="sr-only">
          Clock
        </h2>
        {punches.status === "loading" ? (
          <div role="status" className="flex flex-col gap-4">
            <span className="sr-only">Checking location…</span>
            <p className="text-lg font-semibold">Checking location…</p>
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-16 w-full rounded-[1584px]" />
          </div>
        ) : punches.status === "error" ? (
          <div className="flex flex-col items-start gap-3">
            <FormMessage>{punches.message}</FormMessage>
            <Button type="button" variant="secondary" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : !canClockWithApp(consent) ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-lg font-semibold">Your supervisor confirms you&apos;re here</p>
            <p className="text-muted-foreground">
              You chose not to share location or a selfie, so DGK Clock won&apos;t ask for them. Let your supervisor
              know when you arrive and leave. If you change your mind, you can allow both.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={asking || !online}
                onClick={() => void askSupervisor(status?.next_event === "shift_out" ? "shift_out" : "shift_in")}
              >
                {asking ? "Asking…" : status?.next_event === "shift_out" ? "Ask supervisor to confirm I left" : "Ask supervisor to confirm I'm in"}
              </Button>
              <Link href="/consent" className={buttonVariants({ variant: "secondary" })}>
                Change my choices
              </Link>
            </div>
          </div>
        ) : (
          <ClockPanel
            state={clockState(punches.data)}
            now={now}
            todayKey={todayKey}
            punches={punches.data}
            status={status}
            busy={phase.name !== "idle"}
            online={online}
            step={phase.name === "starting" ? "Getting ready…" : phase.name === "saving" ? phase.step : null}
            onStart={start}
            onWriteLog={() => setLogOpen(true)}
          />
        )}
        {problem ? <FormMessage>{problem}</FormMessage> : null}
      </section>

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
            <p className="text-lg font-semibold">
              {owedLabel(kpi.owed)}
              {kpi.owed !== 0 ? (
                <>
                  {" "}
                  · <MinutesText minutes={kpi.owed} />
                </>
              ) : null}
            </p>
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
          <Button type="button" disabled={plan.status !== "ready" || !catchUp} onClick={() => setCatchUpOpen(true)}>
            Catch up
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

      <PrivacyCard consent={consent} onChange={setConsent} />

      {phase.name === "camera" ? (
        <SelfieCamera
          gesture={phase.challenge.gesture}
          onUse={(photo) => void save(phase.challenge, photo)}
          onCancel={() => setPhase({ name: "idle" })}
        />
      ) : null}

      <WorkLogSheet
        open={logOpen}
        onClose={() => setLogOpen(false)}
        workDate={logDate}
        onSaved={() => {
          reload();
          reloadExtras();
        }}
      />

      {catchUp && placementId ? (
        <CatchUpSheet
          open={catchUpOpen}
          onClose={() => setCatchUpOpen(false)}
          plan={catchUp}
          placementId={placementId}
          onDone={() => {
            reloadExtras();
            reloadPlan();
          }}
        />
      ) : null}
    </div>
  );
}

function ClockPanel({
  state,
  now,
  todayKey,
  punches,
  status,
  busy,
  online,
  step,
  onStart,
  onWriteLog,
}: {
  state: ReturnType<typeof clockState>;
  now: Date;
  todayKey: string;
  punches: PunchCard[];
  status: ClockStatus | null;
  busy: boolean;
  online: boolean;
  step: string | null;
  onStart: (eventType: EventType) => void;
  onWriteLog: () => void;
}) {
  const counted = countedToday(punches, todayKey);
  const done = !state.clockedIn && counted !== null;
  const blocked = !state.clockedIn && !done ? status?.blocked : null;
  const blockCode = blocked ? status?.block_code : null;

  if (busy && step) {
    return (
      <>
        <p className="text-lg font-semibold">{step === "Checking your location…" ? "Checking location…" : step}</p>
        <Button type="button" size="lg" className="w-full" disabled>
          {state.clockedIn ? EVENT_LABEL.shift_out : EVENT_LABEL.shift_in}
        </Button>
      </>
    );
  }

  if (state.clockedIn) {
    return (
      <>
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold">
            You&apos;re in since{" "}
            {darwinDateKey(state.since) === todayKey ? formatTime(state.since) : formatDayTime(state.since)}
          </p>
          <p aria-live="polite" className="text-muted-foreground">
            {formatMinutes(minutesSince(state.since, now))} so far
          </p>
        </div>
        <Button type="button" size="lg" variant="secondary" className="w-full" disabled={busy || !online} onClick={() => onStart("shift_out")}>
          <LogOut aria-hidden />
          {EVENT_LABEL.shift_out}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {step ?? "We'll ask for camera and location for this clock-out only."}
        </p>
      </>
    );
  }

  if (done) {
    return (
      <p className="text-lg font-semibold">Day done · {formatMinutes(counted)} counted</p>
    );
  }

  if (blocked) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-lg font-semibold">{blocked}</p>
        {blockCode === "work_log" ? (
          <Button type="button" onClick={onWriteLog}>
            Write log
          </Button>
        ) : blockCode === "full" ? (
          <Link href="/clock/schedule" className={buttonVariants()}>
            Request an extra spot
          </Link>
        ) : (
          <p className="text-muted-foreground">{blockFix(blockCode)}</p>
        )}
      </div>
    );
  }

  return (
    <>
      <p className="text-lg font-semibold">You&apos;re not clocked in.</p>
      <Button type="button" size="lg" className="w-full" disabled={busy || !online} onClick={() => onStart("shift_in")}>
        <LogIn aria-hidden />
        {EVENT_LABEL.shift_in}
      </Button>
      <p role="status" className="text-sm text-muted-foreground">
        {step ?? "We'll ask for camera and location for this clock-in only."}
      </p>
    </>
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

function countedToday(punches: PunchCard[], todayKey: string) {
  const day = punches.filter((punch) => darwinDateKey(punch.occurred_at) === todayKey);
  const inn = day.filter((punch) => punch.event_type === "shift_in").sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))[0];
  const out = day
    .filter((punch) => punch.event_type === "shift_out")
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
    .at(-1);
  if (!inn || !out) return null;
  const raw = Math.max(0, Math.floor((Date.parse(out.occurred_at) - Date.parse(inn.occurred_at)) / 60_000));
  return raw > 300 ? raw - 30 : raw;
}

function blockFix(code: string | null | undefined) {
  if (code === "window") return "Wait until clocking opens, then try again.";
  if (code === "weekend") return "Come back on a weekday.";
  if (code === "closure") return "The office is closed today.";
  if (code === "read_only") return "Your placement has ended.";
  return "Check the reason, then try again.";
}

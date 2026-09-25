"use client";

import { use, useCallback, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn, LogOut, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { PrivacyCard } from "@/app/clock/privacy-card";
import { SelfieCamera } from "@/app/clock/selfie-camera";
import { EmptyState } from "@/components/empty-state";
import { FormMessage } from "@/components/form-field";
import { PunchDayTable } from "@/components/punch-day-table";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { sessionConsent } from "@/lib/browser-session";
import { canClockWithApp } from "@/lib/consent";
import { darwinDateKey, formatDay, formatDayTime, formatTime } from "@/lib/darwin";
import { EVENT_LABEL, PHOTO_BUCKET, errorText, type ClockChallenge, type EventType, type Profile } from "@/lib/daymark";
import { formatMinutes } from "@/lib/minutes";
import { loadPunches } from "@/lib/punches";
import { createClient } from "@/lib/supabase/client";
import { clockState, minutesSince } from "@/lib/time";
import { useLoad, useOnline } from "@/lib/use-load";

type Phase =
  | { name: "idle" }
  | { name: "starting"; eventType: EventType }
  | { name: "camera"; challenge: ClockChallenge }
  | { name: "saving"; challenge: ClockChallenge; step: string };

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

// ponytail: Phase 4 replaces this with the full ClockCard state machine (§11.3).
export function ClockDesk({ profile }: { profile: Profile }) {
  const router = useRouter();
  const online = useOnline();
  const now = useMinute();
  const initialConsent = use(sessionConsent());
  const [consent, setConsent] = useState(initialConsent);
  const load = useCallback(() => loadPunches({ userId: profile.id, limit: 20 }), [profile.id]);
  const [punches, reload] = useLoad(load);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [problem, setProblem] = useState<string | null>(null);

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
    } catch (error) {
      fail(error, "That didn't save. Tap the button to try again.");
    }
  }

  const firstName = profile.display_name.split(/\s+/)[0];
  const todayKey = darwinDateKey(now);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-6">
      {!online ? (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-warn-bg px-4 py-3 text-warn">
          <WifiOff aria-hidden className="size-4 shrink-0" />
          You&apos;re offline — clocking needs a connection
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <h1>Hi {firstName}</h1>
        <p className="text-muted-foreground">{formatDay(now)}</p>
      </div>

      <section aria-labelledby="clock-title" className="flex flex-col gap-4 rounded-xl bg-card p-6 shadow-card">
        <h2 id="clock-title" className="sr-only">
          Clock
        </h2>
        {punches.status === "loading" ? (
          <div role="status" className="flex flex-col gap-4">
            <span className="sr-only">Loading your clock…</span>
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
            <Link href="/consent" className={buttonVariants({ variant: "secondary" })}>
              Change my choices
            </Link>
          </div>
        ) : (
          <ClockPanel
            state={clockState(punches.data)}
            now={now}
            todayKey={todayKey}
            busy={phase.name !== "idle"}
            online={online}
            step={phase.name === "starting" ? "Getting ready…" : phase.name === "saving" ? phase.step : null}
            onStart={start}
          />
        )}
        {problem ? <FormMessage>{problem}</FormMessage> : null}
      </section>

      <section aria-labelledby="today-title" className="flex flex-col gap-3">
        <h2 id="today-title">Today</h2>
        {punches.status === "loading" ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : punches.status === "ready" ? (
          punches.data.some((punch) => darwinDateKey(punch.occurred_at) === todayKey) ? (
            <PunchDayTable punches={punches.data.filter((punch) => darwinDateKey(punch.occurred_at) === todayKey)} />
          ) : (
            <EmptyState>No clock-ins yet today. When you clock in, the time and your selfie show here.</EmptyState>
          )
        ) : null}
      </section>

      <PrivacyCard consent={consent} onChange={setConsent} />

      {phase.name === "camera" ? (
        <SelfieCamera
          gesture={phase.challenge.gesture}
          onUse={(photo) => void save(phase.challenge, photo)}
          onCancel={() => setPhase({ name: "idle" })}
        />
      ) : null}
    </div>
  );
}

function ClockPanel({
  state,
  now,
  todayKey,
  busy,
  online,
  step,
  onStart,
}: {
  state: ReturnType<typeof clockState>;
  now: Date;
  todayKey: string;
  busy: boolean;
  online: boolean;
  step: string | null;
  onStart: (eventType: EventType) => void;
}) {
  const eventType: EventType = state.clockedIn ? "shift_out" : "shift_in";
  return (
    <>
      {state.clockedIn ? (
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold">
            You&apos;re in since{" "}
            {darwinDateKey(state.since) === todayKey ? formatTime(state.since) : formatDayTime(state.since)}
          </p>
          <p aria-live="polite" className="text-muted-foreground">
            {formatMinutes(minutesSince(state.since, now))} so far
          </p>
        </div>
      ) : (
        <p className="text-lg font-semibold">You&apos;re not clocked in.</p>
      )}
      <Button
        type="button"
        size="lg"
        variant={state.clockedIn ? "secondary" : "default"}
        className="w-full"
        disabled={busy || !online}
        onClick={() => onStart(eventType)}
      >
        {state.clockedIn ? <LogOut aria-hidden /> : <LogIn aria-hidden />}
        {EVENT_LABEL[eventType]}
      </Button>
      <p role="status" className="text-sm text-muted-foreground">
        {step ?? `We'll ask for camera and location for this ${state.clockedIn ? "clock-out" : "clock-in"} only.`}
      </p>
    </>
  );
}

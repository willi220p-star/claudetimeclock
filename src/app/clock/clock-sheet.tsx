"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Camera, RotateCcw, X } from "lucide-react";
import { captureJpeg, useFrontCamera } from "@/app/clock/selfie-camera";
import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/darwin";
import { ACTION_LABEL, PHOTO_BUCKET, errorText, formatDistance, type ClockAction, type ClockChallenge } from "@/lib/daymark";
import type { ClockStatus } from "@/lib/placement-ui";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Site = NonNullable<ClockStatus["site"]>;
type ClockState = ClockStatus["state"];
type Fix = { coords: GeolocationCoordinates; at: number };
type Shot = { blob: Blob; url: string };
type Step =
  | { name: "ready" }
  | { name: "log" }
  | { name: "starting" }
  | { name: "photo"; challenge: ClockChallenge }
  | { name: "review"; challenge: ClockChallenge; shot: Shot }
  | { name: "saving"; label: string };

type Segment = "start" | "break" | "finish";
const SEGMENTS: { key: Segment; label: string }[] = [
  { key: "start", label: "Start" },
  { key: "break", label: "Break" },
  { key: "finish", label: "Finish" },
];
const SAVING: Record<ClockAction, string> = {
  shift_in: "Saving your clock-in…",
  break_start: "Starting your break…",
  break_end: "Ending your break…",
  shift_out: "Saving your clock-out…",
};
const LOG_MIN = 10;
const LOG_MAX = 500;
const FRESH_MS = 120_000;

/** Which action a segment means in each state: on a break, Break ends it. */
function segmentAction(segment: Segment, state: ClockState): ClockAction | null {
  if (state === "out") return segment === "start" ? "shift_in" : null;
  if (state === "break") return segment === "break" ? "break_end" : null;
  return segment === "break" ? "break_start" : segment === "finish" ? "shift_out" : null;
}

function segmentOf(action: ClockAction): Segment {
  return action === "shift_in" ? "start" : action === "shift_out" ? "finish" : "break";
}

function locationMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location is blocked. Allow location for this site in your browser settings, then try again.";
  }
  if (error.code === error.TIMEOUT) return "Your location took too long. Step outside or near a window, then try again.";
  return "Your phone couldn't find your location. Turn on location services, then try again.";
}

/** Read the location once, after a tap; never a continuous watch (security review §2.4). */
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

/** Metres north and east of the office (flat-earth is exact enough at this scale; the server decides). */
function offset(site: Site, coords: GeolocationCoordinates) {
  const metresPerDegree = 111_195;
  const north = (coords.latitude - site.latitude) * metresPerDegree;
  const east = (coords.longitude - site.longitude) * metresPerDegree * Math.cos((site.latitude * Math.PI) / 180);
  return { north, east, distance: Math.hypot(north, east) };
}

/** A drawn map: the office area, its centre and you. No map tiles, so the location never leaves the app. */
function OfficeMap({ site, fix }: { site: Site; fix: Fix | null }) {
  const spot = fix ? offset(site, fix.coords) : null;
  const extent = Math.max(site.radius_m * 1.6, (spot?.distance ?? 0) * 1.3, 80);
  const k = 90 / extent;
  const clamp = (value: number) => Math.max(-92, Math.min(92, value));
  const ring = site.radius_m * k;
  return (
    <svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid slice" aria-hidden className="size-full">
      {[-80, -40, 0, 40, 80].map((line) => (
        <g key={line} className="stroke-black/[0.06]" strokeWidth={0.6}>
          <line x1={line} y1={-100} x2={line} y2={100} />
          <line x1={-100} y1={line} x2={100} y2={line} />
        </g>
      ))}
      <circle r={ring} className="fill-teal/10 stroke-teal" strokeWidth={2.5} />
      <rect x={-3} y={-3} width={6} height={6} className="fill-foreground" />
      <text y={-ring - 6} textAnchor="middle" className="fill-muted-foreground text-[7px] font-semibold uppercase tracking-[0.12em]">
        {site.name}
      </text>
      {spot && fix ? (
        <g transform={`translate(${clamp(spot.east * k)} ${clamp(-spot.north * k)})`}>
          <circle r={Math.min(Math.max(fix.coords.accuracy * k, 6), 60)} className="fill-primary/15" />
          <circle r={5} className="fill-primary stroke-card" strokeWidth={2} />
        </g>
      ) : null}
    </svg>
  );
}

/**
 * The clock screen (5 Oct, from Dilip's reference): a drawn map of the office with you on it,
 * your live selfie, Start · Break · Finish, and one big button. Finish asks for the day's work
 * log first. The server re-checks everything.
 */
export function ClockSheet({
  state,
  initial,
  actions,
  site,
  logDate,
  onClose,
  onDone,
}: {
  state: ClockState;
  initial: ClockAction;
  actions: ClockStatus["actions"];
  site: Site | null;
  logDate: string;
  onClose: () => void;
  onDone: (action: ClockAction, occurredAt: string) => void;
}) {
  const router = useRouter();
  const { videoRef, status: cameraStatus, error: cameraError } = useFrontCamera();
  const [segment, setSegment] = useState<Segment>(segmentOf(initial));
  const [step, setStep] = useState<Step>({ name: "ready" });
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(true);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [log, setLog] = useState("");
  const action = segmentAction(segment, state);
  const shotUrl = step.name === "review" ? step.shot.url : null;

  function located(read: Promise<GeolocationCoordinates>) {
    return read.then(
      (coords) => {
        setFix({ coords, at: Date.now() });
        setLocating(false);
      },
      (error: unknown) => {
        setLocationError(errorText(error, "We couldn't find your location. Try again."));
        setLocating(false);
      },
    );
  }

  function locate() {
    setLocating(true);
    setLocationError(null);
    void located(readLocation());
  }

  // One location read when the sheet opens (it opens on the intern's tap).
  useEffect(() => {
    void located(readLocation());
  }, []);

  useEffect(() => () => {
    if (shotUrl) URL.revokeObjectURL(shotUrl);
  }, [shotUrl]);

  function fail(error: unknown, fallback: string) {
    setStep({ name: "ready" });
    if (typeof error === "object" && error !== null && "hint" in error && error.hint === "consent") {
      router.push("/consent");
      return;
    }
    setProblem(errorText(error, fallback));
  }

  async function begin(chosen: ClockAction) {
    setProblem(null);
    setStep({ name: "starting" });
    const { data, error } = await createClient().rpc("start_clock", { event_type: chosen });
    if (error) return fail(error, "That didn't start. Try again.");
    setStep({ name: "photo", challenge: data as ClockChallenge });
  }

  function go() {
    if (!action) return;
    // Finish needs the day's work log first (Dilip, 5 Oct).
    if (action === "shift_out" && actions.shift_out?.toLowerCase().includes("work log")) {
      setProblem(null);
      setStep({ name: "log" });
      return;
    }
    void begin(action);
  }

  async function saveLog() {
    const summary = log.trim();
    if (summary.length < LOG_MIN || summary.length > LOG_MAX) {
      setProblem("Write between 10 and 500 characters about what you did.");
      return;
    }
    setProblem(null);
    setStep({ name: "saving", label: "Saving your work log…" });
    const { error } = await createClient().rpc("save_work_log", { work_date: logDate, summary });
    if (error) {
      setStep({ name: "log" });
      setProblem(errorText(error, "That log didn't save. Try again."));
      return;
    }
    await begin("shift_out");
  }

  async function take(challenge: ClockChallenge) {
    try {
      const blob = await captureJpeg(videoRef.current!);
      setStep({ name: "review", challenge, shot: { blob, url: URL.createObjectURL(blob) } });
    } catch (error) {
      setProblem(errorText(error, "That photo didn't work. Take it again."));
    }
  }

  async function save(challenge: ClockChallenge, shot: Shot) {
    const supabase = createClient();
    try {
      setStep({ name: "saving", label: "Checking your location…" });
      let current = fix;
      if (!current || Date.now() - current.at > FRESH_MS) {
        current = { coords: await readLocation(), at: Date.now() };
        setFix(current);
      }
      setStep({ name: "saving", label: "Saving your selfie…" });
      const { error: uploadError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(challenge.photo_path, shot.blob, { contentType: "image/jpeg", upsert: false });
      if (uploadError) throw uploadError;
      setStep({ name: "saving", label: SAVING[challenge.event_type] });
      const { data, error } = await supabase.rpc("clock_punch", {
        challenge_id: challenge.challenge_id,
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        accuracy_m: current.coords.accuracy,
        client_reported_at: new Date().toISOString(), // forensics only; the server stamps the time
      });
      if (error) throw error;
      onDone(challenge.event_type, (data as { occurred_at: string }).occurred_at);
    } catch (error) {
      fail(error, "That didn't save. Try again.");
    }
  }

  const spot = site && fix ? offset(site, fix.coords) : null;
  const inside = spot && site ? spot.distance <= site.radius_m : null;
  const fullCamera = step.name === "photo" || step.name === "review";
  const busy = step.name === "starting" || step.name === "saving";
  const breakHint = state === "in" && actions.break_start ? actions.break_start : null;
  const title = action ? ACTION_LABEL[action] : "Clock";

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => (open || busy ? null : onClose())}>
      {/* No portal: the video element must exist as soon as the camera stream arrives. */}
      <DialogPrimitive.Content className="fixed inset-0 z-50 flex h-dvh flex-col overflow-y-auto bg-background outline-none">
        <div className="flex items-start justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="caption font-semibold uppercase tracking-[0.12em] text-muted-foreground">{formatDay(new Date())}</p>
            <DialogPrimitive.Title className="text-2xl font-bold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Your location on a map of the office, your live selfie, and what you&apos;re clocking.
            </DialogPrimitive.Description>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={busy} aria-label="Close">
            <X aria-hidden className="size-5" />
          </Button>
        </div>

        <div className="relative mx-4 mt-3 min-h-48 flex-1 overflow-hidden rounded-xl border border-border bg-card">
          {site ? <OfficeMap site={site} fix={fix} /> : null}
          <div
            className={cn(
              "absolute overflow-hidden bg-foreground transition-all",
              fullCamera ? "inset-0" : "right-3 bottom-3 aspect-[3/4] w-28 rounded-lg border-2 border-card shadow-card sm:w-36",
            )}
          >
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label="Your live selfie"
              className={cn("size-full -scale-x-100 object-cover", shotUrl && "hidden")}
            />
            {shotUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shotUrl} alt="Your selfie" className="size-full -scale-x-100 object-cover" />
            ) : null}
            {step.name === "photo" ? (
              <>
                <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="aspect-[3/4] w-3/5 max-w-xs rounded-[50%] border-4 border-background/90 shadow-[0_0_0_100vmax_color-mix(in_oklab,var(--foreground)_45%,transparent)]" />
                </div>
                <p className="absolute inset-x-3 top-3 rounded-lg bg-card p-3 text-center text-foreground">
                  <span className="caption block text-muted-foreground">Show this in your photo</span>
                  <span className="text-xl font-bold">{step.challenge.gesture}</span>
                </p>
              </>
            ) : null}
            {cameraStatus === "opening" ? (
              <p role="status" className="absolute inset-x-2 top-1/2 -translate-y-1/2 text-center text-xs font-semibold text-background">
                Opening camera…
              </p>
            ) : null}
          </div>
        </div>

        <p role="status" className="px-4 py-3 text-[15px]">
          {locating ? (
            "Finding your location…"
          ) : locationError ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-bad">{locationError}</span>
              <Button type="button" variant="secondary" size="sm" onClick={locate}>
                Try again
              </Button>
            </span>
          ) : spot && site ? (
            <>
              <span className="font-semibold">
                You&apos;re {formatDistance(spot.distance)} from {site.name}
              </span>
              <span className={cn("ml-2", inside ? "text-ok" : "text-bad")}>
                {inside ? "· inside the office area" : `· move within ${formatDistance(site.radius_m)}`}
              </span>
            </>
          ) : null}
        </p>

        <div className="flex flex-col gap-3 rounded-t-2xl bg-foreground px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-background">
          <div role="radiogroup" aria-label="What are you clocking?" className="grid grid-cols-3 gap-1 rounded-full bg-background/10 p-1">
            {SEGMENTS.map((item) => {
              const itemAction = segmentAction(item.key, state);
              const disabled = !itemAction || (itemAction === "break_start" && Boolean(breakHint)) || busy || fullCamera || step.name === "log";
              return (
                <button
                  key={item.key}
                  type="button"
                  role="radio"
                  aria-checked={segment === item.key}
                  disabled={disabled}
                  onClick={() => {
                    setSegment(item.key);
                    setProblem(null);
                  }}
                  className={cn(
                    "min-h-11 rounded-full text-[15px] font-semibold uppercase tracking-[0.08em] transition-colors",
                    segment === item.key ? "bg-primary text-primary-foreground" : "text-background/80",
                    disabled && segment !== item.key && "opacity-40",
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          {breakHint ? <p className="text-sm text-background/70">{breakHint}</p> : null}

          {step.name === "log" || (step.name === "saving" && step.label === "Saving your work log…") ? (
            <div className="rounded-xl bg-card p-3 text-foreground">
              <FormField
                id="finish-log"
                label={`Work log for ${formatDay(logDate)}`}
                hint={`What did you work on? What did you learn? ${log.trim().length} / ${LOG_MAX}`}
              >
                {(input) => (
                  <textarea
                    {...input}
                    value={log}
                    onChange={(event) => setLog(event.target.value)}
                    rows={3}
                    maxLength={LOG_MAX}
                    className="min-h-20 rounded-md border border-input bg-card px-3 py-2"
                  />
                )}
              </FormField>
            </div>
          ) : null}

          {problem || cameraError ? (
            <div className="rounded-lg bg-card p-3">
              <FormMessage>{problem ?? cameraError}</FormMessage>
            </div>
          ) : null}

          {step.name === "review" ? (
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <Button type="button" variant="secondary" size="lg" onClick={() => setStep({ name: "photo", challenge: step.challenge })}>
                <RotateCcw aria-hidden />
                Retake
              </Button>
              <Button type="button" size="lg" onClick={() => void save(step.challenge, step.shot)}>
                Use photo
              </Button>
            </div>
          ) : step.name === "photo" ? (
            <Button type="button" size="lg" className="w-full" disabled={cameraStatus !== "live"} onClick={() => void take(step.challenge)}>
              <Camera aria-hidden />
              Take photo
            </Button>
          ) : step.name === "log" ? (
            <Button type="button" size="lg" variant="destructive" className="w-full" onClick={() => void saveLog()}>
              Save log and clock out
            </Button>
          ) : busy ? (
            <Button type="button" size="lg" className="w-full" disabled>
              {step.name === "saving" ? step.label : "Getting ready…"}
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              variant={action === "shift_out" ? "destructive" : "default"}
              className="w-full"
              disabled={!action || !fix || cameraStatus !== "live"}
              onClick={go}
            >
              {title}
            </Button>
          )}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  );
}

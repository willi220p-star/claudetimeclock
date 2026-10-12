"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Delete } from "lucide-react";
import { captureJpeg, useFrontCamera } from "@/app/clock/selfie-camera";
import { DgkLogo } from "@/components/dgk-logo";
import { Opening, useHydrated } from "@/components/desk-gate";
import { FormMessage } from "@/components/form-field";
import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";
import { sessionProfile } from "@/lib/browser-session";
import { errorText, PHOTO_BUCKET } from "@/lib/daymark";
import { formatTime } from "@/lib/darwin";
import { homeFor } from "@/lib/roles";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

type Person = { person_id: string; first_name: string; initials: string };
type Event = "shift_in" | "break_start" | "break_end" | "shift_out";
type Challenge = {
  challenge_id: string;
  gesture: string;
  photo_path: string;
  first_name: string;
  event_type: Event;
};

const EVENTS: [Event, string][] = [
  ["shift_in", "Clock in"],
  ["break_start", "Start break"],
  ["break_end", "End break"],
  ["shift_out", "Finish"],
];
const DONE_TEXT: Record<Event, string> = {
  shift_in: "clocked in",
  break_start: "started a break",
  break_end: "ended the break",
  shift_out: "finished for the day",
};
const BACK_AFTER_MS = 8000;

/** An office tablet (D42): name, PIN, action, live selfie with the gesture. It shows no records. */
export function KioskScreen() {
  if (!useHydrated()) return <Opening label="Opening the kiosk…" />;
  return <KioskGate />;
}

function KioskGate() {
  const router = useRouter();
  const profile = use(sessionProfile());
  const elsewhere = !profile
    ? "/"
    : profile.is_kiosk
      ? null
      : (homeFor(profile) ?? "/");
  useEffect(() => {
    if (elsewhere) router.replace(elsewhere);
  }, [elsewhere, router]);
  if (elsewhere) return <Opening label="Opening the right page…" />;
  return <Kiosk />;
}

async function loadPeople(): Promise<Person[]> {
  const { data, error } = await createClient().rpc("kiosk_people");
  if (error) throw error;
  return data ?? [];
}

function Kiosk() {
  const [people, reload] = useLoad(loadPeople);
  const [person, setPerson] = useState<Person | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [done, setDone] = useState<{
    name: string;
    event: Event;
    at: string;
  } | null>(null);

  function reset() {
    setPerson(null);
    setChallenge(null);
    setDone(null);
    reload();
  }

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(reset, BACK_AFTER_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only reads setters and reload
  }, [done]);

  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <DgkLogo size={36} />
          <p className="text-lg font-semibold">DGK Clock · Kiosk</p>
        </div>
        <SignOutButton compact />
      </header>
      {done ? (
        <section
          className="flex flex-col items-center gap-4 rounded-xl bg-card p-8 text-center shadow-card"
          role="status"
        >
          <p className="text-3xl font-bold">Done, {done.name}</p>
          <p className="text-lg">
            You {DONE_TEXT[done.event]} at {formatTime(done.at)}.
          </p>
          <Button type="button" size="lg" onClick={reset}>
            Next person
          </Button>
        </section>
      ) : challenge ? (
        <SelfieStep
          challenge={challenge}
          onCancel={reset}
          onDone={(at) =>
            setDone({
              name: challenge.first_name,
              event: challenge.event_type,
              at,
            })
          }
        />
      ) : person ? (
        <PinStep person={person} onCancel={reset} onChallenge={setChallenge} />
      ) : people.status === "error" ? (
        <div className="flex flex-col items-start gap-3">
          <FormMessage>{people.message}</FormMessage>
          <Button type="button" variant="secondary" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : (
        <section aria-labelledby="who" className="flex flex-col gap-4">
          <h1 id="who">Who&apos;s clocking?</h1>
          {people.status === "ready" && people.data.length === 0 ? (
            <p className="text-muted-foreground">
              Nobody here yet. Interns set a kiosk PIN on their phone (Me →
              Kiosk PIN) to appear here.
            </p>
          ) : null}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(people.status === "ready" ? people.data : []).map((p) => (
              <li key={p.person_id}>
                <button
                  type="button"
                  className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-xl bg-card p-4 text-lg font-semibold shadow-card"
                  onClick={() => setPerson(p)}
                >
                  <span
                    aria-hidden
                    className="grid size-12 place-items-center rounded-full bg-muted text-base"
                  >
                    {p.initials}
                  </span>
                  {p.first_name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function PinStep({
  person,
  onCancel,
  onChallenge,
}: {
  person: Person;
  onCancel: () => void;
  onChallenge: (c: Challenge) => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askKind, setAskKind] = useState(false);

  async function start(event: Event, dayKind?: "full_day" | "work_based") {
    setBusy(true);
    setError(null);
    const { data, error } = await createClient().rpc("kiosk_start", {
      person: person.person_id,
      pin,
      event_type: event,
      day_kind: dayKind,
    });
    setBusy(false);
    const result = (data ?? {}) as Partial<Challenge> & { error?: string };
    if (error?.hint === "day_kind") {
      setAskKind(true); // first clock-in today: Full day or Work-based, as on the phone
      return;
    }
    if (error || result.error) {
      setPin("");
      // A Finish without the day's work log: the intern writes it on their phone (the kiosk takes no notes).
      setError(
        result.error ?? errorText(error, "That didn't work. Try again."),
      );
      return;
    }
    onChallenge(result as Challenge);
  }

  return (
    <section aria-labelledby="pin" className="flex flex-col gap-4">
      <h1 id="pin">Hi {person.first_name}</h1>
      <p className="text-muted-foreground">
        Enter your kiosk PIN, then choose what you&apos;re doing.
      </p>
      <p
        aria-live="polite"
        className="text-center font-mono text-4xl tracking-[0.5em]"
      >
        {pin.replace(/./g, "•") || " "}
      </p>
      <div className="grid grid-cols-3 gap-3" role="group" aria-label="PIN pad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <PadKey
            key={d}
            label={d}
            onPress={() => setPin((v) => (v.length < 6 ? v + d : v))}
          />
        ))}
        <span />
        <PadKey
          label="0"
          onPress={() => setPin((v) => (v.length < 6 ? v + "0" : v))}
        />
        <button
          type="button"
          aria-label="Delete a digit"
          className="grid min-h-16 place-items-center rounded-xl bg-muted"
          onClick={() => setPin((v) => v.slice(0, -1))}
        >
          <Delete aria-hidden />
        </button>
      </div>
      {error ? <FormMessage>{error}</FormMessage> : null}
      {askKind ? (
        <div className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card">
          <p className="font-semibold">Today is a…</p>
          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              size="lg"
              disabled={busy}
              onClick={() => void start("shift_in", "full_day")}
            >
              Full day
            </Button>
            <Button
              type="button"
              size="lg"
              variant="secondary"
              disabled={busy}
              onClick={() => void start("shift_in", "work_based")}
            >
              Work-based
            </Button>
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        {EVENTS.map(([event, label]) => (
          <Button
            key={event}
            type="button"
            size="lg"
            disabled={busy || pin.length < 4}
            onClick={() => void start(event)}
          >
            {label}
          </Button>
        ))}
      </div>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Not you? Back
      </Button>
    </section>
  );
}

function PadKey({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      className="min-h-16 rounded-xl bg-card text-2xl font-semibold shadow-card"
      onClick={onPress}
    >
      {label}
    </button>
  );
}

function SelfieStep({
  challenge,
  onCancel,
  onDone,
}: {
  challenge: Challenge;
  onCancel: () => void;
  onDone: (at: string) => void;
}) {
  const { videoRef, status, error: cameraError } = useFrontCamera();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function shoot() {
    setBusy(true);
    setError(null);
    try {
      const blob = await captureJpeg(videoRef.current!);
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(challenge.photo_path, blob, {
          contentType: "image/jpeg",
          upsert: false,
        });
      if (uploadError) throw uploadError;
      const { data, error } = await supabase.rpc("kiosk_punch", {
        challenge_id: challenge.challenge_id,
      });
      if (error) throw error;
      onDone((data as { occurred_at: string }).occurred_at);
    } catch (failure) {
      setError(errorText(failure, "That didn't save. Start again."));
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="selfie" className="flex flex-col gap-4">
      <h1 id="selfie">{challenge.gesture}</h1>
      <p className="text-muted-foreground">
        {challenge.first_name}, do this and take the photo.
      </p>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="aspect-[4/3] w-full rounded-xl bg-black object-cover"
      />
      {cameraError ? <FormMessage>{cameraError}</FormMessage> : null}
      {error ? <FormMessage>{error}</FormMessage> : null}
      <Button
        type="button"
        size="lg"
        disabled={busy || status !== "live"}
        onClick={() => void shoot()}
      >
        <Camera aria-hidden />
        {busy ? "Saving…" : "Take photo"}
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </section>
  );
}

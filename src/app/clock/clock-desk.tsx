"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, Coffee, MapPin } from "lucide-react";
import { toast } from "sonner";
import { PunchDayTable } from "@/components/punch-day-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EVENT_LABEL,
  WORK_SITE,
  describePlace,
  offSiteMessage,
  distanceMetres,
  errorText,
  formatClockTime,
  formatDistance,
  formatLongDate,
  type EventType,
  type Profile,
  type Punch,
} from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";
import type { PunchCard } from "@/lib/punches";
import { formatDuration, summarize } from "@/lib/time";

type Located = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

const STATUS_COPY = {
  off: "Off the clock",
  on_shift: "On shift",
  on_break: "On a break",
} as const;

export function ClockDesk({
  profile,
  initialPunches,
}: {
  profile: Profile;
  initialPunches: PunchCard[];
}) {
  const [now, setNow] = useState(() => new Date());
  const [punches, setPunches] = useState<PunchCard[]>(initialPunches);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [location, setLocation] = useState<Located | null>(null);
  const [locationError, setLocationError] = useState<string | null>(() => {
    if (typeof navigator === "undefined" || navigator.geolocation) return null;
    return "This browser cannot share a location.";
  });
  const [place, setPlace] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState<EventType | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const locationRef = useRef<Located | null>(null);
  const placeKey = useRef("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;

    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const next = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        locationRef.current = next;
        setLocation(next);
        setLocationError(null);
      },
      (error) => setLocationError(locationMessage(error)),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );

    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  useEffect(() => {
    if (!location) return;
    const key = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
    if (placeKey.current === key) return;
    placeKey.current = key;
    const controller = new AbortController();
    describePlace(location.latitude, location.longitude)
      .then((next) => {
        if (!controller.signal.aborted && next) setPlace(next);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [location]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function loadPunches() {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("daymark_punches")
      .select("id, user_id, event_type, occurred_at, latitude, longitude, accuracy_m, photo_path, place_name")
      .eq("user_id", profile.id)
      .order("occurred_at", { ascending: false })
      .limit(80);

    if (error) {
      setLoadError(error.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as Punch[];
    const urls = await signedPhotoUrls(
      supabase,
      rows.map((row) => row.photo_path),
    );
    setPunches(rows.map((row) => ({ ...row, photoUrl: urls.get(row.photo_path) ?? null })));
    setLoading(false);
  }

  async function ensureCamera() {
    if (streamRef.current && videoRef.current && videoRef.current.videoWidth > 0) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser cannot open a camera.");
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "OverconstrainedError") {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      } else if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")) {
        throw new Error("Camera access is blocked. Allow the camera, then punch again. Every punch needs a photo.");
      } else {
        throw new Error("The camera did not open. Check that another app is not using it.");
      }
    }

    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) throw new Error("The camera preview is not on screen yet.");
    video.srcObject = stream;
    await video.play();
    if (video.videoWidth === 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("The camera did not produce a frame.")), 8000);
        video.onloadeddata = () => {
          window.clearTimeout(timer);
          resolve();
        };
      });
    }
    setCameraOn(true);
    setCameraError(null);
  }

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      throw new Error("Hold on — the camera has not drawn a frame yet.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not take the photo.");
    context.drawImage(video, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("Could not take the photo."))),
        "image/jpeg",
        0.85,
      );
    });
    return blob;
  }

  async function currentLocation() {
    if (locationRef.current) return locationRef.current;
    if (!navigator.geolocation) throw new Error("This browser cannot share a location.");
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 5000,
      });
    }).catch((error: GeolocationPositionError) => {
      throw new Error(locationMessage(error));
    });
    const next = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
    locationRef.current = next;
    setLocation(next);
    return next;
  }

  async function punch(eventType: EventType) {
    if (busy) return;
    setBusy(eventType);
    setCameraError(null);
    const supabase = createClient();
    let photoPath: string | null = null;

    try {
      const where = await currentLocation();
      const blocked = offSiteMessage(where.latitude, where.longitude);
      if (blocked) throw new Error(blocked);
      await ensureCamera();
      const photo = await capturePhoto();
      const placeName = await describePlace(where.latitude, where.longitude);
      photoPath = `${profile.id}/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("daymark-photos")
        .upload(photoPath, photo, { contentType: "image/jpeg", upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      const { error: insertError } = await supabase.from("daymark_punches").insert({
        user_id: profile.id,
        event_type: eventType,
        latitude: where.latitude,
        longitude: where.longitude,
        accuracy_m: where.accuracy,
        photo_path: photoPath,
        place_name: placeName,
      });
      if (insertError) throw new Error(insertError.message);

      toast.success(EVENT_LABEL[eventType] + " saved.");
      await loadPunches();
    } catch (error) {
      if (photoPath) {
        await supabase.storage.from("daymark-photos").remove([photoPath]);
      }
      const message = errorText(error, "The punch did not save.");
      setCameraError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }

  const summary = summarize(punches, now.getTime());
  const paused = !profile.active;
  const metres = location ? distanceMetres(location.latitude, location.longitude) : null;
  const onSite = metres != null && metres <= WORK_SITE.radiusM;
  const awayMessage = location && !onSite ? offSiteMessage(location.latitude, location.longitude) : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pt-6 pb-40 md:px-8 md:pb-10">
      <section className="overflow-hidden rounded-[1.75rem] bg-primary px-6 py-7 text-primary-foreground shadow-sm md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-primary-foreground/70">{formatLongDate(now)}</p>
            <h1 className="mt-1 font-heading text-5xl tracking-tight tabular-nums md:text-6xl">{formatClockTime(now)}</h1>
          </div>
          <Badge variant="secondary" className="h-8 bg-primary-foreground/15 px-3 text-primary-foreground">
            {STATUS_COPY[summary.status]}
          </Badge>
        </div>
        <p className="mt-6 max-w-xl text-sm leading-relaxed text-primary-foreground/80">
          {locationError
            ? locationError
            : metres == null
              ? "Finding your address."
              : onSite
                ? `You are in the location, about ${formatDistance(metres)} from the Regus office on the first floor. Clock in, clock out, break in, and break out are open.`
                : awayMessage}
        </p>
        <p className="mt-4 max-w-xl text-base font-medium leading-snug">
          {place ?? "Waiting for the full address from this device."}
        </p>
      </section>

      {paused ? (
        <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="status">
          This login is paused. You can look at past punches, and an admin has to turn the login back on before you can clock again.
        </p>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="bg-card/90">
          <CardHeader>
            <CardTitle className="text-muted-foreground">Worked today, breaks out</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <p className="font-heading text-6xl tracking-tight tabular-nums md:text-7xl">
              {formatDuration(summary.todayWorked)}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Stat label={summary.status === "off" ? "Latest shift" : "This shift"} value={formatDuration(summary.shiftWorked)} />
              <Stat label="Break today" value={formatDuration(summary.todayBreak)} />
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Break time is taken out of the worked total. Clock out of the break before you clock out of the shift.
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card className="bg-card/90">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="size-4" />
                Where you are
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-sm font-medium leading-snug">{place ?? "Reading the full address…"}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Clock in, clock out, break in, and break out only work within 200 metres of the Regus office on the first floor, above Service Australia at {WORK_SITE.address}.
              </p>
              {!onSite && metres != null ? (
                <p className="rounded-2xl bg-destructive/10 px-3 py-2 text-sm text-destructive" role="status">
                  You are out of the range. Be in the location.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="bg-card/90">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="size-4" />
                Photo on the punch
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="relative overflow-hidden rounded-xl bg-muted">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="aspect-video w-full bg-muted object-cover"
                />
                {cameraOn ? null : (
                  <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted-foreground">
                    The camera stays off until you punch. The first clock asks for access and takes the photo.
                  </div>
                )}
                {busy ? (
                  <div className="absolute inset-0 grid place-items-center bg-foreground/55 text-sm font-medium text-background">
                    Hold still — taking the photo
                  </div>
                ) : null}
              </div>
              {cameraError ? <p className="text-sm text-destructive">{cameraError}</p> : null}
              {cameraOn ? null : (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 bg-card"
                  onClick={() => {
                    ensureCamera().catch((error) => setCameraError(errorText(error, "The camera did not open.")));
                  }}
                >
                  Turn the camera on first
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-2 md:max-w-none md:grid-cols-4">
          <PunchButton
            label="Clock in"
            hint="Start the shift"
            disabled={paused || busy !== null || summary.status !== "off"}
            pending={busy === "shift_in"}
            onClick={() => punch("shift_in")}
          />
          <PunchButton
            label="Clock out"
            hint="End the shift"
            disabled={paused || busy !== null || summary.status !== "on_shift"}
            pending={busy === "shift_out"}
            onClick={() => punch("shift_out")}
          />
          <PunchButton
            label="Break in"
            hint="Step off the clock"
            disabled={paused || busy !== null || summary.status !== "on_shift"}
            pending={busy === "break_in"}
            onClick={() => punch("break_in")}
            icon={<Coffee />}
          />
          <PunchButton
            label="Break out"
            hint="Back to the shift"
            disabled={paused || busy !== null || summary.status !== "on_break"}
            pending={busy === "break_out"}
            onClick={() => punch("break_out")}
            icon={<Coffee />}
          />
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-heading text-2xl tracking-tight">Punches</h2>
          <Button type="button" variant="ghost" className="h-9" onClick={() => void loadPunches()}>
            Refresh
          </Button>
        </div>
        {loading ? <p className="text-sm text-muted-foreground">Loading punches…</p> : null}
        {loadError ? (
          <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            {loadError}
          </p>
        ) : null}
        {loading ? null : <PunchDayTable punches={punches} />}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-secondary px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-2xl tabular-nums">{value}</p>
    </div>
  );
}

function PunchButton({
  label,
  hint,
  disabled,
  pending,
  onClick,
  icon,
}: {
  label: string;
  hint: string;
  disabled: boolean;
  pending: boolean;
  onClick: () => void;
  icon?: ReactNode;
}) {
  return (
    <Button
      type="button"
      className="h-14 flex-col gap-0 rounded-2xl"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {pending ? "Saving…" : label}
      </span>
      <span className="text-[11px] font-normal opacity-80">{hint}</span>
    </Button>
  );
}

function locationMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location is blocked. Allow location for this site, then punch again.";
  }
  if (error.code === error.TIMEOUT) {
    return "Location timed out. Step outside or check the signal, then try again.";
  }
  return "Location is unavailable on this device right now.";
}

async function signedPhotoUrls(
  supabase: ReturnType<typeof createClient>,
  paths: string[],
) {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;
  const { data } = await supabase.storage.from("daymark-photos").createSignedUrls(paths, 60 * 60);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return urls;
}

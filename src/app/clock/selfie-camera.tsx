"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/daymark";
import { cn } from "@/lib/utils";

const MAX_BYTES = 1_000_000;
const MAX_SIDE = 1280;

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function cameraMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access is blocked. Allow the camera for this site in your browser settings, then tap Clock in again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "We couldn't find a front camera. Clock in from your phone instead.";
  }
  if (name === "NotReadableError") return "Another app is using the camera. Close it, then tap Clock in again.";
  return errorText(error, "The camera didn't open. Tap Clock in again.");
}

/** A live frame from the camera as a JPEG of at most about 1 MB. */
async function captureJpeg(video: HTMLVideoElement) {
  if (!video.videoWidth) throw new Error("The camera isn't ready yet. Wait a moment, then take the photo.");
  const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error("That photo didn't work. Find some light and take it again.");
}

/**
 * Full-screen live selfie from the front camera: no file input and no gallery (review rule 7).
 * The intern shows the server's gesture inside the oval, then keeps or retakes the photo.
 */
export function SelfieCamera({
  gesture,
  onUse,
  onCancel,
}: {
  gesture: string;
  onUse: (photo: Blob) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"opening" | "live" | "error">("opening");
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [taking, setTaking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const open = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
        })
      : Promise.reject(new Error("This browser can't open the camera. Try Chrome or Safari on your phone."));
    open.then(
      async (stream) => {
        if (cancelled) return stopStream(stream);
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          // autoPlay starts it anyway; a refused play() still leaves the preview usable.
        }
        if (!cancelled) setStatus("live");
      },
      (reason: unknown) => {
        if (cancelled) return;
        setError(cameraMessage(reason));
        setStatus("error");
      },
    );
    return () => {
      cancelled = true;
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.url);
    };
  }, [shot]);

  async function take() {
    setTaking(true);
    setError(null);
    try {
      const blob = await captureJpeg(videoRef.current!);
      setShot({ blob, url: URL.createObjectURL(blob) });
    } catch (reason) {
      setError(errorText(reason, "That photo didn't work. Take it again."));
    } finally {
      setTaking(false);
    }
  }

  function keep() {
    if (!shot) return;
    stopStream(streamRef.current);
    streamRef.current = null;
    onUse(shot.blob);
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => (open ? null : onCancel())}>
      {/* No portal: the video element must exist as soon as the camera stream arrives. */}
      <DialogPrimitive.Content className="fixed inset-0 z-50 flex flex-col bg-foreground text-background outline-none">
        <div className="flex items-start justify-between gap-4 px-4 pt-4">
          <div className="flex flex-col gap-1">
            <p className="caption text-background/80">Your selfie</p>
            <DialogPrimitive.Title className="text-2xl font-bold">{gesture}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm text-background/80">
              Show this in the photo with your face inside the oval. You have about 90 seconds.
            </DialogPrimitive.Description>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-background hover:bg-background/10"
            onClick={onCancel}
            aria-label="Cancel"
          >
            <X aria-hidden className="size-5" />
          </Button>
        </div>

        <div className="relative my-4 min-h-0 flex-1 overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className={cn("size-full -scale-x-100 object-cover", shot && "hidden")}
          />
          {shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot.url} alt="Your selfie" className="size-full -scale-x-100 object-cover" />
          ) : (
            <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="aspect-[3/4] w-3/5 max-w-xs rounded-[50%] border-4 border-background/90 shadow-[0_0_0_100vmax_color-mix(in_oklab,var(--foreground)_45%,transparent)]" />
            </div>
          )}
          {status === "opening" ? (
            <p role="status" className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center font-semibold">
              Opening the front camera…
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="absolute inset-x-4 top-4 rounded-lg bg-card p-4 text-foreground">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-center gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {shot ? (
            <>
              <Button type="button" variant="secondary" size="lg" onClick={() => setShot(null)}>
                <RotateCcw aria-hidden />
                Retake
              </Button>
              <Button type="button" size="lg" onClick={keep}>
                Use photo
              </Button>
            </>
          ) : status === "error" ? (
            <Button type="button" variant="secondary" size="lg" onClick={onCancel}>
              Close
            </Button>
          ) : (
            <Button type="button" size="lg" onClick={take} disabled={status !== "live" || taking}>
              <Camera aria-hidden />
              Take photo
            </Button>
          )}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  );
}

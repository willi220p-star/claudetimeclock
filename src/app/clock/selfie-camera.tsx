"use client";

import { useEffect, useRef, useState } from "react";
import { errorText } from "@/lib/daymark";

const MAX_BYTES = 1_000_000;
const MAX_SIDE = 1280;

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function cameraMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access is blocked. Allow the camera for this site in your browser settings, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "We couldn't find a front camera. Clock in from your phone instead.";
  }
  if (name === "NotReadableError") return "Another app is using the camera. Close it, then try again.";
  return errorText(error, "The camera didn't open. Close this and try again.");
}

/** A live frame from the camera as a JPEG of at most about 1 MB. */
export async function captureJpeg(video: HTMLVideoElement) {
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
 * The front camera, live while the calling component is mounted: no file input and no gallery
 * (review rule 7). Render `<video ref={videoRef} autoPlay muted playsInline />` from the first render.
 */
export function useFrontCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"opening" | "live" | "error">("opening");
  const [error, setError] = useState<string | null>(null);

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

  return { videoRef, status, error };
}

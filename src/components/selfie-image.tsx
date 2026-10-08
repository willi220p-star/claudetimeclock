"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { signSelfies } from "@/lib/punches";
import { cn } from "@/lib/utils";

/**
 * A private selfie from a 60-second signed link (§14). Links expire, so an image that mounts late
 * (a tab, a sheet, a re-render) fails; on the first error it signs a fresh link and tries once more.
 * `url` null or a file that is gone shows "Photo removed". `compact` keeps the label for screen readers only.
 */
export function SelfieImage({
  path,
  url,
  alt = "",
  className,
  compact = false,
}: {
  path: string;
  url: string | null;
  alt?: string;
  className?: string;
  compact?: boolean;
}) {
  const [fresh, setFresh] = useState<string | null>(null);
  const [retried, setRetried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const src = fresh ?? url;

  function retry() {
    if (retried) {
      setProblem("Photo removed");
      return;
    }
    setRetried(true);
    signSelfies([path]).then(
      (urls) => {
        const next = urls.get(path);
        if (next) setFresh(next);
        else setProblem("Photo removed");
      },
      () => setProblem("Photo didn't load"),
    );
  }

  if (problem || !src) {
    const label = problem ?? "Photo removed";
    return (
      <span
        role="img"
        aria-label={label}
        className={cn("flex flex-col items-center justify-center gap-1 bg-muted p-1 text-center text-xs text-muted-foreground", className)}
      >
        <ImageOff aria-hidden className="size-4 shrink-0" />
        {compact ? null : <span>{label}</span>}
      </span>
    );
  }
  // Signed URLs expire in 60 seconds, so next/image caching doesn't apply.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} onError={retry} />;
}

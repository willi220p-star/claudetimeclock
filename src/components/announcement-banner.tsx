"use client";

import { useCallback, useState } from "react";
import { Megaphone, X } from "lucide-react";
import { loadCurrentBanners, type Banner } from "@/lib/data";
import { useLoad } from "@/lib/use-load";

const KEY = "dgk-banner-dismissed";

// ponytail: dismissals live in this browser only (localStorage), per banner version; a changed
// banner shows again. Upgrade: a per-person dismissals table if it must follow them across devices.
function dismissedSet(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

const versionOf = (banner: Banner) => `${banner.id}:${banner.updated_at}`;

/** A seamless left-scrolling ticker; the second copy is hidden from screen readers. */
export function MovingText({ text }: { text: string }) {
  return (
    <span className="dgk-marquee">
      <span>{text}</span>
      <span aria-hidden>{text}</span>
    </span>
  );
}

/** Admin and supervisor announcements, under the header on every signed-in screen. */
export function AnnouncementBanner() {
  const load = useCallback(() => loadCurrentBanners().catch(() => [] as Banner[]), []);
  const [state] = useLoad(load);
  const [dismissed, setDismissed] = useState<Set<string>>(() => (typeof window === "undefined" ? new Set() : dismissedSet()));

  if (state.status !== "ready") return null;
  const shown = state.data.filter((banner) => !dismissed.has(versionOf(banner)));
  if (shown.length === 0) return null;

  function dismiss(banner: Banner) {
    const next = new Set(dismissed).add(versionOf(banner));
    setDismissed(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify([...next].slice(-50)));
    } catch {
      // Private mode: it stays hidden until the page reloads.
    }
  }

  return (
    <div className="flex flex-col print:hidden">
      {shown.map((banner) => (
        <section
          key={banner.id}
          role="status"
          aria-label="Announcement"
          className="flex items-center gap-2 bg-primary px-4 text-primary-foreground"
        >
          <Megaphone aria-hidden className="size-4 shrink-0" />
          <div className="min-w-0 flex-1 overflow-hidden py-2 text-[15px] font-medium">
            {banner.style === "scrolling" ? <MovingText text={banner.message} /> : <p>{banner.message}</p>}
          </div>
          <button
            type="button"
            onClick={() => dismiss(banner)}
            aria-label="Hide this announcement"
            className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-white/10"
          >
            <X aria-hidden className="size-4" />
          </button>
        </section>
      ))}
    </div>
  );
}

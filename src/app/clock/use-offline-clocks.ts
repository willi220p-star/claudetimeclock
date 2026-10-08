"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { listQueue, onQueueChange, type QueuedItem } from "@/lib/offline-queue";
import { syncQueue } from "@/lib/offline-sync";
import type { ClockStatus } from "@/lib/placement-ui";

const RETRY_MS = 60_000;

/**
 * This phone's waiting offline clocks (D35): listed for Home, sent when the signal is back
 * (on open, on the browser's `online` event, and every minute while any wait).
 */
export function useOfflineClocks(userId: string, onSent: () => void) {
  const [queued, setQueued] = useState<QueuedItem[]>([]);
  // The server wants the notice acknowledged again before it takes more clocks.
  const [needsConsent, setNeedsConsent] = useState(false);

  useEffect(() => {
    let live = true;
    const refresh = () => {
      void listQueue(userId)
        .then((items) => {
          if (live) setQueued(items);
        })
        .catch(() => undefined);
    };
    const send = () => {
      if (!navigator.onLine) return;
      void syncQueue(userId)
        .then((result) => {
          if (live) setNeedsConsent(result.consent);
          if (result.sent > 0) {
            toast.success(
              result.sent === 1
                ? "Your offline clock was sent. Your supervisor confirms it."
                : `${result.sent} offline clocks were sent. Your supervisor confirms them.`,
            );
            onSent();
          }
        })
        .catch(() => undefined);
    };
    refresh();
    send();
    const offChange = onQueueChange(refresh);
    window.addEventListener("online", send);
    const timer = window.setInterval(send, RETRY_MS);
    return () => {
      live = false;
      offChange();
      window.removeEventListener("online", send);
      window.clearInterval(timer);
    };
  }, [userId, onSent]);

  return { queued, needsConsent };
}

// The last clock status and today's day-type pick on this phone, so Home works with no signal.
const statusKey = (userId: string) => `dgk-clock-status:${userId}`;
const dayKindKey = (userId: string, date: string) => `dgk-day-kind:${userId}:${date}`;

export function readCachedStatus(userId: string): ClockStatus | null {
  try {
    return JSON.parse(localStorage.getItem(statusKey(userId)) ?? "null") as ClockStatus | null;
  } catch {
    return null;
  }
}

export function cacheStatus(userId: string, status: ClockStatus) {
  try {
    localStorage.setItem(statusKey(userId), JSON.stringify(status));
  } catch {
    // Storage blocked: Home just needs signal to show the state.
  }
}

export function readLocalDayKind(userId: string, date: string) {
  try {
    return localStorage.getItem(dayKindKey(userId, date));
  } catch {
    return null;
  }
}

export function saveLocalDayKind(userId: string, date: string, kind: string) {
  try {
    localStorage.setItem(dayKindKey(userId, date), kind);
  } catch {
    // Storage blocked: the pick only lasts while this screen is open.
  }
}

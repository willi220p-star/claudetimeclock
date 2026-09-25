"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearSessionCache, leaveSignOutNotice } from "@/lib/browser-session";
import { loadSettings } from "@/lib/data";
import { createClient } from "@/lib/supabase/client";

export const DEFAULT_IDLE_MINUTES = 30;
const ACTIVITY = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

/**
 * Calls `onIdle` once after `ms` with no pointer, key or touch activity. One timer: activity only
 * records the time, and the timer re-arms for whatever is left when it fires. A phone that slept
 * with the page open is checked on `visibilitychange`, because its timers were paused.
 * Returns a stop function.
 */
export function startIdleTimer(ms: number, onIdle: () => void, target: Document = document) {
  let last = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    clearTimeout(timer);
    for (const type of ACTIVITY) target.removeEventListener(type, activity);
    target.removeEventListener("visibilitychange", visibility);
  };
  const check = () => {
    const left = ms - (Date.now() - last);
    if (left > 0) {
      timer = setTimeout(check, left);
      return;
    }
    stop();
    onIdle();
  };
  function activity() {
    last = Date.now();
  }
  function visibility() {
    if (target.visibilityState !== "visible") return;
    if (Date.now() - last < ms) return activity(); // coming back to the page counts as activity
    clearTimeout(timer);
    check();
  }

  for (const type of ACTIVITY) target.addEventListener(type, activity, { passive: true, capture: true });
  target.addEventListener("visibilitychange", visibility);
  timer = setTimeout(check, ms);
  return stop;
}

export function idleMessage(minutes: number) {
  return `You were signed out after ${minutes} ${minutes === 1 ? "minute" : "minutes"} of inactivity.`;
}

/** Signs this device out after `daymark_settings.idle_signout_minutes` (default 30) of no activity. */
export function useIdleSignOut() {
  const router = useRouter();
  useEffect(() => {
    let stop = () => {};
    let live = true;
    void loadSettings()
      .then(
        (settings) => settings?.idle_signout_minutes,
        () => undefined,
      )
      .then((setting) => {
        if (!live) return;
        const minutes = setting && setting > 0 ? setting : DEFAULT_IDLE_MINUTES;
        stop = startIdleTimer(minutes * 60_000, async () => {
          await createClient()
            .auth.signOut({ scope: "local" })
            .catch(() => undefined);
          clearSessionCache();
          leaveSignOutNotice(idleMessage(minutes));
          router.replace("/");
        });
      });
    return () => {
      live = false;
      stop();
    };
  }, [router]);
}

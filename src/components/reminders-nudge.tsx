"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing } from "lucide-react";
import { isIos, useInstalled } from "@/components/install-card";
import { pushState } from "@/components/push-toggle";
import { Button } from "@/components/ui/button";
import { darwinDateKey } from "@/lib/darwin";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const dismissKey = "dgk-reminders-nudge";

/** What to say for a push state; null means nothing to nag about (already on, or not possible here). */
export function nudgeText(state: ReturnType<typeof pushState>) {
  if (state === "install") return "Install DGK Clock first (Share → Add to Home Screen), then turn reminders on from the app.";
  if (state === "blocked") return "Notifications are blocked for DGK Clock. Allow them in your phone's settings.";
  if (state === "off") return "Turn on reminders so you don't miss your shift.";
  return null;
}

/**
 * Home banner until this phone has reminders on (D40). It is a nudge, never a block: tapping "Later"
 * hides it until tomorrow (Darwin day, this phone only).
 */
export function RemindersNudge() {
  const installed = useInstalled();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(dismissKey) === darwinDateKey(new Date());
    } catch {
      return false;
    }
  });
  const supported =
    typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && Boolean(VAPID_PUBLIC_KEY);

  useEffect(() => {
    if (!supported) return;
    let live = true;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((existing) => live && setSubscribed(Boolean(existing)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [supported]);

  if (hidden || subscribed === null) return null;
  const text = nudgeText(
    pushState({
      supported,
      ios: isIos(),
      installed,
      permission: typeof Notification === "undefined" ? null : Notification.permission,
      subscribed,
    }),
  );
  if (!text) return null;

  return (
    <section aria-labelledby="nudge-title" className="flex flex-col gap-3 rounded-xl bg-warn-bg p-4 text-warn">
      <h2 id="nudge-title" className="flex items-center gap-2 text-base">
        <BellRing aria-hidden className="size-4" />
        Turn on reminders
      </h2>
      <p>
        Your supervisor needs you to turn this on so you don&apos;t miss your shift reminders. {text}
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/clock/me#push-title" className="inline-flex min-h-11 items-center font-semibold underline">
          Set up on Me
        </Link>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            try {
              localStorage.setItem(dismissKey, darwinDateKey(new Date()));
            } catch {
              // Storage blocked: it hides until the page reloads.
            }
            setHidden(true);
          }}
        >
          Later
        </Button>
      </div>
    </section>
  );
}

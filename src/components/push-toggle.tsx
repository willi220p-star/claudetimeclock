"use client";

import { useEffect, useState } from "react";
import { BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";
import { isIos, useInstalled } from "@/components/install-card";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export type PushState = "unsupported" | "install" | "blocked" | "off" | "on";

/** What the switch can do on this phone (pure, for tests). */
export function pushState(args: {
  supported: boolean;
  ios: boolean;
  installed: boolean;
  permission: NotificationPermission | null;
  subscribed: boolean;
}): PushState {
  if (args.ios && !args.installed) return "install"; // iPhone only allows push for home-screen apps
  if (!args.supported) return "unsupported";
  if (args.permission === "denied") return "blocked";
  return args.subscribed ? "on" : "off";
}

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

/**
 * "Reminders on this phone" (D36): clock-in, break and clock-out reminders for interns, new requests for
 * staff. Off by default; the subscription is saved per phone and removed when turned off.
 */
export function PushToggle() {
  const installed = useInstalled();
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(() =>
    typeof Notification === "undefined" ? null : Notification.permission,
  );
  const supported =
    typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && Boolean(VAPID_PUBLIC_KEY);

  useEffect(() => {
    if (!supported) return;
    let live = true;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((existing) => {
        if (!live) return;
        setSubscription(existing);
        setChecked(true);
      })
      .catch(() => setChecked(true));
    return () => {
      live = false;
    };
  }, [supported]);

  const state = pushState({
    supported,
    ios: typeof navigator !== "undefined" && isIos(),
    installed,
    permission,
    subscribed: Boolean(subscription),
  });

  async function turnOn() {
    setBusy(true);
    try {
      const asked = await Notification.requestPermission();
      setPermission(asked);
      if (asked !== "granted") return;
      const registration = await navigator.serviceWorker.ready;
      const created = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const json = created.toJSON();
      const { error } = await createClient().rpc("save_push_subscription", {
        endpoint: created.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
      });
      if (error) {
        await created.unsubscribe();
        throw error;
      }
      setSubscription(created);
      toast.success("Reminders are on for this phone.");
    } catch (error) {
      toast.error(errorText(error, "Reminders didn't turn on. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!subscription) return;
    setBusy(true);
    try {
      await createClient().rpc("delete_push_subscription", { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
      setSubscription(null);
      toast.success("Reminders are off for this phone.");
    } catch (error) {
      toast.error(errorText(error, "Reminders didn't turn off. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="push-title" className="flex flex-col gap-3 rounded-xl bg-card p-6 shadow-card">
      <h2 id="push-title">Reminders on this phone</h2>
      <p className="text-muted-foreground">
        A notification when you haven&apos;t clocked in, your break runs long or you forget to clock out, and for staff,
        when something needs approving. None between 9 pm and 7 am.
      </p>
      {state === "install" ? (
        <p>Install DGK Clock first (Share → Add to Home Screen), then turn reminders on from the installed app.</p>
      ) : state === "unsupported" ? (
        <p className="text-muted-foreground">This browser can&apos;t show reminders. You still see them under Notifications.</p>
      ) : state === "blocked" ? (
        <p>Notifications are blocked for DGK Clock. Allow them in your phone&apos;s settings, then come back here.</p>
      ) : state === "on" ? (
        <Button type="button" variant="secondary" className="w-fit" disabled={busy} onClick={() => void turnOff()}>
          <BellOff aria-hidden />
          Turn reminders off
        </Button>
      ) : (
        <Button type="button" className="w-fit" disabled={busy || !checked} onClick={() => void turnOn()}>
          <BellRing aria-hidden />
          Turn reminders on
        </Button>
      )}
    </section>
  );
}

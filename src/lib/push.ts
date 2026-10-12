"use client";

import { createClient } from "@/lib/supabase/client";

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
/** Fired on window when `relinkPush` gives this phone a new subscription, so the banner and switch show "on". */
export const PUSH_LINKED = "dgk-push-linked";

export function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

/** This phone's push subscription, if the browser has one (no prompt). */
export async function currentPushSubscription() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Re-subscribe quietly only when notifications are already allowed but the phone lost its subscription (D45). */
export function shouldRelink(args: { supported: boolean; permission: NotificationPermission | null; subscribed: boolean }) {
  return args.supported && args.permission === "granted" && !args.subscribed;
}

async function saveSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();
  const { error } = await createClient().rpc("save_push_subscription", {
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
  });
  if (error) throw error;
}

let linkedFor: string | null = null;

/**
 * Once per app open per person, from the desk shell (D45): attaches this phone's subscription to the
 * signed-in person (the save moves it), or re-subscribes when permission is granted but the subscription
 * is gone. Never asks for permission, never throws.
 */
export async function relinkPush(personId: string) {
  if (linkedFor === personId) return;
  linkedFor = personId;
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) return await saveSubscription(existing);
    const permission = typeof Notification === "undefined" ? null : Notification.permission;
    if (!shouldRelink({ supported: Boolean(VAPID_PUBLIC_KEY), permission, subscribed: false })) return;
    const created = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    try {
      await saveSubscription(created);
    } catch (error) {
      await created.unsubscribe();
      throw error;
    }
    window.dispatchEvent(new Event(PUSH_LINKED));
  } catch {
    linkedFor = null; // offline or refused: try again on the next screen
  }
}

/** "Shared phone" sign-out only: stop this phone getting the signed-out person's reminders (D36, D45). Best effort. */
export async function forgetPushSubscription() {
  try {
    const subscription = await currentPushSubscription();
    if (!subscription) return;
    await createClient().rpc("delete_push_subscription", { endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  } catch {
    // Offline or blocked: the server drops the phone when the push service says it is gone.
  }
}

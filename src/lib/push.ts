"use client";

import { createClient } from "@/lib/supabase/client";

/** This phone's push subscription, if the browser has one (no prompt). */
export async function currentPushSubscription() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** On sign-out: stop this phone getting the signed-out person's reminders (D36). Best effort. */
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

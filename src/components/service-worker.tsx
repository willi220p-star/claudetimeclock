"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { BASE_PATH } from "@/lib/brand";

/**
 * Registers the service worker on the Pages build only (D34): the app opens with no signal and can be
 * installed. Dev and e2e run without it. A new version waits until the person taps Reload.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!BASE_PATH || !("serviceWorker" in navigator)) return;
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const offer = (worker: ServiceWorker) =>
      toast("A new version of DGK Clock is ready.", {
        duration: Infinity,
        action: { label: "Reload", onClick: () => worker.postMessage({ type: "SKIP_WAITING" }) },
      });

    navigator.serviceWorker
      .register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` })
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            // Only an update: the very first install has no controller and needs no reload.
            if (worker.state === "installed" && navigator.serviceWorker.controller) offer(worker);
          });
        });
      })
      .catch(() => undefined); // No worker: the app still works online.

    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  return null;
}

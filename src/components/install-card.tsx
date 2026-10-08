"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const standaloneQuery = "(display-mode: standalone)";
function subscribeStandalone(onChange: () => void) {
  const query = window.matchMedia(standaloneQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True when DGK Clock runs from the home screen (needed for reminders on iPhone). */
export function useInstalled() {
  return useSyncExternalStore(
    subscribeStandalone,
    () => window.matchMedia(standaloneQuery).matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    () => false,
  );
}

export function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * "Install DGK Clock" (D34): Android's install prompt, or the iPhone's Share → Add to Home Screen
 * steps. Hidden once installed.
 */
export function InstallCard() {
  const installed = useInstalled();
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios] = useState(() => typeof navigator !== "undefined" && isIos());

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault(); // show our own button instead of the browser's banner
      setPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (installed || (!prompt && !ios)) return null;

  return (
    <section aria-labelledby="install-title" className="flex flex-col gap-3 rounded-xl bg-card p-6 shadow-card">
      <h2 id="install-title">Install DGK Clock</h2>
      <p className="text-muted-foreground">
        Add DGK Clock to your home screen. It opens faster, works with no signal, and can send you reminders.
      </p>
      {prompt ? (
        <Button
          type="button"
          className="w-fit"
          onClick={() => {
            void prompt.prompt();
            void prompt.userChoice.finally(() => setPrompt(null));
          }}
        >
          <Download aria-hidden />
          Install
        </Button>
      ) : (
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Tap <Share aria-label="Share" className="inline size-4 align-text-bottom" /> Share in Safari.
          </li>
          <li>Tap Add to Home Screen, then Add.</li>
          <li>Open DGK Clock from your home screen.</li>
        </ol>
      )}
    </section>
  );
}

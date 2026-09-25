"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { errorText } from "@/lib/daymark";

export type Loaded<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

/**
 * Runs `load` on mount and whenever its identity changes (wrap it in useCallback).
 * `reload` runs it again, keeping the current data on screen until the new data arrives.
 */
export function useLoad<T>(load: () => Promise<T>) {
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    load().then(
      (data) => {
        if (live) setState({ status: "ready", data });
      },
      (error: unknown) => {
        if (live) setState({ status: "error", message: errorText(error, "That didn't load. Try again.") });
      },
    );
    return () => {
      live = false;
    };
  }, [load, attempt]);

  const reload = useCallback(() => {
    setState((current) => (current.status === "error" ? { status: "loading" } : current));
    setAttempt((count) => count + 1);
  }, []);

  return [state, reload] as const;
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The browser's online flag; true while prerendering. */
export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

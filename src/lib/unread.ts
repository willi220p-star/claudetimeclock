"use client";

import { useCallback } from "react";
import { unreadNotificationCount } from "@/lib/data";
import { useLoad } from "@/lib/use-load";

export function useUnread(personId: string) {
  const load = useCallback(() => unreadNotificationCount(personId), [personId]);
  const [state] = useLoad(load);
  return state.status === "ready" ? state.data : 0;
}

"use client";

import { useCallback, type ReactNode } from "react";
import { InternShell } from "@/components/desk-shell";
import { unreadNotificationCount } from "@/lib/data";
import type { Profile } from "@/lib/daymark";
import { useLoad } from "@/lib/use-load";

export function InternFrame({
  profile,
  title,
  children,
}: {
  profile: Profile;
  title: string;
  children: ReactNode;
}) {
  const load = useCallback(() => unreadNotificationCount(profile.id).catch(() => 0), [profile.id]);
  const [unread] = useLoad(load);
  return (
    <InternShell profile={profile} title={title} unread={unread.status === "ready" ? unread.data : 0}>
      {children}
    </InternShell>
  );
}

"use client";

import { DgkLogo } from "@/components/dgk-logo";
import { NotificationBell } from "@/components/notification-bell";
import { RoleSwitcher } from "@/components/role-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import type { Profile } from "@/lib/daymark";
import { useIdleSignOut } from "@/lib/idle";
import type { Role } from "@/lib/roles";
import { useLiveUnread } from "@/lib/unread";

/**
 * Sticky 56px header in a translucent, blurred material with a hairline, like an iOS navigation bar.
 * Every signed-in screen renders it, so it also owns the live bell count and the idle sign-out.
 */
export function AppHeader({ profile, role, title }: { profile: Profile; role: Role; title: string }) {
  const unread = useLiveUnread(profile.id);
  useIdleSignOut();
  return (
    <header className="sticky top-0 z-30 h-14 border-b border-black/5 bg-background/80 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-full w-full max-w-[1200px] items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <DgkLogo size={32} className="shrink-0" />
          <p className="truncate font-semibold">{title}</p>
        </div>
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          <RoleSwitcher profile={profile} current={role} />
          <NotificationBell count={unread} href="/notifications" />
          <SignOutButton compact />
        </div>
      </div>
    </header>
  );
}

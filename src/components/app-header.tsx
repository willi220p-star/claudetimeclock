import { DgkLogo } from "@/components/dgk-logo";
import { NotificationBell } from "@/components/notification-bell";
import { RoleSwitcher } from "@/components/role-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import type { Profile } from "@/lib/daymark";
import type { Role } from "@/lib/roles";

/** §15: sticky 56px header, white at 95% with a blur and a Sand bottom border. */
export function AppHeader({
  profile,
  role,
  title,
  unread = 0,
}: {
  profile: Profile;
  role: Role;
  title: string;
  unread?: number;
}) {
  return (
    <header className="sticky top-0 z-30 h-14 border-b border-border bg-card/95 backdrop-blur">
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

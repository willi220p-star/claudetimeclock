"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, ChartPie, CircleUserRound, Clock, Inbox, type LucideIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/daymark";
import type { Role } from "@/lib/roles";

const INTERN_TABS = [
  { href: "/clock", label: "Today", icon: Clock, match: (path: string) => path === "/clock" || path === "/clock/" },
  { href: "/clock/schedule", label: "Schedule", icon: CalendarDays, match: (path: string) => path.startsWith("/clock/schedule") },
  { href: "/clock/requests", label: "Requests", icon: Inbox, match: (path: string) => path.startsWith("/clock/requests") },
  { href: "/clock/progress", label: "Progress", icon: ChartPie, match: (path: string) => path.startsWith("/clock/progress") },
  { href: "/clock/me", label: "Me", icon: CircleUserRound, match: (path: string) => path.startsWith("/clock/me") },
] as const;

const SUPERVISOR_NAV = [
  { href: "/supervisor", label: "Today", match: (path: string) => path === "/supervisor" || path === "/supervisor/" },
  { href: "/supervisor/approvals", label: "Approvals", match: (path: string) => path.startsWith("/supervisor/approvals") },
  { href: "/supervisor/interns", label: "Interns", match: (path: string) => path.startsWith("/supervisor/intern") },
] as const;

const ADMIN_NAV = [
  { href: "/admin", label: "Overview", match: (path: string) => path === "/admin" || path === "/admin/" },
  { href: "/admin/placements", label: "Placements", match: (path: string) => path.startsWith("/admin/placement") },
  { href: "/admin/people", label: "People", match: (path: string) => path.startsWith("/admin/people") },
  { href: "/admin/cohorts", label: "Cohorts", match: (path: string) => path.startsWith("/admin/cohorts") },
  { href: "/admin/import", label: "Import", match: (path: string) => path.startsWith("/admin/import") },
  { href: "/admin/requests", label: "Requests", match: (path: string) => path.startsWith("/admin/requests") },
  { href: "/admin/sites", label: "Sites", match: (path: string) => path.startsWith("/admin/sites") },
  { href: "/admin/closures", label: "Closures", match: (path: string) => path.startsWith("/admin/closures") },
  { href: "/admin/settings", label: "Settings", match: (path: string) => path.startsWith("/admin/settings") },
  { href: "/admin/reports", label: "Reports", match: (path: string) => path.startsWith("/admin/reports") },
  { href: "/admin/audit", label: "Audit", match: (path: string) => path.startsWith("/admin/audit") },
] as const;

type NavItem = { href: string; label: string; icon?: LucideIcon; match: (path: string) => boolean };

/** Intern tab bar: icon over label, the current tab in DGK blue, like an iPhone tab bar. */
function TabBar({ items }: { items: readonly NavItem[] }) {
  const path = usePathname() ?? "";
  return (
    <ul className="flex w-full">
      {items.map((item) => {
        const current = item.match(path);
        const Icon = item.icon;
        return (
          <li key={item.href} className="flex-1">
            <Link
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex min-h-12 w-full flex-col items-center justify-center gap-0.5 pt-1.5 text-[11px] font-medium",
                current ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {Icon ? <Icon aria-hidden className="size-6" strokeWidth={current ? 2.25 : 1.75} /> : null}
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Staff navigation: a sidebar on wide screens, a scrollable segmented control on phones. */
function NavLinks({ items, orientation }: { items: readonly NavItem[]; orientation: "tabs" | "side" }) {
  const path = usePathname() ?? "";
  return (
    <ul className={orientation === "tabs" ? "flex w-max min-w-full gap-1 rounded-full bg-muted p-1" : "flex flex-col gap-0.5"}>
      {items.map((item) => {
        const current = item.match(path);
        return (
          <li key={item.href} className={orientation === "tabs" ? "flex-1" : undefined}>
            <Link
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 w-full items-center px-4 text-[15px] font-medium whitespace-nowrap transition-colors",
                orientation === "tabs" ? "justify-center rounded-full" : "justify-start rounded-md",
                orientation === "tabs"
                  ? current
                    ? "bg-card text-foreground shadow-card"
                    : "text-muted-foreground hover:text-foreground"
                  : current
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-foreground hover:bg-black/5",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function InternShell({
  profile,
  title,
  unread = 0,
  children,
}: {
  profile: Profile;
  title: string;
  unread?: number;
  children: ReactNode;
}) {
  return (
    <>
      <AppHeader profile={profile} role="intern" title={title} unread={unread} />
      <main className="mx-auto w-full max-w-[720px] px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))]">{children}</main>
      <nav
        aria-label="Intern"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-background/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150"
      >
        <div className="mx-auto max-w-[720px] px-2">
          <TabBar items={INTERN_TABS} />
        </div>
      </nav>
    </>
  );
}

export function StaffShell({
  profile,
  role,
  title,
  unread = 0,
  children,
}: {
  profile: Profile;
  role: Exclude<Role, "intern">;
  title: string;
  unread?: number;
  children: ReactNode;
}) {
  const items = role === "admin" ? ADMIN_NAV : SUPERVISOR_NAV;
  return (
    <>
      <AppHeader profile={profile} role={role} title={title} unread={unread} />
      <div className="mx-auto flex w-full max-w-[1200px] gap-6 px-4 py-6">
        <nav aria-label={role === "admin" ? "Admin" : "Supervisor"} className="hidden w-52 shrink-0 lg:block">
          <NavLinks items={items} orientation="side" />
        </nav>
        <div className="min-w-0 flex-1">
          <nav aria-label="Sections" className="mb-4 overflow-x-auto lg:hidden">
            <NavLinks items={items} orientation="tabs" />
          </nav>
          <main className="flex flex-col gap-6">{children}</main>
        </div>
      </div>
    </>
  );
}

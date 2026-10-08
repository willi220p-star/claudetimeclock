"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { CalendarDays, ChartPie, CircleUserRound, Clock, House, Inbox, Settings, Users, type LucideIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { SignOutButton } from "@/components/sign-out-button";
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

const exact = (href: string) => (path: string) => path === href || path === `${href}/`;
const prefix = (href: string) => (path: string) => path.startsWith(href);

type NavPage = { href: string; label: string; match: (path: string) => boolean };
type NavGroup = { label: string; icon: LucideIcon; pages: NavPage[] };

// Staff navigation as a tree (Dilip, 5 Oct): a few main tabs, each with its related pages as sub-tabs.
export const SUPERVISOR_GROUPS: NavGroup[] = [
  { label: "Today", icon: House, pages: [{ href: "/supervisor", label: "Today", match: exact("/supervisor") }] },
  {
    label: "Time",
    icon: Clock,
    pages: [
      { href: "/supervisor/roster", label: "Roster", match: prefix("/supervisor/roster") },
      { href: "/supervisor/timesheets", label: "Timesheets", match: prefix("/supervisor/timesheets") },
    ],
  },
  {
    label: "Approvals",
    icon: Inbox,
    pages: [{ href: "/supervisor/approvals", label: "Approvals", match: prefix("/supervisor/approvals") }],
  },
  {
    label: "Interns",
    icon: Users,
    pages: [
      { href: "/supervisor/interns", label: "Interns", match: prefix("/supervisor/intern") },
      { href: "/supervisor/progress", label: "Progress", match: prefix("/supervisor/progress") },
      { href: "/supervisor/summary", label: "Summary", match: prefix("/supervisor/summary") },
      { href: "/supervisor/records", label: "Records", match: prefix("/supervisor/records") },
    ],
  },
];

export const ADMIN_GROUPS: NavGroup[] = [
  { label: "Home", icon: House, pages: [{ href: "/admin", label: "Overview", match: exact("/admin") }] },
  {
    label: "People",
    icon: Users,
    pages: [
      { href: "/admin/people", label: "People", match: prefix("/admin/people") },
      { href: "/admin/placements", label: "Placements", match: prefix("/admin/placement") },
      { href: "/admin/cohorts", label: "Cohorts", match: prefix("/admin/cohorts") },
      { href: "/admin/import", label: "Import", match: prefix("/admin/import") },
    ],
  },
  {
    label: "Time",
    icon: Clock,
    pages: [
      { href: "/admin/roster", label: "Roster", match: prefix("/admin/roster") },
      { href: "/admin/timesheets", label: "Timesheets", match: prefix("/admin/timesheets") },
      { href: "/admin/requests", label: "Requests", match: prefix("/admin/requests") },
      { href: "/admin/closures", label: "Closures", match: prefix("/admin/closures") },
    ],
  },
  {
    label: "Reports",
    icon: ChartPie,
    pages: [
      { href: "/admin/reports", label: "Reports", match: prefix("/admin/reports") },
      { href: "/admin/progress", label: "Progress", match: prefix("/admin/progress") },
      { href: "/admin/records", label: "Records", match: prefix("/admin/records") },
      { href: "/admin/audit", label: "Audit", match: prefix("/admin/audit") },
    ],
  },
  {
    label: "Settings",
    icon: Settings,
    pages: [
      { href: "/admin/settings", label: "Settings", match: prefix("/admin/settings") },
      { href: "/admin/sites", label: "Sites", match: prefix("/admin/sites") },
    ],
  },
];

/** The group a path belongs to, for the bottom tabs and the sub-tabs. */
export function currentGroup(groups: NavGroup[], path: string) {
  return groups.find((group) => group.pages.some((page) => page.match(path))) ?? null;
}

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
              // On phones the tabs scroll sideways: keep the current one in view.
              ref={current && orientation === "tabs" ? (node) => node?.scrollIntoView({ block: "nearest", inline: "center" }) : undefined}
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
  children,
}: {
  profile: Profile;
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <AppHeader profile={profile} role="intern" title={title} />
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
  children,
}: {
  profile: Profile;
  role: Exclude<Role, "intern">;
  title: string;
  children: ReactNode;
}) {
  const path = usePathname() ?? "";
  const groups = role === "admin" ? ADMIN_GROUPS : SUPERVISOR_GROUPS;
  const group = currentGroup(groups, path);
  const tabs: NavItem[] = groups.map((item) => ({
    href: item.pages[0].href,
    label: item.label,
    icon: item.icon,
    match: (current: string) => item.pages.some((page) => page.match(current)),
  }));
  return (
    <>
      <AppHeader profile={profile} role={role} title={title} />
      <div className="mx-auto flex w-full max-w-[1200px] gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-6">
        <nav aria-label={role === "admin" ? "Admin" : "Supervisor"} className="hidden w-52 shrink-0 lg:block print:hidden">
          <ul className="flex flex-col gap-4">
            {groups.map((item) => (
              <li key={item.label} className="flex flex-col gap-1">
                {item.pages.length > 1 ? (
                  <p className="px-4 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">{item.label}</p>
                ) : null}
                <NavLinks items={item.pages} orientation="side" />
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">
          {group && group.pages.length > 1 ? (
            <nav aria-label={`${group.label} pages`} className="mb-4 overflow-x-auto lg:hidden print:hidden">
              <NavLinks items={group.pages} orientation="tabs" />
            </nav>
          ) : null}
          <main className="flex flex-col gap-6">{children}</main>
          <div className="mt-10 flex flex-wrap justify-end gap-2 border-t border-black/5 pt-4">
            <Link href="/set-password" className={buttonVariants({ variant: "ghost" })}>
              Change password
            </Link>
            <SignOutButton everywhere />
          </div>
        </div>
      </div>
      <nav
        aria-label={role === "admin" ? "Admin sections" : "Supervisor sections"}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-background/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 lg:hidden print:hidden"
      >
        <div className="mx-auto max-w-[720px] px-2">
          <TabBar items={tabs} />
        </div>
      </nav>
    </>
  );
}

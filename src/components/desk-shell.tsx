"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/daymark";
import type { Role } from "@/lib/roles";

const INTERN_TABS = [
  { href: "/clock", label: "Today", match: (path: string) => path === "/clock" || path === "/clock/" },
  { href: "/clock/schedule", label: "Schedule", match: (path: string) => path.startsWith("/clock/schedule") },
  { href: "/clock/requests", label: "Requests", match: (path: string) => path.startsWith("/clock/requests") },
  { href: "/clock/progress", label: "Progress", match: (path: string) => path.startsWith("/clock/progress") },
  { href: "/clock/me", label: "Me", match: (path: string) => path.startsWith("/clock/me") },
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

function NavLinks({
  items,
  orientation,
}: {
  items: readonly { href: string; label: string; match: (path: string) => boolean }[];
  orientation: "tabs" | "side";
}) {
  const path = usePathname() ?? "";
  return (
    <ul className={orientation === "tabs" ? "flex w-full" : "flex flex-col gap-1"}>
      {items.map((item) => {
        const current = item.match(path);
        return (
          <li key={item.href} className={orientation === "tabs" ? "flex-1" : undefined}>
            <Link
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 w-full items-center justify-center rounded-md px-3 text-sm font-semibold",
                orientation === "side" && "justify-start",
                current ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
      <main className="mx-auto w-full max-w-[1200px] px-4 pt-6 pb-24">{children}</main>
      <nav aria-label="Intern" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-[1200px] px-2">
          <NavLinks items={INTERN_TABS} orientation="tabs" />
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

"use client";

import { useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { loadMyPlacement, loadRequestsForPlacement } from "@/lib/data";
import { isPending } from "@/lib/placement-ui";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";

export type Segment = { href: string; label: string; badge?: number; match: (path: string) => boolean };

const exact = (href: string) => (path: string) => path === href || path === `${href}/`;
const prefix = (href: string) => (path: string) => path.startsWith(href);

/** Me | Progress | Requests (D46): separate pages, so old links such as notifications keep working. */
export const ME_SEGMENTS: Segment[] = [
  { href: "/clock/me", label: "Me", match: prefix("/clock/me") },
  { href: "/clock/progress", label: "Progress", match: prefix("/clock/progress") },
  { href: "/clock/requests", label: "Requests", match: prefix("/clock/requests") },
];

export const SCHEDULE_SEGMENTS: Segment[] = [
  { href: "/clock/schedule", label: "Roster", match: exact("/clock/schedule") },
  { href: "/clock/schedule/history", label: "History", match: prefix("/clock/schedule/history") },
];

/** An iOS-style segmented control whose segments are links between sibling pages. */
export function SegmentedNav({ label, items }: { label: string; items: Segment[] }) {
  const path = usePathname() ?? "";
  return (
    <nav aria-label={label} className="mb-6">
      <ul className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-xl bg-muted p-0.5">
        {items.map((item) => {
          const current = item.match(path);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] px-2 text-[15px] transition-colors",
                  current ? "bg-card font-semibold text-foreground shadow-card" : "font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                {item.badge ? (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground tabular-nums">
                    {item.badge}
                    <span className="sr-only"> pending</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

async function pendingRequestCount() {
  const placement = await loadMyPlacement();
  if (!placement) return 0;
  return (await loadRequestsForPlacement(placement.id)).filter((row) => isPending(row.status)).length;
}

/** The Me, Progress and Requests switch, with the intern's pending requests counted on Requests. */
export function MeTabs({ pending }: { pending?: number }) {
  // The Requests page already has its rows and passes the count; the other two load it.
  const load = useCallback(() => (pending === undefined ? pendingRequestCount() : Promise.resolve(pending)), [pending]);
  const [state] = useLoad(load);
  const count = pending ?? (state.status === "ready" ? state.data : 0);
  return (
    <SegmentedNav
      label="Me pages"
      items={ME_SEGMENTS.map((item) => (item.href === "/clock/requests" ? { ...item, badge: count } : item))}
    />
  );
}

export function ScheduleTabs() {
  return <SegmentedNav label="Schedule pages" items={SCHEDULE_SEGMENTS} />;
}

"use client";

import { useState } from "react";
import { ApproveSheet } from "@/components/approve-sheet";
import { EmptyState } from "@/components/empty-state";
import { StatusChip } from "@/components/status-chip";
import { formatDay } from "@/lib/darwin";
import { requestLabel } from "@/lib/placement-ui";
import { cn } from "@/lib/utils";
import { ageClass, ageHours, internName, previewLine, type InboxItem } from "@/app/supervisor/supervisor";

export function InboxPanel({
  items,
  onDone,
  empty = "No approvals waiting.",
}: {
  items: InboxItem[];
  onDone: () => void;
  empty?: string;
}) {
  const [open, setOpen] = useState<InboxItem | null>(null);

  if (items.length === 0) return <EmptyState>{empty}</EmptyState>;

  return (
    <>
      <ul className="flex flex-col gap-2">
        {items.map((row) => {
          const hours = ageHours(row.created_at);
          const name = internName(row);
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => setOpen(row)}
                className="flex w-full flex-col gap-2 rounded-lg bg-card p-4 text-left shadow-card sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{requestLabel(row.type)}</span>
                    <span className="text-muted-foreground">{name}</span>
                    {row.escalated_at ? <StatusChip tone="bad" label="Escalated" /> : null}
                    {row.needs_extra_spot ? <StatusChip tone="info" label="Extra spot" /> : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {row.dates.length > 0 ? row.dates.map((d) => formatDay(d)).join(", ") : "—"}
                  </p>
                  <p className="truncate text-sm">{previewLine(row.preview, row.reason)}</p>
                </div>
                <span className={cn("shrink-0 tabular-nums text-sm font-semibold", ageClass(hours, row.escalated_at))}>
                  {hours} h
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <ApproveSheet
        open={open !== null}
        onClose={() => setOpen(null)}
        requestId={open?.id ?? ""}
        type={open?.type ?? ""}
        internName={open ? internName(open) : ""}
        preview={open?.preview ?? null}
        requestedMinutes={open?.requested_minutes}
        onDone={onDone}
      />
    </>
  );
}

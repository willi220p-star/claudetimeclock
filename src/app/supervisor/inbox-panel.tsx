"use client";

import { useState } from "react";
import { asRecord } from "@/lib/placement-ui";
import { ApproveSheet } from "@/components/approve-sheet";
import { BulkBar, decideRequests, useSelection } from "@/components/bulk-decide";
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
  bulk = false,
}: {
  items: InboxItem[];
  onDone: () => void;
  empty?: string;
  bulk?: boolean;
}) {
  const [open, setOpen] = useState<InboxItem | null>(null);
  const selection = useSelection(items.map((row) => row.id));

  if (items.length === 0) return <EmptyState>{empty}</EmptyState>;

  return (
    <>
      {bulk ? (
        <BulkBar
          total={items.length}
          count={selection.selected.length}
          onAll={selection.all}
          onDecide={async (decision, note) => {
            await decideRequests(
              items.filter((row) => selection.has(row.id)),
              decision,
              note,
            );
            selection.clear();
            onDone();
          }}
        />
      ) : null}
      <ul className="flex flex-col gap-2">
        {items.map((row) => {
          const hours = ageHours(row.created_at);
          const name = internName(row);
          return (
            <li key={row.id} className="flex items-stretch gap-2">
              {bulk ? (
                <label className="grid min-w-11 place-items-center rounded-lg bg-card shadow-card">
                  <input
                    type="checkbox"
                    aria-label={`Select ${requestLabel(row.type)} from ${name}`}
                    className="size-5 accent-primary"
                    checked={selection.has(row.id)}
                    onChange={() => selection.toggle(row.id)}
                  />
                </label>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(row)}
                className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg bg-card p-4 text-left shadow-card sm:flex-row sm:items-center sm:justify-between"
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
                <span className={cn("shrink-0 tabular-nums text-sm font-semibold", ageClass(hours, row.escalated_at))}>{hours} h</span>
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
        attachmentPath={open?.attachment_path}
        certificateSighted={open?.certificate_sighted}
        punchId={open?.type === "attendance" ? (asRecord(open.payload)?.punch_id as string | undefined) : null}
        reason={open?.reason}
        onDone={onDone}
      />
    </>
  );
}

"use client";

import { useState } from "react";
import { ApproveSheet } from "@/components/approve-sheet";
import { EmptyState } from "@/components/empty-state";
import { StatusChip } from "@/components/status-chip";
import { approvalTone, internName, requestAgeHours, requestLabel, type RequestPreview } from "@/lib/placement-ui";
import { formatDay } from "@/lib/darwin";
import { previewRequest } from "@/lib/data";
import type { Tables } from "@/lib/database.types";

export type InboxRow = Tables<"daymark_requests"> & { daymark_profiles?: { display_name: string } | null };

export function ApprovalsList({
  rows,
  now,
  onChanged,
}: {
  rows: InboxRow[];
  now: Date;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<InboxRow | null>(null);
  const [preview, setPreview] = useState<RequestPreview | null>(null);

  async function openRow(row: InboxRow) {
    setOpen(row);
    setPreview(null);
    try {
      setPreview(await previewRequest({ id: row.id }));
    } catch {
      setPreview({ ok: false, message: "The preview didn't load.", needs_extra_spot: row.needs_extra_spot, dates: row.dates, effects: [], capacity: [] });
    }
  }

  if (rows.length === 0) {
    return <EmptyState>No approvals waiting.</EmptyState>;
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const hours = requestAgeHours(row.created_at, now);
          const name = internName(row.daymark_profiles);
          return (
            <li key={row.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-1 rounded-xl bg-card p-4 text-left shadow-card"
                onClick={() => void openRow(row)}
              >
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {requestLabel(row.type)} · {name}
                  </p>
                  <StatusChip
                    tone={approvalTone(hours, Boolean(row.escalated_at))}
                    label={row.escalated_at ? "Escalated" : `${hours} h`}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {row.dates.map((day) => formatDay(day)).join(", ") || "No dates"}
                  {row.needs_extra_spot ? " · extra spot" : ""}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
      {open ? (
        <ApproveSheet
          open
          onClose={() => setOpen(null)}
          requestId={open.id}
          type={open.type}
          internName={internName(open.daymark_profiles)}
          preview={preview}
          requestedMinutes={open.requested_minutes}
          attachmentPath={open.attachment_path}
          certificateSighted={open.certificate_sighted}
          onDone={onChanged}
        />
      ) : null}
    </>
  );
}

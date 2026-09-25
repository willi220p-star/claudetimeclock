"use client";

import { useState } from "react";
import { AdminFrame } from "@/app/admin/admin-frame";
import { ApproveSheet } from "@/components/approve-sheet";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { loadInbox, previewRequest } from "@/lib/data";
import { formatDay, relativeOrDate } from "@/lib/darwin";
import { REQUEST_STATUS_LABEL, requestLabel, type RequestPreview } from "@/lib/placement-ui";
import { useLoad } from "@/lib/use-load";

type InboxRow = Awaited<ReturnType<typeof loadInbox>>[number];

export function RequestsScreen() {
  return (
    <AdminFrame title="Requests">
      <RequestsDesk />
    </AdminFrame>
  );
}

function RequestsDesk() {
  const [inbox, reload] = useLoad(loadInbox);
  const [open, setOpen] = useState<InboxRow | null>(null);
  const [preview, setPreview] = useState<RequestPreview | null>(null);

  async function review(row: InboxRow) {
    setOpen(row);
    setPreview(null);
    try {
      setPreview(await previewRequest({ id: row.id }));
    } catch {
      setPreview({
        ok: false,
        message: "The preview didn't load. You can still approve or decline.",
        needs_extra_spot: row.needs_extra_spot,
        dates: row.dates ?? [],
        effects: [],
        capacity: [],
      });
    }
  }

  return (
    <>
      <PageHeader title="Requests" description="Pending, escalated, and extra-spot requests waiting on a decision." />
      <LoadBlock state={inbox} reload={reload} empty="No pending requests.">
        {(rows) => (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const intern = row.daymark_profiles?.display_name ?? "Intern";
              return (
                <li key={row.id} className="flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {requestLabel(row.type)} · {intern}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {(row.dates ?? []).map((d) => formatDay(d)).join(", ") || "No dates"}
                        {" · "}
                        {relativeOrDate(row.created_at, new Date())}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <StatusChip
                        tone={row.status === "pending_admin" ? "warn" : "info"}
                        label={REQUEST_STATUS_LABEL[row.status] ?? row.status}
                      />
                      {row.needs_extra_spot ? <StatusChip tone="warn" label="extra spot" /> : null}
                      {row.escalated_at ? <StatusChip tone="bad" label="Escalated" /> : null}
                    </div>
                  </div>
                  <Button type="button" onClick={() => void review(row)}>
                    Approve
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </LoadBlock>
      <ApproveSheet
        open={open !== null}
        onClose={() => setOpen(null)}
        requestId={open?.id ?? ""}
        type={open?.type ?? "leave"}
        internName={open?.daymark_profiles?.display_name ?? "Intern"}
        preview={preview}
        requestedMinutes={open?.requested_minutes}
        attachmentPath={open?.attachment_path}
        certificateSighted={open?.certificate_sighted}
        onDone={reload}
      />
    </>
  );
}

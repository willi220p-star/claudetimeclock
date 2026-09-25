"use client";

import { useState } from "react";
import { toast } from "sonner";
import { EffectPreview } from "@/components/effect-preview";
import { StatusChip } from "@/components/status-chip";
import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { certificateUrl } from "@/lib/certificates";
import { errorText } from "@/lib/daymark";
import { formatMinutes } from "@/lib/minutes";
import {
  overtimeSteps,
  previewToEffects,
  requestLabel,
  type RequestPreview,
} from "@/lib/placement-ui";
import { createClient } from "@/lib/supabase/client";

const QUICK_DECLINES = ["Not enough notice", "Office is full that day", "Please pick another date"];

export function ApproveSheet({
  open,
  onClose,
  requestId,
  type,
  internName,
  preview,
  requestedMinutes,
  attachmentPath,
  certificateSighted = false,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  requestId: string;
  type: string;
  internName: string;
  preview: RequestPreview | null;
  requestedMinutes?: number | null;
  attachmentPath?: string | null;
  certificateSighted?: boolean;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [minutes, setMinutes] = useState(requestedMinutes ?? 0);
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const steps = type === "overtime" ? overtimeSteps(requestedMinutes ?? 0) : [];

  async function decide(decision: "approve" | "decline") {
    setError(null);
    if (decision === "decline" && note.trim().length === 0) {
      setError("Add a note so the intern knows why.");
      return;
    }
    setBusy(decision);
    const { error: fail } = await createClient().rpc("decide_request", {
      request_id: requestId,
      decision,
      note: note.trim() || undefined,
      approved_minutes: decision === "approve" && type === "overtime" ? minutes : undefined,
    });
    setBusy(null);
    if (fail) {
      setError(errorText(fail, "That decision didn't save. Try again."));
      return;
    }
    toast.success(decision === "approve" ? `${requestLabel(type)} approved.` : `${requestLabel(type)} declined.`);
    onDone();
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>
          {requestLabel(type)} · {internName}
        </DialogTitle>
        <DialogDescription>Check the effect, then approve or decline.</DialogDescription>
        {preview ? (
          preview.ok ? (
            <EffectPreview effects={previewToEffects(preview)} />
          ) : (
            <FormMessage>{preview.message}</FormMessage>
          )
        ) : (
          <p className="text-sm text-muted-foreground">Loading the preview…</p>
        )}
        {type === "leave" ? (
          <CertificateSection
            key={requestId}
            requestId={requestId}
            attachmentPath={attachmentPath ?? null}
            sighted={certificateSighted}
            onSighted={onDone}
          />
        ) : null}
        {steps.length > 0 ? (
          <FormField id="ot-minutes" label="Minutes to count" hint="15-minute steps. You can approve part of the overtime.">
            {(input) => (
              <select
                {...input}
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value))}
                className="h-11 rounded-md border border-input bg-card px-3"
              >
                {steps.map((step) => (
                  <option key={step} value={step}>
                    {formatMinutes(step)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        ) : null}
        <FormField id="decision-note" label="Note" hint="Required to decline.">
          {(input) => (
            <textarea
              {...input}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="min-h-20 rounded-md border border-input bg-card px-3 py-2"
            />
          )}
        </FormField>
        <div className="flex flex-wrap gap-2">
          {QUICK_DECLINES.map((reason) => (
            <Button key={reason} type="button" variant="secondary" size="sm" onClick={() => setNote(reason)}>
              {reason}
            </Button>
          ))}
        </div>
        {error ? <FormMessage>{error}</FormMessage> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy !== null || preview?.ok === false} onClick={() => void decide("approve")}>
            Approve
          </Button>
          <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void decide("decline")}>
            Decline
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Leave only: open the intern's certificate (signed URL, 60 s) and record that it was sighted (rule 20). */
function CertificateSection({
  requestId,
  attachmentPath,
  sighted: initiallySighted,
  onSighted,
}: {
  requestId: string;
  attachmentPath: string | null;
  sighted: boolean;
  onSighted: () => void;
}) {
  const [sighted, setSighted] = useState(initiallySighted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function view(path: string) {
    setError(null);
    // Open the tab inside the click so it isn't blocked, then point it at the short-lived URL.
    const tab = window.open("", "_blank");
    try {
      const url = await certificateUrl(path);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.location.assign(url);
    } catch (fail) {
      tab?.close();
      setError(errorText(fail, "The certificate didn't open. Try again."));
    }
  }

  async function markSighted() {
    setError(null);
    setBusy(true);
    const { error: fail } = await createClient().rpc("mark_certificate_sighted", { request_id: requestId });
    setBusy(false);
    if (fail) {
      setError(errorText(fail, "That didn't save. Try again."));
      return;
    }
    setSighted(true);
    toast.success("Certificate marked as sighted.");
    onSighted();
  }

  return (
    <section aria-label="Medical certificate" className="flex flex-col gap-2 rounded-xl bg-muted p-4">
      <p className="caption text-muted-foreground">Medical certificate</p>
      <p className="text-sm">
        {attachmentPath ? "The intern added a certificate. It is deleted after the retention period." : "No certificate uploaded."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {attachmentPath ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => void view(attachmentPath)}>
            View certificate
          </Button>
        ) : null}
        {sighted ? (
          <StatusChip tone="ok" label="Sighted" />
        ) : (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void markSighted()}>
            Mark certificate sighted
          </Button>
        )}
      </div>
      {error ? <FormMessage>{error}</FormMessage> : null}
    </section>
  );
}

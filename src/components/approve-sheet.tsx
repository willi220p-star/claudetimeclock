"use client";

import { useState } from "react";
import { toast } from "sonner";
import { EffectPreview } from "@/components/effect-preview";
import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  requestId: string;
  type: string;
  internName: string;
  preview: RequestPreview | null;
  requestedMinutes?: number | null;
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

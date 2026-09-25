"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addDays } from "@/lib/periods";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";

type Action = "extend" | "complete" | "withdraw" | "report" | null;

export function PlacementActions({
  placementId,
  status,
  plannedEnd,
  reportApprovedAt,
  onDone,
}: {
  placementId: string;
  status: string;
  plannedEnd: string;
  reportApprovedAt: string | null;
  onDone: () => void;
}) {
  const [action, setAction] = useState<Action>(null);
  const [note, setNote] = useState("");
  const [newEnd, setNewEnd] = useState(addDays(plannedEnd, 14));
  const [allowExtra, setAllowExtra] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = status === "active" || status === "extended" || status === "target_reached";
  const canReport =
    (status === "target_reached" || status === "completed" || status === "withdrawn") && !reportApprovedAt;

  function close() {
    setAction(null);
    setNote("");
    setError(null);
    setAllowExtra(false);
  }

  async function run() {
    setError(null);
    setBusy(true);
    const client = createClient();
    const result =
      action === "extend"
        ? await client.rpc("extend_placement", {
            placement: placementId,
            new_end: newEnd,
            note: note.trim() || undefined,
            allow_extra: allowExtra,
          })
        : action === "complete"
          ? await client.rpc("confirm_completion", { placement: placementId, note: note.trim() || undefined })
          : action === "withdraw"
            ? await client.rpc("withdraw_placement", { placement: placementId, reason: note.trim() })
            : action === "report"
              ? await client.rpc("approve_uni_report", { placement: placementId, note: note.trim() || undefined })
              : { error: null };
    setBusy(false);
    if (result.error) {
      setError(errorText(result.error, "That didn't save. Try again."));
      return;
    }
    toast.success(
      action === "extend"
        ? "End date extended."
        : action === "complete"
          ? "Placement marked complete."
          : action === "withdraw"
            ? "Placement withdrawn."
            : "Uni report approved.",
    );
    close();
    onDone();
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {live ? (
          <>
            <Button type="button" variant="secondary" onClick={() => setAction("extend")}>
              Extend end date
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAction("complete")}>
              Confirm completion
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAction("withdraw")}>
              Withdraw
            </Button>
          </>
        ) : null}
        {canReport ? (
          <Button type="button" onClick={() => setAction("report")}>
            Approve uni report
          </Button>
        ) : null}
      </div>

      <Dialog
        open={action !== null}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent>
          <DialogTitle>
            {action === "extend"
              ? "Extend end date"
              : action === "complete"
                ? "Confirm completion"
                : action === "withdraw"
                  ? "Withdraw placement"
                  : "Approve uni report"}
          </DialogTitle>
          <DialogDescription>
            {action === "extend"
              ? "New scheduled days are added from the current pattern."
              : action === "complete"
                ? "This ends the placement and cancels days after today."
                : action === "withdraw"
                  ? "This ends the placement. Give a reason."
                  : "Approve the hours report once they are final."}
          </DialogDescription>
          {action === "extend" ? (
            <>
              <FormField id="new-end" label="New end date">
                {(input) => (
                  <Input
                    {...input}
                    type="date"
                    min={addDays(plannedEnd, 1)}
                    value={newEnd}
                    onChange={(event) => setNewEnd(event.target.value)}
                  />
                )}
              </FormField>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={allowExtra}
                  onChange={(event) => setAllowExtra(event.target.checked)}
                  className="size-5 accent-primary"
                />
                Allow an extra spot if a day is full
              </label>
            </>
          ) : null}
          <FormField
            id="action-note"
            label={action === "withdraw" ? "Reason" : "Note"}
            hint={action === "withdraw" ? "Required." : "Optional."}
          >
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
          {error ? <FormMessage>{error}</FormMessage> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy || (action === "withdraw" && note.trim().length === 0)}
              onClick={() => void run()}
            >
              Confirm
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={close}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

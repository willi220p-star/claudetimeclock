"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";

const MIN = 10;
const MAX = 500;

export function WorkLogSheet({
  open,
  onClose,
  workDate,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  workDate: string;
  onSaved?: () => void;
}) {
  const [date, setDate] = useState(workDate);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = summary.trim().length;

  async function save() {
    setError(null);
    if (length < MIN || length > MAX) {
      setError("Write between 10 and 500 characters about what you did.");
      return;
    }
    setBusy(true);
    const { error: fail } = await createClient().rpc("save_work_log", { summary: summary.trim(), work_date: date });
    setBusy(false);
    if (fail) {
      setError(errorText(fail, "That log didn't save. Try again."));
      return;
    }
    toast.success("Work log saved.");
    setSummary("");
    onSaved?.();
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
        <DialogTitle>Work log</DialogTitle>
        <DialogDescription>What did you work on? What did you learn?</DialogDescription>
        <FormField id="work-log-date" label="Day">
          {(input) => <Input {...input} type="date" value={date} onChange={(event) => setDate(event.target.value)} />}
        </FormField>
        <FormField id="work-log-summary" label="Log" hint={`${length} / ${MAX}`}>
          {(input) => (
            <textarea
              {...input}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={3}
              maxLength={MAX}
              className="min-h-20 rounded-md border border-input bg-card px-3 py-2"
            />
          )}
        </FormField>
        {error ? <FormMessage>{error}</FormMessage> : null}
        <Button type="button" className="w-full" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save log"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

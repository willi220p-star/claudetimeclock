"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { errorText } from "@/lib/daymark";
import { coversLine, type CatchUpOption, type CatchUpPlan } from "@/lib/placement-ui";
import { createClient } from "@/lib/supabase/client";

export function CatchUpSheet({
  open,
  onClose,
  plan,
  placementId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  plan: CatchUpPlan;
  placementId: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"a" | "b" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(option: "a" | "b") {
    setError(null);
    setBusy(option);
    const { error: fail } = await createClient().rpc("submit_catch_up", { placement: placementId, option });
    setBusy(null);
    if (fail) {
      setError(errorText(fail, "Those requests didn't send. Try again."));
      return;
    }
    toast.success("Catch-up requests sent.");
    onDone?.();
    onClose();
    router.push("/clock/requests");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>Catch up</DialogTitle>
        <DialogDescription>Pick a plan. Each option sends its requests together.</DialogDescription>
        <div className="grid gap-4 sm:grid-cols-2">
          <OptionCard
            title="Option A"
            hint="Longer days"
            option={plan.a}
            owed={plan.owed_minutes}
            busy={busy !== null}
            sending={busy === "a"}
            onSend={() => void send("a")}
          />
          <OptionCard
            title="Option B"
            hint="Extra days"
            option={plan.b}
            owed={plan.owed_minutes}
            busy={busy !== null}
            sending={busy === "b"}
            onSend={() => void send("b")}
          />
        </div>
        {error ? <FormMessage>{error}</FormMessage> : null}
      </DialogContent>
    </Dialog>
  );
}

function OptionCard({
  title,
  hint,
  option,
  owed,
  busy,
  sending,
  onSend,
}: {
  title: string;
  hint: string;
  option: CatchUpOption;
  owed: number;
  busy: boolean;
  sending: boolean;
  onSend: () => void;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {option.requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to send for this option right now.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {option.requests.map((item) => (
            <li key={item.label}>{item.label}</li>
          ))}
        </ul>
      )}
      <p className="text-sm font-semibold">{coversLine(option.covers_minutes, owed)}</p>
      <Button type="button" className="w-full" disabled={busy || option.requests.length === 0} onClick={onSend}>
        {sending ? "Sending…" : "Send requests"}
      </Button>
    </section>
  );
}

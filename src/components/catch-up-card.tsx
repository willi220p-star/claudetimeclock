"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FormMessage } from "@/components/form-field";
import { errorText } from "@/lib/daymark";
import { coversLine, type CatchUpOption, type CatchUpPlan } from "@/lib/placement-ui";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function CatchUpCard({
  placementId,
  plan,
  onSent,
}: {
  placementId: string;
  plan: CatchUpPlan;
  onSent?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
    setOpen(false);
    onSent?.();
    router.push("/clock/requests");
  }

  if (plan.owed_minutes <= 0) return null;

  return (
    <>
      <section className="flex flex-col gap-3 rounded-xl bg-card p-6 shadow-card">
        <h2>Catch up</h2>
        <p className="text-muted-foreground">Two ways to pay down the hours you owe. The office checks both before they go through.</p>
        <Button type="button" onClick={() => setOpen(true)}>
          Catch up
        </Button>
      </section>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogTitle>Catch up</DialogTitle>
          <DialogDescription>Pick option A (longer days) or option B (extra days).</DialogDescription>
          <div className="grid gap-4 md:grid-cols-2">
            <OptionBlock title="Option A" option={plan.a} owed={plan.owed_minutes} busy={busy === "a"} disabled={busy !== null} onSend={() => void send("a")} />
            <OptionBlock title="Option B" option={plan.b} owed={plan.owed_minutes} busy={busy === "b"} disabled={busy !== null} onSend={() => void send("b")} />
          </div>
          {error ? <FormMessage>{error}</FormMessage> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function OptionBlock({
  title,
  option,
  owed,
  busy,
  disabled,
  onSend,
}: {
  title: string;
  option: CatchUpOption;
  owed: number;
  busy: boolean;
  disabled: boolean;
  onSend: () => void;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <h3 className="font-semibold">{title}</h3>
      {option.requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing available on this option right now.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {option.requests.map((item) => (
            <li key={item.label}>{item.label}</li>
          ))}
        </ul>
      )}
      <p className="text-sm font-semibold">{coversLine(option.covers_minutes, owed)}</p>
      {!option.fully_covers && option.requests.length > 0 ? (
        <p className="text-sm text-muted-foreground">This doesn&apos;t cover the whole balance.</p>
      ) : null}
      <Button type="button" disabled={disabled || option.requests.length === 0} onClick={onSend}>
        {busy ? "Sending…" : "Send requests"}
      </Button>
    </section>
  );
}

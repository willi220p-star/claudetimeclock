"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";

/** Me (D42): the 4-6 digit PIN for the office tablet. Never shown back: setting it again replaces it. */
export function KioskPinCard() {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("set_kiosk_pin", { pin });
    setBusy(false);
    if (error) {
      setError(errorText(error, "The PIN didn't save. Try again."));
      return;
    }
    setPin("");
    toast.success("Kiosk PIN saved. You can clock on the office tablet now.");
  }

  return (
    <form
      aria-labelledby="kiosk-pin"
      className="flex flex-col gap-3 rounded-xl bg-card p-6 shadow-card"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2 id="kiosk-pin">Kiosk PIN</h2>
      <p className="text-muted-foreground">
        For the office tablet when your phone isn&apos;t handy. Pick 4 to 6 digits you don&apos;t use elsewhere.
      </p>
      <div className="flex flex-col gap-1">
        <Label htmlFor="kiosk-pin-input">New PIN</Label>
        <Input
          id="kiosk-pin-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          className="w-40"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
      </div>
      {error ? <FormMessage>{error}</FormMessage> : null}
      <Button type="submit" className="w-fit" disabled={busy || pin.length < 4}>
        {busy ? "Saving…" : "Save PIN"}
      </Button>
    </form>
  );
}

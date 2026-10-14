"use client";

import { useState } from "react";
import { toast } from "sonner";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

async function loadMyEmailSetting() {
  const { data, error } = await createClient().rpc("my_email_setting");
  if (error) throw error;
  return data !== false;
}

/** "Email me notifications" (D50): the person's own opt-out, on Me (interns) and Notifications (staff). */
export function EmailToggle() {
  const [state] = useLoad(loadMyEmailSetting);
  const [override, setOverride] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const on = override ?? (state.status === "ready" ? state.data : false);

  async function change(next: boolean) {
    setOverride(next);
    setBusy(true);
    const { error } = await createClient().rpc("set_my_email", { enabled: next });
    setBusy(false);
    if (error) {
      setOverride(!next);
      toast.error(errorText(error, "That didn't save. Try again."));
      return;
    }
    toast.success(next ? "Emails are on." : "Emails are off.");
  }

  return (
    <section aria-labelledby="email-me-title" className="flex flex-col gap-3 rounded-xl bg-card p-6 shadow-card">
      <h2 id="email-me-title">Emails</h2>
      <label className="flex min-h-11 items-start gap-3">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          disabled={busy || state.status !== "ready"}
          onChange={(event) => void change(event.target.checked)}
          aria-describedby="email-me-hint"
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <span className="flex flex-col">
          <span className="font-medium">Email me notifications</span>
          <span id="email-me-hint" className="text-sm text-muted-foreground">
            Copies of important notifications by email. You&apos;ll still see everything in the app.
          </span>
        </span>
      </label>
      {state.status === "error" ? <p className="text-sm text-muted-foreground">{state.message}</p> : null}
    </section>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { StatusChip } from "@/components/status-chip";
import { Button, buttonVariants } from "@/components/ui/button";
import { rememberConsent } from "@/lib/browser-session";
import type { ConsentPurpose } from "@/lib/consent";
import { errorText, type Consent } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";

const ROWS: Array<{ purpose: ConsentPurpose; label: string; withdrawn: string }> = [
  { purpose: "location", label: "Location when you clock", withdrawn: "Location withdrawn." },
  { purpose: "selfie", label: "Selfie when you clock", withdrawn: "Selfie withdrawn." },
];

/**
 * Security review §2.3: each consent can be withdrawn on its own, at any time. Both are needed to
 * clock (Dilip, 5 Oct), so withdrawing asks once before it saves. Lives on the Me tab.
 */
export function PrivacyCard({ consent, onChange }: { consent: Consent; onChange: (consent: Consent) => void }) {
  const [pending, setPending] = useState<ConsentPurpose | null>(null);
  const [confirming, setConfirming] = useState<ConsentPurpose | null>(null);

  async function withdraw(purpose: ConsentPurpose, done: string) {
    setPending(purpose);
    const { data, error } = await createClient().rpc("record_consent", { purpose, decision: "withdrawn" });
    setPending(null);
    setConfirming(null);
    if (error) {
      toast.error(errorText(error, "That didn't save. Try again."));
      return;
    }
    rememberConsent(data as Consent);
    onChange(data as Consent);
    toast.success(`${done} You can't clock until you allow it again.`);
  }

  return (
    <section aria-labelledby="privacy-title" className="flex flex-col gap-4 rounded-xl bg-card p-6 shadow-card">
      <div className="flex flex-col gap-1">
        <h2 id="privacy-title">Privacy</h2>
        <p className="text-sm text-muted-foreground">Without both, you can&apos;t clock in or out.</p>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {ROWS.map(({ purpose, label, withdrawn }) => {
          const granted = consent[purpose] === "granted";
          return (
            <li key={purpose} className="flex flex-col gap-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <p className="font-semibold">{label}</p>
                  <StatusChip tone={granted ? "ok" : "neutral"} label={granted ? "Allowed" : "Not allowed"} />
                </div>
                {granted ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending !== null}
                    aria-expanded={confirming === purpose}
                    onClick={() => setConfirming(purpose)}
                  >
                    Withdraw
                  </Button>
                ) : (
                  // Agreeing again goes through the full consent wording on the notice page.
                  <Link href="/consent" className={buttonVariants({ variant: "ghost" })}>
                    Review and allow
                  </Link>
                )}
              </div>
              {confirming === purpose ? (
                <div role="alertdialog" aria-label={`Withdraw ${label.toLowerCase()}?`} className="flex flex-col gap-2 rounded-lg bg-warn-bg p-3">
                  <p className="text-sm">This stops you clocking until you allow it again.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="destructive" disabled={pending !== null} onClick={() => void withdraw(purpose, withdrawn)}>
                      {pending === purpose ? "Saving…" : "Withdraw"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setConfirming(null)}>
                      Keep it
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Link href="/consent" className="inline-flex min-h-11 w-fit items-center text-sm font-semibold text-primary">
        Read the collection notice
      </Link>
    </section>
  );
}

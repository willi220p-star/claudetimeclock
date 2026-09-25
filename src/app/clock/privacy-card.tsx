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

/** Security review §2.3: each consent can be withdrawn on its own, at any time, in one tap. */
export function PrivacyCard({ consent, onChange }: { consent: Consent; onChange: (consent: Consent) => void }) {
  const [pending, setPending] = useState<ConsentPurpose | null>(null);

  async function withdraw(purpose: ConsentPurpose, done: string) {
    setPending(purpose);
    const { data, error } = await createClient().rpc("record_consent", { purpose, decision: "withdrawn" });
    setPending(null);
    if (error) {
      toast.error(errorText(error, "That didn't save. Try again."));
      return;
    }
    rememberConsent(data as Consent);
    onChange(data as Consent);
    toast.success(done);
  }

  return (
    <section aria-labelledby="privacy-title" className="flex flex-col gap-4 rounded-xl bg-card p-6 shadow-card">
      <div className="flex flex-col gap-1">
        <h2 id="privacy-title">Privacy</h2>
        <p className="text-sm text-muted-foreground">
          Change these any time. Without both, your supervisor confirms you&apos;re at the office instead.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {ROWS.map(({ purpose, label, withdrawn }) => {
          const granted = consent[purpose] === "granted";
          return (
            <li key={purpose} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex flex-col gap-1">
                <p className="font-semibold">{label}</p>
                <StatusChip tone={granted ? "ok" : "neutral"} label={granted ? "Allowed" : "Not allowed"} />
              </div>
              {granted ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending !== null}
                  onClick={() => withdraw(purpose, `${withdrawn} Your supervisor will confirm you instead.`)}
                >
                  {pending === purpose ? "Saving…" : "Withdraw"}
                </Button>
              ) : (
                // Agreeing again goes through the full consent wording on the notice page.
                <Link href="/consent" className={buttonVariants({ variant: "ghost" })}>
                  Review and allow
                </Link>
              )}
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

"use client";

import { use, useCallback, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AppHeader } from "@/components/app-header";
import { DeskGate } from "@/components/desk-gate";
import { FormMessage } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { rememberConsent, sessionConsent } from "@/lib/browser-session";
import {
  canClockWithApp,
  choiceOf,
  decisionFor,
  needsConsentScreen,
  parseNotice,
  type ConsentChoice,
  type ConsentPurpose,
} from "@/lib/consent";
import { errorText, type Consent } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

// Security review §2.3: separate, unticked, individually withdrawable.
const CHOICES: Record<ConsentPurpose, { legend: string; text: string }> = {
  location: {
    legend: "Location",
    text: "I agree that DGK Clock may read my phone's GPS location only at the moment I tap Clock in or Clock out, to check I'm within 200 m of the DGK office. I understand it is not tracked at any other time, and that I can withdraw and use supervisor confirmation instead.",
  },
  selfie: {
    legend: "Selfie",
    text: "I agree that DGK Clock may take a live photo of me each time I clock in or out, stored privately and viewed only by my supervisor or the DGK admin to verify attendance. No facial recognition is used. I can withdraw and use supervisor confirmation instead.",
  },
};

export function ConsentScreen() {
  return (
    <DeskGate role="intern" consent={false}>
      {(profile) => (
        <>
          <AppHeader profile={profile} role="intern" title="Collection notice" />
          <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
            <ConsentForm />
          </main>
        </>
      )}
    </DeskGate>
  );
}

async function loadNotice(version: string) {
  const { data, error } = await createClient()
    .from("daymark_notices")
    .select("version, title, body, sha256")
    .eq("version", version)
    .single();
  if (error) throw error;
  return data;
}

type Errors = Partial<Record<"notice" | ConsentPurpose, string>>;

function ConsentForm() {
  const router = useRouter();
  const initial = use(sessionConsent());
  // The latest recorded state, so a retry after a partial save doesn't repeat a step.
  const saved = useRef<Consent>(initial);
  const load = useCallback(() => loadNotice(initial.notice_version), [initial.notice_version]);
  const [notice, reloadNotice] = useLoad(load);
  const [acknowledged, setAcknowledged] = useState(initial.notice_acknowledged);
  const [choices, setChoices] = useState<Record<ConsentPurpose, ConsentChoice | null>>({
    location: choiceOf(initial.location),
    selfie: choiceOf(initial.selfie),
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing: Errors = {};
    if (!acknowledged) missing.notice = "Tick this to show you've read the notice.";
    if (!choices.location) missing.location = "Choose Agree or No thanks for location.";
    if (!choices.selfie) missing.selfie = "Choose Agree or No thanks for the selfie.";
    setErrors(missing);
    setFormError(null);
    const first = (["notice", "location", "selfie"] as const).find((key) => missing[key]);
    if (first) {
      event.currentTarget.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const steps: Array<[string, string]> = [];
      if (!saved.current.notice_acknowledged) steps.push(["collection_notice", "acknowledged"]);
      for (const purpose of ["location", "selfie"] as const) {
        const decision = decisionFor(choices[purpose]!, saved.current[purpose]);
        if (decision) steps.push([purpose, decision]);
      }
      for (const [purpose, decision] of steps) {
        const { data, error } = await supabase.rpc("record_consent", { purpose, decision });
        if (error) throw error;
        saved.current = data as Consent;
      }
      rememberConsent(saved.current);
      toast.success(
        canClockWithApp(saved.current)
          ? "Thanks. You can clock in now."
          : "Thanks. Your supervisor will confirm you're at the office when you arrive.",
      );
      router.replace("/clock");
    } catch (error) {
      setFormError(errorText(error, "Your choices didn't save. Try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Before you clock in"
        description="Read how DGK Clock handles your information, then choose how you'd like to clock in. You can change your mind at any time."
      />

      <section aria-labelledby="notice-title" className="rounded-xl bg-card p-6 shadow-card">
        {notice.status === "loading" ? (
          <div role="status" className="flex flex-col gap-3">
            <span className="sr-only">Loading the collection notice…</span>
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : notice.status === "error" ? (
          <div className="flex flex-col items-start gap-3">
            <FormMessage>{notice.message}</FormMessage>
            <Button type="button" variant="secondary" onClick={reloadNotice}>
              Try again
            </Button>
          </div>
        ) : (
          <article className="flex flex-col gap-3">
            <h2 id="notice-title">{notice.data.title}</h2>
            <p className="caption text-muted-foreground">Version {notice.data.version}</p>
            {parseNotice(notice.data.body).map((block, index) =>
              block.kind === "heading" ? (
                <h3 key={index} className="mt-2 font-semibold">
                  {block.text}
                </h3>
              ) : block.kind === "list" ? (
                <ul key={index} className="flex list-disc flex-col gap-1.5 pl-5">
                  {block.items.map((item, itemIndex) => (
                    <li key={itemIndex}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p key={index}>{block.text}</p>
              ),
            )}
          </article>
        )}
      </section>

      {notice.status === "ready" ? (
        <form method="post" noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className="flex min-h-11 items-start gap-3 rounded-lg bg-card p-4 shadow-card">
              <input
                type="checkbox"
                name="notice"
                checked={acknowledged}
                disabled={initial.notice_acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                aria-describedby={errors.notice ? "notice-error" : undefined}
                aria-invalid={errors.notice ? true : undefined}
                className="mt-0.5 size-5 shrink-0 accent-primary"
              />
              <span className="font-semibold">I have read the collection notice (v{notice.data.version})</span>
            </label>
            {errors.notice ? (
              <p id="notice-error" className="text-sm font-medium text-bad">
                {errors.notice}
              </p>
            ) : null}
          </div>

          {(["location", "selfie"] as const).map((purpose) => (
            <fieldset
              key={purpose}
              aria-describedby={[`${purpose}-text`, errors[purpose] ? `${purpose}-error` : null].filter(Boolean).join(" ")}
              className="flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card"
            >
              <legend className="float-left mb-1 font-semibold">{CHOICES[purpose].legend}</legend>
              <p id={`${purpose}-text`} className="clear-left text-sm text-muted-foreground">
                {CHOICES[purpose].text}
              </p>
              {(
                [
                  ["agree", "Agree"],
                  ["decline", "No thanks — my supervisor will confirm me"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex min-h-11 items-center gap-3">
                  <input
                    type="radio"
                    name={purpose}
                    value={value}
                    checked={choices[purpose] === value}
                    onChange={() => setChoices((all) => ({ ...all, [purpose]: value }))}
                    className="size-5 shrink-0 accent-primary"
                  />
                  <span>{label}</span>
                </label>
              ))}
              {errors[purpose] ? (
                <p id={`${purpose}-error`} className="text-sm font-medium text-bad">
                  {errors[purpose]}
                </p>
              ) : null}
            </fieldset>
          ))}

          {formError ? <FormMessage>{formError}</FormMessage> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save my choices"}
            </Button>
            {!needsConsentScreen(initial) ? (
              <Link href="/clock" className={buttonVariants({ variant: "ghost" })}>
                Back to clock
              </Link>
            ) : null}
          </div>
        </form>
      ) : null}
    </>
  );
}

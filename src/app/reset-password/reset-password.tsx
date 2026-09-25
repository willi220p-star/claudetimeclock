"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { toast } from "sonner";
import type { z } from "zod";
import { AuthShell } from "@/components/auth-shell";
import { FormField, FormMessage } from "@/components/form-field";
import { NewPasswordForm } from "@/components/new-password-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { clearSessionCache, sessionProfile } from "@/lib/browser-session";
import { homeFor } from "@/lib/roles";
import { resetRequestSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/client";

// §11.2 / §14: always the same words, whether or not the email has a login.
const NEUTRAL = "If that email has a DGK Clock login, we've sent a reset link.";

type Mode = "checking" | "request" | "expired" | "set";

export function ResetPassword() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("checking");

  useEffect(() => {
    // Read the link's fragment before the client consumes it (implicit flow).
    const hash = window.location.hash;
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("set");
    });
    supabase.auth.getSession().then(({ data: session }) => {
      setMode((current) => {
        if (current === "set") return current;
        if (/type=recovery/.test(hash) && session.session) return "set";
        return /error/.test(hash) ? "expired" : "request";
      });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (mode === "set") {
    return (
      <AuthShell title="Choose a new password" intro="You're signed in from the reset link. Pick a password you haven't used here before.">
        <NewPasswordForm
          onDone={async () => {
            clearSessionCache();
            const profile = await sessionProfile().catch(() => null);
            toast.success("Password saved.");
            router.replace((profile && homeFor(profile)) || "/");
          }}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      intro="Enter the email you sign in with. We'll email you a link to choose a new password."
    >
      {mode === "checking" ? (
        <div role="status" className="flex flex-col gap-4">
          <span className="sr-only">Opening the reset link…</span>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full rounded-[1584px]" />
        </div>
      ) : (
        <RequestForm expired={mode === "expired"} />
      )}
    </AuthShell>
  );
}

type ResetRequest = z.infer<typeof resetRequestSchema>;

function RequestForm({ expired }: { expired: boolean }) {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetRequest>({ resolver: zodResolver(resetRequestSchema), defaultValues: { email: "" } });

  async function onSubmit({ email }: ResetRequest) {
    setFormError(null);
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${base}/reset-password/`,
    });
    // Only a failed connection is worth saying; every server answer gets the neutral message.
    if (error && isAuthRetryableFetchError(error)) {
      setFormError("We couldn't reach DGK Clock. Check your connection and try again.");
      return;
    }
    setSent(true);
  }

  return (
    <form method="post" noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      {expired && !sent ? (
        <FormMessage>That reset link has expired or was already used. Ask for a new one below.</FormMessage>
      ) : null}
      <FormField id="reset-email" label="Email" error={errors.email?.message}>
        {(field) => (
          <Input
            {...field}
            {...register("email")}
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="email"
          />
        )}
      </FormField>
      {sent ? <FormMessage tone="ok">{NEUTRAL} Open it on this device to choose a new password.</FormMessage> : null}
      {formError ? <FormMessage>{formError}</FormMessage> : null}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Sending…" : sent ? "Send another link" : "Send reset link"}
      </Button>
      <Link href="/" className="inline-flex min-h-11 items-center self-center text-sm font-semibold text-primary">
        Back to sign in
      </Link>
    </form>
  );
}

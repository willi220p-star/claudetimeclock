"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { isAuthApiError, isAuthRetryableFetchError } from "@supabase/supabase-js";
import type { z } from "zod";
import { FormField, FormMessage, PasswordInput } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clearSessionCache, leaveSignOutNotice, readSignOutNotice, sessionProfile } from "@/lib/browser-session";
import { errorText } from "@/lib/daymark";
import { homeFor } from "@/lib/roles";
import { signInSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/client";

type SignIn = z.infer<typeof signInSchema>;

const noop = () => () => {};

function signInMessage(error: unknown) {
  if (isAuthRetryableFetchError(error)) return "We couldn't reach DGK Clock. Check your connection and try again.";
  if (isAuthApiError(error) && error.status === 429) return "Too many tries. Wait a minute, then try again.";
  if (isAuthApiError(error) && error.status === 400) {
    // Neutral on purpose: never say whether the email has a login.
    return "That email and password don't match. Check them and try again, or reset your password.";
  }
  return errorText(error, "Signing in didn't work. Try again.");
}

export function LoginForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  // "You were signed out after 30 minutes of inactivity." left by the idle sign-out.
  const notice = useSyncExternalStore(noop, readSignOutNotice, () => null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignIn>({ resolver: zodResolver(signInSchema), defaultValues: { email: "", password: "" } });

  // Already signed in: go straight to the right desk.
  useEffect(() => {
    sessionProfile()
      .then((profile) => {
        const home = profile && homeFor(profile);
        if (home) router.replace(home);
      })
      .catch(() => {});
  }, [router]);

  async function onSubmit(values: SignIn) {
    setFormError(null);
    leaveSignOutNotice(null);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.signInWithPassword(values);
      if (error) throw error;
      clearSessionCache();
      const profile = await sessionProfile();
      const home = profile && homeFor(profile);
      if (!home) {
        await supabase.auth.signOut({ scope: "local" });
        clearSessionCache();
        setFormError(
          profile
            ? "Your login doesn't have a role yet. Ask the DGK admin to set one up."
            : "This login is paused or not set up in DGK Clock. Ask the DGK admin to check it.",
        );
        return;
      }
      router.replace(home);
    } catch (error) {
      setFormError(signInMessage(error));
    }
  }

  return (
    <form method="post" noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      {notice ? (
        <p role="status" className="rounded-xl bg-muted p-4 text-sm">
          {notice}
        </p>
      ) : null}
      <FormField id="email" label="Email" error={errors.email?.message}>
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
      <FormField id="password" label="Password" error={errors.password?.message}>
        {(field) => <PasswordInput {...field} {...register("password")} autoComplete="current-password" />}
      </FormField>
      {formError ? <FormMessage>{formError}</FormMessage> : null}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
      <Link href="/reset-password" className="inline-flex min-h-11 items-center self-center text-sm font-semibold text-primary">
        Forgot your password?
      </Link>
    </form>
  );
}

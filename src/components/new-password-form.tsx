"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { FormField, FormMessage, PasswordInput } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/daymark";
import { newPasswordSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/client";

type NewPassword = z.infer<typeof newPasswordSchema>;

/**
 * Sets the signed-in person's own password (reset link or first sign-in). A database trigger
 * clears must_change_password when it changes.
 */
export function NewPasswordForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NewPassword>({ resolver: zodResolver(newPasswordSchema), defaultValues: { password: "", confirm: "" } });

  async function onSubmit({ password }: NewPassword) {
    setFormError(null);
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      setFormError(errorText(error, "Your password didn't save. Try again."));
      return;
    }
    await onDone();
  }

  return (
    <form method="post" noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <FormField
        id="new-password"
        label="New password"
        hint="12 to 72 characters. A short phrase is easy to remember."
        error={errors.password?.message}
      >
        {(field) => <PasswordInput {...field} {...register("password")} autoComplete="new-password" />}
      </FormField>
      <FormField id="confirm-password" label="Type it again" error={errors.confirm?.message}>
        {(field) => <PasswordInput {...field} {...register("confirm")} autoComplete="new-password" />}
      </FormField>
      {formError ? <FormMessage>{formError}</FormMessage> : null}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}

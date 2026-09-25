"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import { FormField, FormMessage, PasswordInput } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorText } from "@/lib/daymark";
import { ROLE_LABEL } from "@/lib/roles";
import { personSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/client";

type NewPerson = z.infer<typeof personSchema>;

const ROLE_FIELDS = [
  ["is_intern", ROLE_LABEL.intern],
  ["is_supervisor", ROLE_LABEL.supervisor],
  ["is_admin", ROLE_LABEL.admin],
] as const;

/** The temporary password is sent once to the database, then cleared. It's never shown again. */
export function AddPersonForm({ onAdded }: { onAdded: () => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<NewPerson>({
    resolver: zodResolver(personSchema),
    defaultValues: { display_name: "", email: "", password: "", is_intern: true, is_supervisor: false, is_admin: false },
  });

  async function onSubmit(values: NewPerson) {
    setFormError(null);
    const { error } = await createClient().rpc("create_person", values);
    if (error) {
      setFormError(errorText(error, "That person wasn't added. Try again."));
      return;
    }
    reset();
    toast.success(`${values.display_name} can sign in now. They'll choose their own password first.`);
    onAdded();
  }

  return (
    <section aria-labelledby="add-person-title" className="flex flex-col gap-4 rounded-xl bg-card p-6 shadow-card">
      <div className="flex flex-col gap-1">
        <h2 id="add-person-title">Add a person</h2>
        <p className="text-sm text-muted-foreground">
          Give them the temporary password yourself. They choose their own when they first sign in.
        </p>
      </div>
      <form method="post" noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField id="person-name" label="Name" error={errors.display_name?.message}>
          {(field) => <Input {...field} {...register("display_name")} autoComplete="off" />}
        </FormField>
        <FormField id="person-email" label="Email" error={errors.email?.message}>
          {(field) => (
            <Input
              {...field}
              {...register("email")}
              type="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          )}
        </FormField>
        <FormField
          id="person-password"
          label="Temporary password"
          hint="12 to 72 characters. You won't see it again after you add them."
          error={errors.password?.message}
        >
          {(field) => <PasswordInput {...field} {...register("password")} autoComplete="new-password" />}
        </FormField>
        <fieldset
          className="flex flex-col gap-1"
          aria-describedby={errors.is_intern ? "person-roles-error" : undefined}
        >
          <legend className="mb-1 text-sm font-medium">Roles</legend>
          <div className="flex flex-wrap gap-x-5">
            {ROLE_FIELDS.map(([name, label]) => (
              <label key={name} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" {...register(name)} className="size-5 accent-primary" />
                {label}
              </label>
            ))}
          </div>
          {errors.is_intern ? (
            <p id="person-roles-error" className="text-sm font-medium text-bad">
              {errors.is_intern.message}
            </p>
          ) : null}
        </fieldset>
        {formError ? <FormMessage>{formError}</FormMessage> : null}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Adding…" : "Add person"}
        </Button>
      </form>
    </section>
  );
}

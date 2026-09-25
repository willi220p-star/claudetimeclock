"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import { FormField, FormMessage, PasswordInput } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { errorText, type Profile } from "@/lib/daymark";
import { emailSchema, setPasswordSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/client";

export type PersonDialog = { kind: "password" | "email" | "deactivate"; person: Profile } | null;

export function PersonDialogs({
  dialog,
  onClose,
  onSaved,
  onDeactivate,
}: {
  dialog: PersonDialog;
  onClose: () => void;
  onSaved: () => void;
  onDeactivate: (person: Profile) => Promise<void>;
}) {
  return (
    <Dialog
      open={dialog !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        {dialog?.kind === "password" ? (
          <SetPassword person={dialog.person} onDone={onSaved} />
        ) : dialog?.kind === "email" ? (
          <ChangeEmail person={dialog.person} onDone={onSaved} />
        ) : dialog?.kind === "deactivate" ? (
          <Deactivate person={dialog.person} onCancel={onClose} onConfirm={onDeactivate} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Write-only (§14): the password goes to the database and is never shown or kept here. */
function SetPassword({ person, onDone }: { person: Profile; onDone: () => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof setPasswordSchema>>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { password: "" },
  });

  async function onSubmit({ password }: z.infer<typeof setPasswordSchema>) {
    setFormError(null);
    const { error } = await createClient().rpc("set_person_password", { target_id: person.id, password });
    if (error) {
      setFormError(errorText(error, "The password didn't save. Try again."));
      return;
    }
    toast.success(`New password set for ${person.display_name}. They'll choose their own when they sign in.`);
    onDone();
  }

  return (
    <>
      <DialogTitle>Set a password for {person.display_name}</DialogTitle>
      <DialogDescription>
        They&apos;re signed out everywhere and choose their own password when they next sign in. You won&apos;t see this
        password again.
      </DialogDescription>
      <form method="post" noValidate onSubmit={handleSubmit(onSubmit)} className="mt-4 flex flex-col gap-4">
        <FormField id="set-password" label="Temporary password" hint="12 to 72 characters." error={errors.password?.message}>
          {(field) => <PasswordInput {...field} {...register("password")} autoComplete="new-password" />}
        </FormField>
        {formError ? <FormMessage>{formError}</FormMessage> : null}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Set password"}
        </Button>
      </form>
    </>
  );
}

function ChangeEmail({ person, onDone }: { person: Profile; onDone: () => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: person.contact_email ?? "" },
  });

  async function onSubmit({ email }: z.infer<typeof emailSchema>) {
    setFormError(null);
    const { error } = await createClient().rpc("set_person_email", { target_id: person.id, email });
    if (error) {
      setFormError(errorText(error, "The email didn't save. Try again."));
      return;
    }
    toast.success(`${person.display_name} now signs in with ${email}.`);
    onDone();
  }

  return (
    <>
      <DialogTitle>Change {person.display_name}&apos;s email</DialogTitle>
      <DialogDescription>They sign in and get password reset links at this email.</DialogDescription>
      <form method="post" noValidate onSubmit={handleSubmit(onSubmit)} className="mt-4 flex flex-col gap-4">
        <FormField id="change-email" label="Email" error={errors.email?.message}>
          {(field) => (
            <Input {...field} {...register("email")} type="email" autoComplete="off" autoCapitalize="none" spellCheck={false} />
          )}
        </FormField>
        {formError ? <FormMessage>{formError}</FormMessage> : null}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save email"}
        </Button>
      </form>
    </>
  );
}

function Deactivate({
  person,
  onCancel,
  onConfirm,
}: {
  person: Profile;
  onCancel: () => void;
  onConfirm: (person: Profile) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  return (
    <>
      <DialogTitle>Deactivate {person.display_name}?</DialogTitle>
      <DialogDescription>
        They&apos;re signed out now and can&apos;t sign in until you reactivate them. Their records stay.
      </DialogDescription>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Keep active
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            await onConfirm(person);
            setPending(false);
          }}
        >
          {pending ? "Deactivating…" : "Deactivate"}
        </Button>
      </div>
    </>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FormField, FormMessage } from "@/components/form-field";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { CERT_ACCEPT, addCertificate, certificateFileError } from "@/lib/certificates";
import { errorText } from "@/lib/daymark";

/** "Add certificate (optional)" on the intern's own pending leave request: consent, file, upload. */
export function CertificateUpload({
  requestId,
  internId,
  attached,
  retentionDays = 7,
  onAdded,
}: {
  requestId: string;
  internId: string;
  attached: boolean;
  retentionDays?: number;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `cert-${requestId}`;

  if (attached) return <StatusChip tone="ok" label="Certificate added" />;
  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setOpen(true)}>
        Add certificate (optional)
      </Button>
    );
  }

  async function submit() {
    setError(null);
    const problem = certificateFileError(file);
    if (problem || !file) {
      setFileError(problem ?? undefined);
      return;
    }
    setBusy(true);
    try {
      await addCertificate(requestId, internId, file);
      toast.success("Certificate added.");
      onAdded();
    } catch (fail) {
      setError(errorText(fail, "The certificate didn't upload. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="Add a medical certificate"
      className="flex flex-col gap-3 rounded-xl bg-muted p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm">
        A medical certificate is health information. Only your supervisor and the DGK admin can see it. It is deleted{" "}
        {retentionDays} {retentionDays === 1 ? "day" : "days"} after your request is decided.
      </p>
      <label htmlFor={`${id}-agree`} className="flex min-h-11 items-start gap-3 text-sm font-medium">
        <input
          id={`${id}-agree`}
          type="checkbox"
          className="mt-0.5 size-5 shrink-0 accent-primary"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
        />
        I agree to DGK keeping my certificate this way.
      </label>
      <FormField id={`${id}-file`} label="Certificate" hint="PDF, JPG or PNG, up to 5 MB." error={fileError}>
        {(input) => (
          <input
            {...input}
            type="file"
            accept={CERT_ACCEPT}
            disabled={!agreed}
            className="min-h-11 text-sm file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-card file:px-4 file:font-semibold file:text-primary disabled:opacity-50"
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              setFile(next);
              setFileError(next ? (certificateFileError(next) ?? undefined) : undefined);
            }}
          />
        )}
      </FormField>
      {error ? <FormMessage>{error}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!agreed || !file || Boolean(fileError) || busy}>
          {busy ? "Uploading…" : "Upload certificate"}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

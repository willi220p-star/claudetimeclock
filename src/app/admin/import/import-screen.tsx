"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AdminFrame } from "@/app/admin/admin-frame";
import { FormField, FormMessage, PasswordInput } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";

const COLUMNS = [
  "display_name",
  "email",
  "university",
  "course",
  "start_date",
  "planned_end_date",
  "target_hours",
  "supervisor_email",
  "cohort",
  "pattern",
] as const;

const TEMPLATE = `${COLUMNS.join(",")}
Ada Cole,ada@uni.test,CDU,BBus,2026-10-12,2026-12-18,120,sup1@dgk.test,Term 4 2026,Mon 09:00-17:00; Wed 09:00-17:00
`;

type Row = Record<(typeof COLUMNS)[number], string>;
type Verdict = { row: number; email: string; ok: boolean; error?: string };
type ImportResult = { ok: boolean; dry_run: boolean; imported: number; results: Verdict[] };

function parseCsv(text: string): { rows: Row[]; error?: string } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return { rows: [], error: "The file needs a header and at least one row." };
  const header = lines[0].split(",").map((cell) => cell.trim().toLowerCase());
  const missing = COLUMNS.filter((col) => !header.includes(col));
  if (missing.length) return { rows: [], error: `Missing columns: ${missing.join(", ")}.` };
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",").map((cell) => cell.trim());
    const row = {} as Row;
    for (const col of COLUMNS) row[col] = cells[header.indexOf(col)] ?? "";
    return row;
  });
  return { rows };
}

function downloadTemplate() {
  const blob = new Blob([TEMPLATE], { type: "text/csv" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = "placements-template.csv";
  link.click();
  URL.revokeObjectURL(href);
}

export function ImportScreen() {
  return (
    <AdminFrame title="Import">
      <ImportDesk />
    </AdminFrame>
  );
}

function ImportDesk() {
  const [rows, setRows] = useState<Row[]>([]);
  const [password, setPassword] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<"dry" | "import" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function onFile(file: File | undefined) {
    setResult(null);
    setFileError(null);
    if (!file) {
      setRows([]);
      return;
    }
    void file.text().then((text) => {
      const parsed = parseCsv(text);
      if (parsed.error) {
        setRows([]);
        setFileError(parsed.error);
        return;
      }
      setRows(parsed.rows);
    });
  }

  async function run(dryRun: boolean) {
    setFormError(null);
    if (rows.length === 0) {
      setFormError("Choose a CSV first.");
      return;
    }
    if (password.length < 12) {
      setFormError("Use a temporary password of at least 12 characters.");
      return;
    }
    setBusy(dryRun ? "dry" : "import");
    const { data, error } = await createClient().rpc("import_placements", {
      rows,
      temp_password: password,
      dry_run: dryRun,
    });
    setBusy(null);
    if (error) {
      setFormError(errorText(error, "The import didn't run. Try again."));
      return;
    }
    const next = data as ImportResult;
    setResult(next);
    if (!dryRun && next.ok) {
      setPassword("");
      toast.success(`Imported ${next.imported} row${next.imported === 1 ? "" : "s"}. The temporary password won't be shown again.`);
    }
  }

  const readyCount = result?.dry_run && result.ok ? result.results.length : 0;

  return (
    <>
      <PageHeader
        title="Import placements"
        description="Upload a CSV, dry-run it, then import. One temporary password for the batch — it is never stored or shown again."
        actions={
          <Button type="button" variant="secondary" onClick={downloadTemplate}>
            Download template
          </Button>
        }
      />
      <form className="flex flex-col gap-4 rounded-xl bg-card p-6 shadow-card" onSubmit={(e) => e.preventDefault()}>
        <FormField id="import-file" label="CSV file" hint="Columns: display_name, email, university, course, start_date, planned_end_date, target_hours, supervisor_email, cohort, pattern. Pattern like Mon 09:00-17:00; Wed 09:00-17:00.">
          {(field) => (
            <input
              {...field}
              type="file"
              accept=".csv,text/csv"
              className="h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
              onChange={(event) => onFile(event.target.files?.[0])}
            />
          )}
        </FormField>
        <FormField
          id="import-password"
          label="Temporary password"
          hint="12 to 72 characters. Interns choose their own at first sign-in. You won't see this again."
        >
          {(field) => (
            <PasswordInput
              {...field}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          )}
        </FormField>
        {fileError ? <FormMessage>{fileError}</FormMessage> : null}
        {formError ? <FormMessage>{formError}</FormMessage> : null}
        <p className="text-sm text-muted-foreground">{rows.length ? `${rows.length} row${rows.length === 1 ? "" : "s"} ready.` : "No file chosen yet."}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={busy !== null || rows.length === 0} onClick={() => void run(true)}>
            {busy === "dry" ? "Checking…" : "Dry run"}
          </Button>
          <Button type="button" disabled={busy !== null || readyCount === 0} onClick={() => void run(false)}>
            {busy === "import" ? "Importing…" : `Import ${readyCount || rows.length} row${(readyCount || rows.length) === 1 ? "" : "s"}`}
          </Button>
        </div>
      </form>
      {result ? (
        <section aria-labelledby="import-results" className="flex flex-col gap-3">
          <h2 id="import-results">{result.dry_run ? "Dry run" : "Import"} results</h2>
          <p className="text-sm text-muted-foreground">
            {result.ok ? (result.dry_run ? "Every row looks good." : `Imported ${result.imported} rows.`) : "Nothing was written. Fix the rows marked below."}
          </p>
          <ul className="flex flex-col gap-2">
            {result.results.map((row) => (
              <li key={`${row.row}-${row.email}`} className="flex flex-col gap-1 rounded-lg bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">
                    Row {row.row} · {row.email || "no email"}
                  </p>
                  {row.error ? <p className="text-sm text-bad">{row.error}</p> : null}
                </div>
                <StatusChip tone={row.ok ? "ok" : "bad"} label={row.ok ? "Ready" : "Error"} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

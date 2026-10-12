"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { darwinDateKey } from "@/lib/darwin";
import { errorText } from "@/lib/daymark";
import { addDays, lastWeekStart } from "@/lib/periods";
import { createClient } from "@/lib/supabase/client";
import { exportCsv } from "@/lib/timesheet-csv";

/** Admin only (D43): signed hours for a date range as a CSV, defaulting to the last full fortnight. */
export function TimesheetExport() {
  const [from, setFrom] = useState(() => addDays(lastWeekStart(darwinDateKey(new Date())), -7));
  const [to, setTo] = useState(() => addDays(from, 13));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "bad" | "ok"; text: string } | null>(null);

  async function download() {
    setMessage(null);
    setBusy(true);
    const { data, error } = await createClient().rpc("signoff_export", { from_date: from, to_date: to });
    setBusy(false);
    if (error) {
      setMessage({ tone: "bad", text: errorText(error, "The export didn't run. Try again.") });
      return;
    }
    if (!data?.length) {
      setMessage({ tone: "ok", text: "No signed weeks in that range." });
      return;
    }
    const url = URL.createObjectURL(new Blob([exportCsv(data)], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: `dgk-hours-${from}-to-${to}.csv` }).click();
    URL.revokeObjectURL(url);
    toast.success(`${data.length} signed days exported.`);
  }

  return (
    <section aria-labelledby="export-title" className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card">
      <h2 id="export-title" className="text-[17px] font-semibold">
        Export signed hours
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <FormField id="export-from" label="From">
          {(input) => <Input {...input} type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />}
        </FormField>
        <FormField id="export-to" label="To">
          {(input) => <Input {...input} type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />}
        </FormField>
        <Button type="button" disabled={busy || !from || !to || from > to} onClick={() => void download()}>
          <Download aria-hidden className="size-4" />
          Export CSV
        </Button>
      </div>
      {message ? <FormMessage tone={message.tone}>{message.text}</FormMessage> : null}
    </section>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AdminFrame } from "@/app/admin/admin-frame";
import { FormField, FormMessage } from "@/components/form-field";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadCohorts } from "@/lib/data";
import { errorText } from "@/lib/daymark";
import { formatDay } from "@/lib/darwin";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

type Cohort = Awaited<ReturnType<typeof loadCohorts>>[number];

export function CohortsScreen() {
  return (
    <AdminFrame title="Cohorts">
      <CohortsDesk />
    </AdminFrame>
  );
}

function CohortsDesk() {
  const [cohorts, reload] = useLoad(loadCohorts);
  const [editing, setEditing] = useState<Cohort | "new" | null>(null);

  return (
    <>
      <PageHeader
        title="Cohorts"
        description="Group placements by term or intake."
        actions={
          <Button type="button" onClick={() => setEditing("new")}>
            New cohort
          </Button>
        }
      />
      {editing ? (
        <CohortForm
          cohort={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
      <LoadBlock state={cohorts} reload={reload} empty="No cohorts yet. Add the first one." action={<Button type="button" onClick={() => setEditing("new")}>New cohort</Button>}>
        {(rows) => (
          <ul className="flex flex-col gap-2">
            {rows.map((cohort) => (
              <li key={cohort.id} className="flex flex-col gap-2 rounded-lg bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">{cohort.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {cohort.starts_on ? formatDay(cohort.starts_on) : "No start date"}
                    {cohort.notes ? ` · ${cohort.notes}` : ""}
                  </p>
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(cohort)}>
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        )}
      </LoadBlock>
    </>
  );
}

function CohortForm({
  cohort,
  onCancel,
  onSaved,
}: {
  cohort: Cohort | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(cohort?.name ?? "");
  const [notes, setNotes] = useState(cohort?.notes ?? "");
  const [startsOn, setStartsOn] = useState(cohort?.starts_on ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setBusy(true);
    const { error: fail } = await createClient().rpc("save_cohort", {
      id: (cohort?.id ?? null) as unknown as string,
      name,
      notes: notes || undefined,
      starts_on: startsOn || undefined,
    });
    setBusy(false);
    if (fail) {
      setError(errorText(fail, "That cohort didn't save. Try again."));
      return;
    }
    toast.success(cohort ? "Cohort saved." : "Cohort added.");
    onSaved();
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-xl bg-card p-6 shadow-card"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2>{cohort ? "Edit cohort" : "New cohort"}</h2>
      <FormField id="cohort-name" label="Name">
        {(field) => <Input {...field} value={name} onChange={(e) => setName(e.target.value)} />}
      </FormField>
      <FormField id="cohort-starts" label="Starts on">
        {(field) => <Input {...field} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}
      </FormField>
      <FormField id="cohort-notes" label="Notes">
        {(field) => <Input {...field} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </FormField>
      {error ? <FormMessage>{error}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || name.trim().length === 0}>
          {busy ? "Saving…" : "Save cohort"}
        </Button>
      </div>
    </form>
  );
}

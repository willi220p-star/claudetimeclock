"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { AdminFrame } from "@/app/admin/admin-frame";
import { FormMessage } from "@/components/form-field";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { LABEL_COLOURS, LABEL_COLOUR_KEYS, LabelDot, loadLabels, type LabelColour, type TaskLabel } from "@/components/tasks/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

/** Settings → Task labels (D49): one shared list; add, rename, recolour and archive. Admins only. */
export function LabelsScreen() {
  return (
    <AdminFrame title="Task labels">
      <LabelsDesk />
    </AdminFrame>
  );
}

function LabelsDesk() {
  const [state, reload] = useLoad(loadLabels);
  return (
    <>
      <PageHeader title="Task labels" description="Labels sort tasks across projects. Everyone sees the same list." />
      <LabelForm onSaved={reload} />
      <LoadBlock state={state} reload={reload} empty="No labels yet. Add one above, like Design or Urgent.">
        {(rows) => (
          <section aria-labelledby="labels-list" className="flex flex-col gap-1.5">
            <h2 id="labels-list" className="mx-1 text-[15px] font-semibold text-muted-foreground">
              Labels
            </h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card shadow-card">
              {rows.map((label) => (
                <LabelRow key={`${label.id}:${label.name}:${label.colour}`} label={label} onSaved={reload} />
              ))}
            </ul>
          </section>
        )}
      </LoadBlock>
    </>
  );
}

function ColourPicker({ value, onChange, name }: { value: string; onChange: (colour: LabelColour) => void; name: string }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">Colour</legend>
      <div className="flex flex-wrap gap-1">
        {LABEL_COLOUR_KEYS.map((colour) => (
          <label
            key={colour}
            className="grid size-11 cursor-pointer place-items-center rounded-full has-checked:bg-muted has-checked:ring-2 has-checked:ring-foreground has-focus-visible:outline-2 has-focus-visible:outline-ring"
          >
            <input type="radio" name={name} value={colour} checked={value === colour} onChange={() => onChange(colour)} className="sr-only" />
            <LabelDot colour={colour} className="size-5" />
            <span className="sr-only">{LABEL_COLOURS[colour].name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

async function saveLabel(id: string | null, name: string, colour: string) {
  return createClient().rpc("save_label", { id, name, colour } as { id: string; name: string; colour: string });
}

function LabelForm({ onSaved }: { onSaved: () => void }) {
  const id = useId();
  const [name, setName] = useState("");
  const [colour, setColour] = useState<LabelColour>("blue");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) return setError("Give the label a name.");
    setBusy(true);
    setError(null);
    const { error: fail } = await saveLabel(null, name.trim(), colour);
    setBusy(false);
    if (fail) return setError(errorText(fail, "The label didn't save. Try again."));
    toast.success("Label added.");
    setName("");
    onSaved();
  }

  return (
    <form
      aria-label="New label"
      className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <div className="flex flex-col gap-1 sm:max-w-sm">
        <Label htmlFor={`${id}-name`}>Label name</Label>
        <Input id={`${id}-name`} maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <ColourPicker value={colour} onChange={setColour} name={`${id}-colour`} />
      {error ? <FormMessage>{error}</FormMessage> : null}
      <Button type="submit" className="self-start" disabled={busy}>
        {busy ? "Adding…" : "Add label"}
      </Button>
    </form>
  );
}

function LabelRow({ label, onSaved }: { label: TaskLabel; onSaved: () => void }) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [colour, setColour] = useState(label.colour);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return setError("Give the label a name.");
    setBusy(true);
    setError(null);
    const { error: fail } = await saveLabel(label.id, name.trim(), colour);
    setBusy(false);
    if (fail) return setError(errorText(fail, "The label didn't save. Try again."));
    toast.success("Label saved.");
    setEditing(false);
    onSaved();
  }

  async function archive() {
    setBusy(true);
    const { error: fail } = await createClient().rpc("archive_label", { id: label.id });
    setBusy(false);
    if (fail) return toast.error(errorText(fail, "It didn't archive. Try again."));
    toast.success(`${label.name} archived. Tasks that had it keep their other labels.`);
    onSaved();
  }

  if (!editing)
    return (
      <li className="flex min-h-14 items-center gap-3 py-1.5 pr-2 pl-4">
        <LabelDot colour={label.colour} />
        <span className="min-w-0 flex-1 font-medium">{label.name}</span>
        <Button type="button" size="sm" variant="ghost" aria-label={`Edit ${label.name}`} onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button type="button" size="sm" variant="ghost" aria-label={`Archive ${label.name}`} disabled={busy} onClick={() => void archive()}>
          Archive
        </Button>
      </li>
    );
  return (
    <li className="p-4">
      <form
        aria-label={`Edit ${label.name}`}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-col gap-1 sm:max-w-sm">
          <Label htmlFor={`${id}-name`}>Label name</Label>
          <Input id={`${id}-name`} maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <ColourPicker value={colour} onChange={setColour} name={`${id}-colour`} />
        {error ? <FormMessage>{error}</FormMessage> : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save label"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </li>
  );
}

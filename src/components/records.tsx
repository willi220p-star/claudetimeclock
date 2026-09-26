"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/app/admin/confirm-dialog";
import { DeskGate } from "@/components/desk-gate";
import { StaffShell } from "@/components/desk-shell";
import { EmptyState } from "@/components/empty-state";
import { FormField, FormMessage } from "@/components/form-field";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { errorText, type Profile } from "@/lib/daymark";
import { selfieUrl } from "@/lib/punches";
import {
  changedPatch,
  columnLabel,
  displayValue,
  fileBatches,
  formatBytes,
  inputValue,
  rowKey,
  tablesFor,
  type Names,
  type RecordTable,
  type Row,
  type StoredFile,
} from "@/lib/records";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";

type Role = "admin" | "supervisor";
const PAGE = 50;

// ponytail: tables are addressed by name at runtime, so the typed client is loosened here only.
type LooseClient = {
  from: (table: string) => {
    select: (
      columns: string,
      options?: { count?: "exact"; head?: boolean },
    ) => PromiseLike<{ data: Row[] | null; count: number | null; error: { message: string } | null }> & {
      order: (
        column: string,
        options: { ascending: boolean },
      ) => { range: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }> };
    };
  };
};
const loose = () => createClient() as unknown as LooseClient;

/** Every table the viewer can read. Admins also edit, delete and clean up storage; supervisors view. */
export function RecordsScreen({ role }: { role: Role }) {
  return (
    <DeskGate role={role}>
      {(profile) => (
        <StaffShell profile={profile} role={role} title="Records">
          <RecordsDesk canEdit={role === "admin"} profile={profile} />
        </StaffShell>
      )}
    </DeskGate>
  );
}

async function loadNames(): Promise<Names> {
  const client = createClient();
  const [people, placements] = await Promise.all([
    client.from("daymark_profiles").select("id, display_name"),
    client.from("daymark_placements").select("id, intern_id"),
  ]);
  const person = new Map((people.data ?? []).map((p) => [p.id, p.display_name]));
  const placement = new Map((placements.data ?? []).map((p) => [p.id, person.get(p.intern_id) ?? null]));
  return {
    person: (id) => (typeof id === "string" ? (person.get(id) ?? null) : null),
    placement: (id) => (typeof id === "string" ? (placement.get(id) ?? null) : null),
  };
}

/** Removes stored files; returns how many couldn't be removed. */
async function removeFiles(files: StoredFile[]) {
  let failed = 0;
  for (const batch of fileBatches(files)) {
    const { error } = await createClient().storage.from(batch.bucket).remove(batch.paths);
    if (error) failed += batch.paths.length;
  }
  return failed;
}

function filesOf(result: unknown): StoredFile[] {
  const files = (result as { files?: unknown } | null)?.files;
  return Array.isArray(files) ? (files as StoredFile[]) : [];
}

function RecordsDesk({ canEdit, profile }: { canEdit: boolean; profile: Profile }) {
  const tables = useMemo(() => tablesFor(canEdit), [canEdit]);
  const [open, setOpen] = useState<RecordTable | null>(null);
  const [version, setVersion] = useState(0);

  const loadOverview = useCallback(async () => {
    void version;
    const [names, counts] = await Promise.all([
      loadNames(),
      Promise.all(
        tables.map(async (t) => {
          const { count } = await loose().from(t.table).select("*", { count: "exact", head: true });
          return [t.table, count ?? 0] as const;
        }),
      ),
    ]);
    return { names, counts: new Map(counts) };
  }, [tables, version]);
  const [overview, reload] = useLoad(loadOverview);
  const refresh = () => setVersion((n) => n + 1);

  return (
    <>
      <PageHeader
        title="Records"
        description={
          canEdit
            ? "Every record in the database. Open one to see it all, edit it, or delete it."
            : `Records for your interns, ${profile.display_name.split(" ")[0]}. View only: ask an admin to change or delete one.`
        }
      />
      {canEdit && !open ? <StorageCard onCleaned={refresh} /> : null}
      <LoadBlock state={overview} reload={reload}>
        {({ names, counts }) =>
          open ? (
            <TableRecords
              key={open.table + version}
              def={open}
              names={names}
              total={counts.get(open.table) ?? 0}
              canEdit={canEdit}
              onBack={() => setOpen(null)}
              onChanged={refresh}
            />
          ) : (
            <section aria-labelledby="tables-title" className="flex flex-col gap-3">
              <h2 id="tables-title">Tables</h2>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {tables.map((t) => (
                  <li key={t.table}>
                    <button
                      type="button"
                      onClick={() => setOpen(t)}
                      className="flex min-h-20 w-full flex-col items-start justify-between gap-1 rounded-xl bg-card p-3 text-left shadow-card hover:bg-black/[0.02]"
                    >
                      <span className="font-semibold">{t.label}</span>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {(counts.get(t.table) ?? 0).toLocaleString("en-AU")} records
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        }
      </LoadBlock>
    </>
  );
}

function TableRecords({
  def,
  names,
  total,
  canEdit,
  onBack,
  onChanged,
}: {
  def: RecordTable;
  names: Names;
  total: number;
  canEdit: boolean;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [pages, setPages] = useState(1);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Row | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await loose()
      .from(def.table)
      .select("*")
      .order(def.order.column, { ascending: def.order.ascending ?? false })
      .range(0, pages * PAGE - 1);
    if (error) throw error;
    return data ?? [];
  }, [def, pages]);
  const [state, reload] = useLoad(load);

  const needle = query.trim().toLowerCase();
  const matches = (row: Row) =>
    !needle ||
    `${def.title(row, names)} ${def.subtitle(row, names)} ${JSON.stringify(row)}`.toLowerCase().includes(needle);

  return (
    <section aria-labelledby="table-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" onClick={onBack} className="-ml-3">
          <ChevronLeft aria-hidden className="size-5" /> All tables
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <h2 id="table-title">{def.label}</h2>
        <p className="text-sm text-muted-foreground">
          {total.toLocaleString("en-AU")} records{!canEdit ? " · view only" : !def.deletable ? " · kept, can't be deleted" : ""}
        </p>
      </div>
      <label className="relative">
        <span className="sr-only">Search loaded records</span>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          className="pl-9"
        />
      </label>
      <LoadBlock state={state} reload={reload} empty="No records here.">
        {(rows) => {
          const shown = rows.filter(matches);
          return (
            <>
              {shown.length === 0 ? (
                <EmptyState>Nothing matches “{query}” in the loaded records.</EmptyState>
              ) : (
                <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl bg-card shadow-card">
                  {shown.map((row) => (
                    <li key={rowKey(row)}>
                      <button
                        type="button"
                        onClick={() => setPicked(row)}
                        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.02]"
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">{def.title(row, names)}</span>
                          <span className="truncate text-sm text-muted-foreground">{def.subtitle(row, names)}</span>
                        </span>
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {rows.length < total ? (
                <Button type="button" variant="secondary" onClick={() => setPages((n) => n + 1)}>
                  Load more ({rows.length.toLocaleString("en-AU")} of {total.toLocaleString("en-AU")})
                </Button>
              ) : null}
              <RecordSheet
                def={def}
                row={picked}
                names={names}
                canEdit={canEdit}
                onClose={() => setPicked(null)}
                onChanged={() => {
                  setPicked(null);
                  reload();
                  onChanged();
                }}
              />
            </>
          );
        }}
      </LoadBlock>
    </section>
  );
}

function RecordSheet({
  def,
  row,
  names,
  canEdit,
  onClose,
  onChanged,
}: {
  def: RecordTable;
  row: Row | null;
  names: Names;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fields = def.edit ?? [];

  function close() {
    setEditing(false);
    setError(null);
    setConfirming(false);
    onClose();
  }

  function startEdit(current: Row) {
    setDraft(Object.fromEntries(fields.map((f) => [f.name, inputValue(f.kind, current[f.name])])));
    setError(null);
    setEditing(true);
  }

  async function save(current: Row) {
    const patch = changedPatch(fields, current, draft);
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const { error: fail } = await createClient().rpc("update_record", {
      tbl: def.table,
      row_id: rowKey(current),
      patch,
    });
    setSaving(false);
    if (fail) {
      setError(errorText(fail, "That change didn't save. Try again."));
      return;
    }
    toast.success("Saved.");
    setEditing(false);
    onChanged();
  }

  async function remove(current: Row) {
    const { data, error: fail } = await createClient().rpc("delete_record", { tbl: def.table, row_id: rowKey(current) });
    if (fail) return errorText(fail, "That record wasn't deleted. Try again.");
    const failed = await removeFiles(filesOf(data));
    if (failed > 0) toast.warning(`Deleted. ${failed} stored file(s) are left: use “Clear files nothing uses” in Storage.`);
    else toast.success("Deleted.");
    setConfirming(false);
    onChanged();
    return null;
  }

  const photo =
    row && def.table === "daymark_punches" && typeof row.photo_path === "string" && !row.photo_deleted_at
      ? row.photo_path
      : null;

  return (
    <>
      <Dialog open={row !== null && !confirming} onOpenChange={(next) => (!next ? close() : undefined)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogTitle>{row ? def.title(row, names) : def.label}</DialogTitle>
          <DialogDescription>{row ? def.subtitle(row, names) : null}</DialogDescription>
          {row && editing ? (
            <form
              className="mt-2 flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void save(row);
              }}
            >
              {fields.map((field) => (
                <FormField key={field.name} id={`record-${field.name}`} label={field.label}>
                  {(props) =>
                    field.kind === "textarea" ? (
                      <textarea
                        {...props}
                        rows={4}
                        className="w-full rounded-md border border-input bg-card px-3 py-2"
                        value={draft[field.name] ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [field.name]: e.target.value }))}
                      />
                    ) : (
                      <Input
                        {...props}
                        type={field.kind === "datetime" ? "datetime-local" : field.kind}
                        inputMode={field.kind === "number" ? "numeric" : undefined}
                        step={field.kind === "time" ? 900 : undefined}
                        value={draft[field.name] ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [field.name]: e.target.value }))}
                      />
                    )
                  }
                </FormField>
              ))}
              {error ? <FormMessage>{error}</FormMessage> : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="secondary" disabled={saving} onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          ) : row ? (
            <>
              <dl className="mt-2 flex flex-col divide-y divide-border text-sm">
                {Object.entries(row).map(([column, value]) => (
                  <div key={column} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 py-2">
                    <dt className="text-muted-foreground">{columnLabel(column)}</dt>
                    <dd className={cn("break-words", typeof value === "object" && value !== null && "whitespace-pre-wrap font-mono text-xs")}>
                      {displayValue(column, value, names)}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {photo ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      void selfieUrl(photo)
                        .then((url) => window.open(url, "_blank", "noopener"))
                        .catch(() => toast.error("That selfie didn't open. Try again."))
                    }
                  >
                    View selfie
                  </Button>
                ) : null}
                {canEdit && fields.length > 0 ? (
                  <Button type="button" variant="secondary" onClick={() => startEdit(row)}>
                    Edit
                  </Button>
                ) : null}
                {canEdit && def.deletable ? (
                  <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
                    Delete
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={row !== null && confirming}
        title={`Delete this ${def.table === "daymark_profiles" ? "person" : "record"}?`}
        description={def.deleteNote ?? "It's deleted for good. The audit log keeps a copy of what it was."}
        confirmLabel="Delete for good"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => (row ? remove(row) : Promise.resolve(null))}
      />
    </>
  );
}

const CLEANUPS = [
  { kind: "notifications", label: "Read notifications", count: "notifications" },
  { kind: "challenges", label: "Used or expired clock-in codes", count: "challenges" },
  { kind: "selfies", label: "Selfie photos (the punch stays)", count: "selfies" },
  { kind: "orphans", label: "Files nothing uses", count: "orphans" },
] as const;

type Cleanup = (typeof CLEANUPS)[number];

function StorageCard({ onCleaned }: { onCleaned: () => void }) {
  const [days, setDays] = useState(90);
  const [pending, setPending] = useState<Cleanup | null>(null);

  const load = useCallback(async () => {
    const client = createClient();
    const [usage, preview] = await Promise.all([
      client.rpc("storage_usage"),
      client.rpc("cleanup_preview", { older_than_days: days }),
    ]);
    if (usage.error) throw usage.error;
    if (preview.error) throw preview.error;
    return { usage: usage.data ?? [], preview: (preview.data ?? {}) as Record<string, number> };
  }, [days]);
  const [state, reload] = useLoad(load);

  async function run(cleanup: Cleanup) {
    const { data, error } = await createClient().rpc("cleanup_run", { kind: cleanup.kind, older_than_days: days });
    if (error) return errorText(error, "That clean-up didn't run. Try again.");
    const failed = await removeFiles(filesOf(data));
    const rows = (data as { rows?: number } | null)?.rows ?? 0;
    if (failed > 0) toast.warning(`Cleared ${rows}. ${failed} file(s) couldn't be removed; try again later.`);
    else toast.success(`Cleared ${rows}.`);
    setPending(null);
    reload();
    onCleaned();
    return null;
  }

  return (
    <section aria-labelledby="storage-title" className="flex flex-col gap-4 rounded-xl bg-card p-4 shadow-card sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="storage-title">Storage</h2>
        <p className="text-sm text-muted-foreground">
          Free up space. The audit log and consent records are never cleared.
        </p>
      </div>
      <LoadBlock state={state} reload={reload}>
        {({ usage, preview }) => (
          <>
            <dl className="grid grid-cols-2 gap-3">
              {usage.map((bucket) => (
                <div key={bucket.bucket} className="rounded-lg bg-muted p-3">
                  <dt className="text-sm text-muted-foreground">
                    {bucket.bucket === "daymark-photos" ? "Selfies" : "Medical certificates"}
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {formatBytes(Number(bucket.bytes))} · {Number(bucket.files).toLocaleString("en-AU")} files
                  </dd>
                </div>
              ))}
            </dl>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              Clear things older than
              <select
                className="h-11 rounded-md border border-input bg-card px-3"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                {[30, 60, 90, 180, 365].map((n) => (
                  <option key={n} value={n}>
                    {n} days
                  </option>
                ))}
              </select>
            </label>
            <ul className="flex flex-col divide-y divide-border">
              {CLEANUPS.map((cleanup) => {
                const count = Number(preview[cleanup.count] ?? 0);
                return (
                  <li key={cleanup.kind} className="flex min-h-14 items-center justify-between gap-3 py-2">
                    <span className="flex flex-col">
                      <span className="font-medium">{cleanup.label}</span>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {count.toLocaleString("en-AU")}
                        {cleanup.kind === "selfies" && preview.selfie_bytes ? ` · ${formatBytes(Number(preview.selfie_bytes))}` : ""}
                        {cleanup.kind === "orphans" ? " (any age over a day)" : ""}
                      </span>
                    </span>
                    <Button type="button" variant="secondary" disabled={count === 0} onClick={() => setPending(cleanup)}>
                      Clear
                    </Button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </LoadBlock>
      <ConfirmDialog
        open={pending !== null}
        title={`Clear ${pending?.label.toLowerCase() ?? ""}?`}
        description={
          pending?.kind === "selfies"
            ? `Selfie photos from punches more than ${days} days old are deleted for good. The punches and hours stay.`
            : pending?.kind === "orphans"
              ? "Stored files that no punch or request points to are deleted for good."
              : `These are deleted for good if they are more than ${days} days old.`
        }
        confirmLabel="Clear for good"
        destructive
        onCancel={() => setPending(null)}
        onConfirm={() => (pending ? run(pending) : Promise.resolve(null))}
      />
    </section>
  );
}

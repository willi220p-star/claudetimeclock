"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { z } from "zod";
import { AdminFrame } from "@/app/admin/admin-frame";
import { ConfirmDialog } from "@/app/admin/confirm-dialog";
import { FormField, FormMessage } from "@/components/form-field";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { groupByYear, plural } from "@/lib/admin-config";
import { loadClosureDays, loadSites } from "@/lib/data";
import { errorText } from "@/lib/daymark";
import { darwinDateKey, formatDay, formatTimeOfDay } from "@/lib/darwin";
import { closureSchema, fieldErrors } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

type Closure = Awaited<ReturnType<typeof loadClosureDays>>[number];
type Site = Awaited<ReturnType<typeof loadSites>>[number];
type Draft = z.input<typeof closureSchema>;
type Restore = { display_name: string; work_date: string; start_time?: string; end_time?: string };
type RemoveResult = { day: string; restored: Restore[]; skipped: Restore[] };

const KIND_LABEL: Record<string, string> = { public_holiday: "Public holiday", office_closure: "Office closure" };
const selectClass = "h-12 w-full rounded-md border border-input bg-card px-3";
const EMPTY: Draft = { day: "", name: "", kind: "public_holiday", site_id: "" };

export function ClosuresScreen() {
  return (
    <AdminFrame title="Closures">
      <ClosuresDesk />
    </AdminFrame>
  );
}

function ClosuresDesk() {
  const [closures, reload] = useLoad(loadClosureDays);
  const [sites] = useLoad(loadSites);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Closure | null>(null);
  const [removed, setRemoved] = useState<RemoveResult | null>(null);
  const today = darwinDateKey(new Date());
  const siteList = sites.status === "ready" ? sites.data : [];

  return (
    <>
      <PageHeader
        title="Closures"
        description="Public holidays and office closures. Adding one cancels everyone's scheduled day and tells them."
        actions={
          <Button type="button" onClick={() => setAdding(true)}>
            Add closure day
          </Button>
        }
      />
      {adding ? (
        <ClosureForm
          sites={siteList}
          today={today}
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      ) : null}
      <LoadBlock state={closures} reload={reload} empty="No closure days yet.">
        {(rows) => {
          const upcoming = rows.filter((row) => row.day >= today);
          const past = rows.filter((row) => row.day < today).reverse();
          return (
            <>
              <ClosureGroup title="Upcoming" rows={upcoming} today={today} onRemove={setRemoving} />
              <ClosureGroup title="Past" rows={past} today={today} onRemove={setRemoving} />
            </>
          );
        }}
      </LoadBlock>
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.name ?? "this closure day"}?`}
        description={
          removing
            ? `${formatDay(removing.day)} goes back to a normal working day. Interns whose pattern includes it are put back on and told, unless their day would need an extra spot.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return null;
          const { data, error } = await createClient().rpc("remove_closure_day", { id: removing.id });
          if (error) return errorText(error, "That closure day wasn't removed. Try again.");
          setRemoving(null);
          setRemoved(data as unknown as RemoveResult);
          reload();
          return null;
        }}
      />
      <Dialog open={removed !== null} onOpenChange={(open) => (open ? null : setRemoved(null))}>
        <DialogContent>
          <DialogTitle>{removed ? `${formatDay(removed.day)} is a working day again` : "Removed"}</DialogTitle>
          <DialogDescription>
            {removed ? `${plural(removed.restored.length, "intern")} back on, ${removed.skipped.length} skipped.` : ""}
          </DialogDescription>
          {removed ? (
            <div className="mt-4 flex flex-col gap-4">
              <PeopleList title="Back on the schedule" people={removed.restored} empty="No one's pattern includes this day." />
              {removed.skipped.length > 0 ? (
                <PeopleList
                  title="Skipped: would need an extra spot"
                  people={removed.skipped}
                  empty=""
                  note="Add their day on their placement if you want them in."
                />
              ) : null}
            </div>
          ) : null}
          <div className="mt-6 flex justify-end">
            <Button type="button" onClick={() => setRemoved(null)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PeopleList({ title, people, empty, note }: { title: string; people: Restore[]; empty: string; note?: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="caption font-semibold text-muted-foreground">{title}</h3>
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {people.map((person, index) => (
            <li key={`${person.display_name}-${index}`} className="flex justify-between gap-3">
              <span>{person.display_name}</span>
              {person.start_time && person.end_time ? (
                <span className="text-muted-foreground tabular-nums">
                  {formatTimeOfDay(person.start_time)}–{formatTimeOfDay(person.end_time)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {note && people.length > 0 ? <p className="text-sm text-muted-foreground">{note}</p> : null}
    </section>
  );
}

function ClosureGroup({
  title,
  rows,
  today,
  onRemove,
}: {
  title: string;
  rows: Closure[];
  today: string;
  onRemove: (closure: Closure) => void;
}) {
  const id = `closures-${title.toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id}>{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        groupByYear(rows).map(({ year, items }) => (
          <div key={year} className="flex flex-col gap-2">
            <h3 className="caption font-semibold text-muted-foreground">{year}</h3>
            <ul className="flex flex-col gap-2">
              {items.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-2 rounded-xl bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="font-semibold">
                      {formatDay(row.day)} · {row.name}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <StatusChip tone={row.kind === "public_holiday" ? "info" : "neutral"} label={KIND_LABEL[row.kind] ?? row.kind} />
                      <span>{row.site?.name ?? "All sites"}</span>
                    </div>
                  </div>
                  {row.day > today ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(row)}>
                      Remove
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

function ClosureForm({
  sites,
  today,
  onCancel,
  onSaved,
}: {
  sites: Site[];
  today: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<z.output<typeof closureSchema> | null>(null);
  const set = (key: keyof Draft) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));
  const siteName = (id: string) => sites.find((site) => site.id === id)?.name ?? "the site";

  return (
    <form
      noValidate
      className="flex flex-col gap-4 rounded-xl bg-card p-4 shadow-card sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = closureSchema.safeParse(draft);
        if (!parsed.success) {
          setErrors(fieldErrors(parsed.error));
          return;
        }
        setErrors({});
        setConfirming(parsed.data);
      }}
    >
      <h2>New closure day</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="closure-day" label="Date" hint="A weekday, today or later." error={errors.day}>
          {(field) => <Input {...field} type="date" min={today} value={draft.day} onChange={set("day")} />}
        </FormField>
        <FormField id="closure-name" label="Name" error={errors.name}>
          {(field) => <Input {...field} autoComplete="off" value={draft.name} onChange={set("name")} />}
        </FormField>
        <FormField id="closure-kind" label="Kind" error={errors.kind}>
          {(field) => (
            <select {...field} className={selectClass} value={draft.kind} onChange={set("kind")}>
              <option value="public_holiday">Public holiday</option>
              <option value="office_closure">Office closure</option>
            </select>
          )}
        </FormField>
        <FormField id="closure-site" label="Site" error={errors.site_id}>
          {(field) => (
            <select {...field} className={selectClass} value={draft.site_id} onChange={set("site_id")}>
              <option value="">All sites</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Add closure day</Button>
      </div>
      <ConfirmDialog
        open={confirming !== null}
        title={confirming ? `Close ${confirming.site_id ? siteName(confirming.site_id) : "every site"} on ${formatDay(confirming.day)}?` : "Add closure day?"}
        description="Every scheduled day on this date is cancelled and those interns are told. Removing the closure later puts them back where there's room."
        confirmLabel="Add closure day"
        onCancel={() => setConfirming(null)}
        onConfirm={async () => {
          if (!confirming) return null;
          const { data, error } = await createClient().rpc("save_closure_day", {
            site_id: (confirming.site_id || null) as unknown as string,
            day: confirming.day,
            name: confirming.name,
            kind: confirming.kind,
          });
          if (error) return errorText(error, "That closure day didn't save. Try again.");
          const cancelled = Number((data as { cancelled_days?: number } | null)?.cancelled_days ?? 0);
          toast.success(`${plural(cancelled, "scheduled day")} cancelled.`);
          setConfirming(null);
          onSaved();
          return null;
        }}
      />
    </form>
  );
}

// Kept for the form-level message when the site list fails; the closure list shows its own error.
export { FormMessage };

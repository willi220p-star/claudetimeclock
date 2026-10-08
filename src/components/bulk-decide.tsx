"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { LoadBlock } from "@/components/load-block";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay } from "@/lib/darwin";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

type Decision = "approve" | "decline";
type Outcome = { failed: { label: string; message: string }[]; done: number };

/**
 * Bulk decide (8 Oct): one call per item, in order, so each keeps its own checks
 * (capacity, notices, audit). Failures are reported, never retried.
 * ponytail: sequential client loop; a server-side batch RPC if staff routinely pick 50+.
 */
export async function decideEach<T>(items: T[], label: (item: T) => string, call: (item: T) => PromiseLike<{ error: unknown }>) {
  const outcome: Outcome = { failed: [], done: 0 };
  for (const item of items) {
    const { error } = await call(item);
    if (error) outcome.failed.push({ label: label(item), message: errorText(error, "Didn't save.") });
    else outcome.done += 1;
  }
  return outcome;
}

export function reportOutcome(outcome: Outcome, decision: Decision) {
  if (outcome.done > 0) toast.success(`${outcome.done} ${decision === "approve" ? "approved" : "declined"}.`);
  for (const fail of outcome.failed) toast.error(`${fail.label}: ${fail.message}`);
}

type RequestRow = {
  id: string;
  type: string;
  requested_minutes: number | null;
  daymark_profiles?: { display_name: string } | null;
};

/** Requests one by one through decide_request; overtime is approved at the minutes asked for. */
export async function decideRequests(rows: RequestRow[], decision: Decision, note: string) {
  const outcome = await decideEach(
    rows,
    (row) => `${row.daymark_profiles?.display_name ?? "Intern"}`,
    (row) =>
      createClient().rpc("decide_request", {
        request_id: row.id,
        decision,
        note: note || undefined,
        approved_minutes: decision === "approve" && row.type === "overtime" ? (row.requested_minutes ?? undefined) : undefined,
      }),
  );
  reportOutcome(outcome, decision);
}

/** Checkbox selection over a list, pruned to ids still shown. */
export function useSelection(ids: string[]) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const selected = ids.filter((id) => picked.has(id));
  return {
    selected,
    has: (id: string) => picked.has(id),
    toggle: (id: string) =>
      setPicked((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    all: (on: boolean) => setPicked(new Set(on ? ids : [])),
    clear: () => setPicked(new Set()),
  };
}

/** "Select all" plus Approve N / Decline N (decline takes one note for all). */
export function BulkBar({
  total,
  count,
  onAll,
  onDecide,
}: {
  total: number;
  count: number;
  onAll: (on: boolean) => void;
  onDecide: (decision: Decision, note: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");

  async function decide(decision: Decision) {
    setBusy(true);
    await onDecide(decision, note.trim());
    setBusy(false);
    setDeclining(false);
    setNote("");
  }

  if (total === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="mr-auto flex min-h-11 items-center gap-2 font-medium">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={count > 0 && count === total}
            onChange={(event) => onAll(event.target.checked)}
          />
          {count > 0 ? `${count} selected` : "Select all"}
        </label>
        <Button type="button" disabled={busy || count === 0} onClick={() => void decide("approve")}>
          Approve {count || ""}
        </Button>
        <Button type="button" variant="secondary" disabled={busy || count === 0} onClick={() => setDeclining(true)}>
          Decline {count || ""}
        </Button>
      </div>
      {declining && count > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-sm font-medium">Note to the interns (optional)</span>
            <Input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
          </label>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void decide("decline")}>
            {busy ? "Declining…" : `Decline ${count}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

type WorkBasedDay = { placement_id: string; work_date: string; name: string };

async function loadWorkBased(): Promise<WorkBasedDay[]> {
  const { data, error } = await createClient()
    .from("daymark_day_kinds")
    .select(
      "placement_id, work_date, placement:daymark_placements!inner(intern:daymark_profiles!daymark_placements_intern_id_fkey(display_name))",
    )
    .eq("kind", "work_based")
    .eq("status", "pending")
    .order("work_date");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    placement_id: row.placement_id,
    work_date: row.work_date,
    name: row.placement?.intern?.display_name ?? "Intern",
  }));
}

/** Work-based days waiting (8 Oct): approved, a 5-hour day counts as the full rostered day. */
export function WorkBasedPanel() {
  const load = useCallback(() => loadWorkBased(), []);
  const [state, reload] = useLoad(load);
  const rows = state.status === "ready" ? state.data : [];
  const key = (row: WorkBasedDay) => `${row.placement_id}|${row.work_date}`;
  const selection = useSelection(rows.map(key));

  async function decide(decision: Decision) {
    const items = rows.filter((row) => selection.has(key(row)));
    const outcome = await decideEach(
      items,
      (row) => `${row.name}, ${formatDay(row.work_date)}`,
      (row) => createClient().rpc("decide_day_kind", { placement: row.placement_id, work_date: row.work_date, decision }),
    );
    reportOutcome(outcome, decision);
    selection.clear();
    reload();
  }

  return (
    <section aria-labelledby="work-based-title" className="flex flex-col gap-3">
      <h2 id="work-based-title">Work-based days</h2>
      <p className="text-sm text-muted-foreground">Approve and the 5-hour day counts as a full day. Decline and the hours worked count.</p>
      <LoadBlock state={state} reload={reload}>
        {(days) =>
          days.length === 0 ? (
            <EmptyState>No work-based days waiting.</EmptyState>
          ) : (
            <>
              <BulkBar
                total={days.length}
                count={selection.selected.length}
                onAll={selection.all}
                onDecide={(decision) => decide(decision)}
              />
              <ul className="flex flex-col gap-2">
                {days.map((row) => (
                  <li key={key(row)}>
                    <label className="flex min-h-11 items-center gap-3 rounded-lg bg-card p-4 shadow-card">
                      <input
                        type="checkbox"
                        className="size-5 accent-primary"
                        checked={selection.has(key(row))}
                        onChange={() => selection.toggle(key(row))}
                      />
                      <span className="font-semibold">{row.name}</span>
                      <span className="text-muted-foreground">{formatDay(row.work_date)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )
        }
      </LoadBlock>
    </section>
  );
}

"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/app/admin/confirm-dialog";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/database.types";
import { formatDay, formatDayTime } from "@/lib/darwin";
import { errorText } from "@/lib/daymark";
import { addDays } from "@/lib/periods";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

type Functions = Database["public"]["Functions"];
type Signoff = Functions["week_signoffs"]["Returns"][number];
type OpenItem = Functions["week_open_items"]["Returns"][number];
type Placement = { id: string; intern_name: string };

/** D43: a Monday-to-Sunday week can be signed from the following Monday (Darwin), once. */
export function signoffState(weekStart: string, today: string, signoff: Signoff | null | undefined) {
  if (signoff) return "signed" as const;
  return today >= addDays(weekStart, 7) ? ("can_sign" as const) : ("not_ended" as const);
}

/**
 * Weekly sign-off (D43) for the interns on the Timesheets week. `stamp` is the timesheet load:
 * when it changes (a staff edit can reopen a signed week), the sign-offs load again.
 */
export function WeekSignoffs({
  weekStart,
  today,
  placements,
  stamp,
}: {
  weekStart: string;
  today: string;
  placements: Placement[];
  stamp: unknown;
}) {
  // No week can be signed before it ends, so a current week has nothing to load or show.
  if (placements.length === 0 || signoffState(weekStart, today, null) === "not_ended") return null;
  return <SignoffList weekStart={weekStart} today={today} placements={placements} stamp={stamp} />;
}

function SignoffList({ weekStart, today, placements, stamp }: { weekStart: string; today: string; placements: Placement[]; stamp: unknown }) {
  const load = useCallback(async () => {
    void stamp;
    const { data, error } = await createClient().rpc("week_signoffs", { from_date: weekStart, to_date: weekStart });
    if (error) throw error;
    // loadedAt keys the cards, so a fresh load clears any open-items list shown before it.
    return { signoffs: data ?? [], loadedAt: Date.now() };
  }, [weekStart, stamp]);
  const [state, reload] = useLoad(load);
  if (state.status === "loading") return null;
  if (state.status === "error") return <p className="text-sm text-muted-foreground">Sign-offs didn&apos;t load. {state.message}</p>;

  return (
    <section aria-labelledby="week-signoff" className="flex flex-col gap-2">
      <h2 id="week-signoff" className="caption font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Sign-off
      </h2>
      <ul className="flex flex-col gap-2">
        {placements.map((placement) => (
          <SignoffCard
            key={`${placement.id}-${state.data.loadedAt}`}
            weekStart={weekStart}
            today={today}
            placement={placement}
            signoff={state.data.signoffs.find((row) => row.placement_id === placement.id)}
            onSigned={reload}
          />
        ))}
      </ul>
    </section>
  );
}

function SignoffCard({
  weekStart,
  today,
  placement,
  signoff,
  onSigned,
}: {
  weekStart: string;
  today: string;
  placement: Placement;
  signoff: Signoff | undefined;
  onSigned: () => void;
}) {
  const [items, setItems] = useState<OpenItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const status = signoffState(weekStart, today, signoff);
  const week = `the week of ${formatDay(weekStart)}`;

  async function openItems() {
    const { data, error } = await createClient().rpc("week_open_items", { placement: placement.id, week_start: weekStart });
    if (error) throw error;
    setItems(data ?? []);
    return data ?? [];
  }

  async function start() {
    setBusy(true);
    try {
      if ((await openItems()).length === 0) setConfirming(true);
    } catch (error) {
      toast.error(errorText(error, "Open items didn't load. Try again."));
    }
    setBusy(false);
  }

  async function sign() {
    const { error } = await createClient().rpc("sign_week", { placement: placement.id, week_start: weekStart });
    if (error) {
      if (error.hint !== "open_items") return errorText(error, "That week didn't sign. Try again.");
      setConfirming(false);
      await openItems().catch(() => setItems([]));
      return null;
    }
    setConfirming(false);
    toast.success(`${placement.intern_name}'s week is signed.`);
    onSigned();
    return null;
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{placement.intern_name}</p>
        {status === "signed" && signoff ? (
          <StatusChip tone="ok" label={`Signed by ${signoff.signed_by_name}, ${formatDayTime(signoff.signed_at)}`} />
        ) : status === "can_sign" ? (
          <Button
            type="button"
            size="sm"
            disabled={busy || (items?.length ?? 0) > 0}
            aria-label={`Sign ${placement.intern_name}'s ${week}`}
            onClick={() => void start()}
          >
            {busy ? "Checking…" : "Sign week"}
          </Button>
        ) : null}
      </div>
      {items && items.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Fix these first:</p>
          <ul className="list-disc pl-5 text-sm">
            {items.map((item) => (
              <li key={`${item.kind}-${item.work_date}-${item.label}`}>{item.label}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={`Sign ${placement.intern_name}'s week?`}
        description={`This signs off ${week} with its counted hours. A later change to its times reopens it and tells you.`}
        confirmLabel="Sign week"
        onCancel={() => setConfirming(false)}
        onConfirm={sign}
      />
    </li>
  );
}

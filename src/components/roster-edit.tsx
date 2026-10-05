"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { emptyDraft, patternOf, PatternEditor, TIMES, type Day } from "@/app/admin/placements/placement-wizard";
import { FormField, FormMessage } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDay, formatTimeOfDay } from "@/lib/darwin";
import type { ManagedPlacement } from "@/lib/data";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";

// Staff roster edits (Dilip, 29 Sep): one day at a time, or a pattern for a date range. The
// database checks who may (admin, or the intern's supervisor), capacity and times.

const selectClass = "h-11 w-full rounded-md border border-input bg-card px-3";

function isExtraSpot(error: unknown) {
  return typeof error === "object" && error !== null && (error as { hint?: string }).hint === "extra_spot";
}

/** Runs an RPC; on a full day, shows "Allow an extra spot" and retries with it ticked. */
function useStaffSave(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needExtra, setNeedExtra] = useState(false);
  const [allowExtra, setAllowExtra] = useState(false);

  async function run(call: (allowExtra: boolean) => PromiseLike<{ error: unknown }>, done: string) {
    setBusy(true);
    setError(null);
    const { error: fail } = await call(allowExtra);
    setBusy(false);
    if (fail) {
      setError(errorText(fail, "That change didn't save. Try again."));
      if (isExtraSpot(fail)) setNeedExtra(true);
      return;
    }
    toast.success(done);
    onDone();
  }

  const extra = needExtra ? (
    <label className="flex min-h-11 items-center gap-2">
      <input type="checkbox" className="size-5 accent-primary" checked={allowExtra} onChange={(e) => setAllowExtra(e.target.checked)} />
      Allow an extra spot on full days
    </label>
  ) : null;
  return { busy, error, extra, run };
}

export function TimeField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <FormField id={id} label={label}>
      {(field) => (
        <select {...field} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
          {TIMES.map((time) => (
            <option key={time} value={time}>
              {formatTimeOfDay(time)}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}

export function Sheet({ open, title, description, onClose, children }: { open: boolean; title: string; description: string; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Move a scheduled day, change its times, or remove it. */
export function DaySheet({
  day,
  internName,
  internLink,
  today,
  onClose,
  onDone,
}: {
  day: { id: string; work_date: string; start_time: string; end_time: string } | null;
  internName: string;
  internLink: string;
  today: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState(day?.work_date ?? today);
  const [start, setStart] = useState(day?.start_time.slice(0, 5) ?? "09:00");
  const [end, setEnd] = useState(day?.end_time.slice(0, 5) ?? "17:00");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { busy, error, extra, run } = useStaffSave(onDone);
  if (!day) return null;

  return (
    <Sheet open title={`${internName} · ${formatDay(day.work_date)}`} description="Move this day, change its times, or remove it." onClose={onClose}>
      <form
        className="mt-2 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            (allow) =>
              createClient().rpc("staff_move_day", { day: day.id, new_date: date, start_time: start, end_time: end, allow_extra: allow }),
            date === day.work_date ? "Times changed." : `Moved to ${formatDay(date)}.`,
          );
        }}
      >
        <FormField id="day-date" label="Date">
          {(field) => <Input {...field} type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <TimeField id="day-start" label="Start" value={start} onChange={setStart} />
          <TimeField id="day-end" label="Finish" value={end} onChange={setEnd} />
        </div>
        {extra}
        {error ? <FormMessage>{error}</FormMessage> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
          {confirmRemove ? (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void run(() => createClient().rpc("staff_cancel_day", { day: day.id }), "Day removed.")}
            >
              Remove for good
            </Button>
          ) : (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirmRemove(true)}>
              Remove day
            </Button>
          )}
          <Link href={internLink} className={buttonVariants({ variant: "ghost" })}>
            Open intern
          </Link>
        </div>
      </form>
    </Sheet>
  );
}

/** Add one day to an intern's roster. */
export function AddDaySheet({
  open,
  date,
  today,
  placements,
  onClose,
  onDone,
}: {
  open: boolean;
  date: string;
  today: string;
  placements: ManagedPlacement[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [placement, setPlacement] = useState(placements[0]?.id ?? "");
  const [day, setDay] = useState(date);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const { busy, error, extra, run } = useStaffSave(onDone);

  return (
    <Sheet open={open} title="Add a day" description="Adds one day to an intern's roster. They're told." onClose={onClose}>
      <form
        className="mt-2 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            (allow) => createClient().rpc("staff_add_day", { placement, work_date: day, start_time: start, end_time: end, allow_extra: allow }),
            `Added ${formatDay(day)}.`,
          );
        }}
      >
        <FormField id="add-intern" label="Intern">
          {(field) => (
            <select {...field} className={selectClass} value={placement} onChange={(e) => setPlacement(e.target.value)}>
              {placements.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.intern_name}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField id="add-date" label="Date">
          {(field) => <Input {...field} type="date" min={today} value={day} onChange={(e) => setDay(e.target.value)} />}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <TimeField id="add-start" label="Start" value={start} onChange={setStart} />
          <TimeField id="add-end" label="Finish" value={end} onChange={setEnd} />
        </div>
        {extra}
        {error ? <FormMessage>{error}</FormMessage> : null}
        <Button type="submit" disabled={busy || !placement} className="self-start">
          {busy ? "Adding…" : "Add day"}
        </Button>
      </form>
    </Sheet>
  );
}

/** A new weekly pattern for a date range; after the end date the usual days come back. */
export function ChangeDaysSheet({
  open,
  today,
  placements,
  onClose,
  onDone,
}: {
  open: boolean;
  today: string;
  placements: ManagedPlacement[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [placement, setPlacement] = useState(placements[0]?.id ?? "");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState("");
  const [days, setDays] = useState<Record<number, Day>>(() => emptyDraft().days);
  const { busy, error, extra, run } = useStaffSave(onDone);
  const chosen = placements.find((p) => p.id === placement);

  return (
    <Sheet
      open={open}
      title="Change usual days"
      description="Pick the days for a date range. Leave the end empty to keep them from then on."
      onClose={onClose}
    >
      <form
        className="mt-2 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            (allow) =>
              createClient().rpc("set_pattern_range", {
                placement,
                from_date: from,
                to_date: (to || null) as string,
                days: patternOf(days),
                allow_extra: allow,
              }),
            to ? `Days changed from ${formatDay(from)} to ${formatDay(to)}.` : `Days changed from ${formatDay(from)}.`,
          );
        }}
      >
        {placements.length > 1 ? (
          <FormField id="range-intern" label="Intern">
            {(field) => (
              <select {...field} className={selectClass} value={placement} onChange={(e) => setPlacement(e.target.value)}>
                {placements.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.intern_name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <FormField id="range-from" label="From">
            {(field) => (
              <Input {...field} type="date" min={today} max={chosen?.planned_end_date} value={from} onChange={(e) => setFrom(e.target.value)} />
            )}
          </FormField>
          <FormField id="range-to" label="Until (optional)">
            {(field) => (
              <Input {...field} type="date" min={from} max={chosen?.planned_end_date} value={to} onChange={(e) => setTo(e.target.value)} />
            )}
          </FormField>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Days and hours</legend>
          <PatternEditor days={days} onChange={setDays} />
        </fieldset>
        {extra}
        {error ? <FormMessage>{error}</FormMessage> : null}
        <Button type="submit" disabled={busy || !placement || patternOf(days).length === 0} className="self-start">
          {busy ? "Saving…" : "Save days"}
        </Button>
      </form>
    </Sheet>
  );
}

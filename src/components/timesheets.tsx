"use client";

import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { DeskGate } from "@/components/desk-gate";
import { StaffShell } from "@/components/desk-shell";
import { FormField, FormMessage } from "@/components/form-field";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { Sheet } from "@/components/roster-edit";
import { SelfieImage } from "@/components/selfie-image";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadTimesheet, type Timesheet } from "@/lib/data";
import { darwinClock, darwinDateKey, formatDay, formatTime } from "@/lib/darwin";
import { errorText, waitingLabel, type Profile } from "@/lib/daymark";
import { formatMinutes } from "@/lib/minutes";
import { addDays, mondayOf } from "@/lib/periods";
import { createClient } from "@/lib/supabase/client";
import { breakBetween, punchDays } from "@/lib/time";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";

type StaffRole = "admin" | "supervisor";
type TimesheetPunch = Timesheet["punches"][number];
type Edit = {
  placementId: string;
  name: string;
  date: string;
  inPunch: TimesheetPunch | null;
  outPunch: TimesheetPunch | null;
  addBreak?: boolean;
};

const SOURCE_TAG: Record<string, string> = { staff_edit: "Edited", punch_fix: "Fixed", auto_close: "Auto-closed" };
const selectClass = "h-11 rounded-md border border-input bg-card px-3";

/**
 * Timesheets (Dilip, 5 Oct): every clock-in, break and clock-out, a week at a time, for the
 * interns the viewer manages. Tapping a time opens a staff edit; it counts straight away.
 */
export function TimesheetsScreen({ role }: { role: StaffRole }) {
  return (
    <DeskGate role={role}>
      {(profile) => (
        <StaffShell profile={profile} role={role} title="Timesheets">
          <TimesheetsDesk role={role} profile={profile} />
        </StaffShell>
      )}
    </DeskGate>
  );
}

function TimesheetsDesk({ role, profile }: { role: StaffRole; profile: Profile }) {
  const [week, setWeek] = useState<string | null>(null);
  const [intern, setIntern] = useState("all");
  const [edit, setEdit] = useState<Edit | null>(null);
  const load = useCallback(async () => {
    const today = darwinDateKey(new Date());
    const from = week ?? mondayOf(today);
    const to = addDays(from, 6);
    return { from, to, today, ...(await loadTimesheet(from, to, role === "supervisor" ? profile.id : undefined)) };
  }, [week, role, profile.id]);
  const [state, reload] = useLoad(load);
  const shown = state.status === "ready" ? state.data : null;

  return (
    <>
      <PageHeader title="Timesheets" description="Every clock-in, break and clock-out, by day. Tap a time to change it." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Previous week"
            disabled={!shown}
            onClick={() => shown && setWeek(addDays(shown.from, -7))}
          >
            <ChevronLeft aria-hidden className="size-5" />
          </Button>
          <h2 aria-live="polite" className="min-w-40 text-center text-[17px] font-semibold">
            {shown ? `Week of ${formatDay(shown.from)}` : " "}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Next week"
            disabled={!shown || shown.to >= shown.today}
            onClick={() => shown && setWeek(addDays(shown.from, 7))}
          >
            <ChevronRight aria-hidden className="size-5" />
          </Button>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium">Intern</span>
          <select className={selectClass} value={intern} onChange={(event) => setIntern(event.target.value)}>
            <option value="all">All interns</option>
            {(shown?.placements ?? []).map((placement) => (
              <option key={placement.id} value={placement.id}>
                {placement.intern_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <LoadBlock state={state} reload={reload}>
        {(data) => <Week data={data} intern={intern} onEdit={setEdit} />}
      </LoadBlock>

      {edit?.addBreak ? (
        <BreakSheet
          edit={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            reload();
          }}
        />
      ) : edit ? (
        <EditSheet
          key={`${edit.placementId}-${edit.date}-${edit.inPunch?.id ?? "new"}-${edit.addBreak ? "break" : "times"}`}
          edit={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function Week({
  data,
  intern,
  onEdit,
}: {
  data: Timesheet & { from: string; to: string; today: string };
  intern: string;
  onEdit: (edit: Edit) => void;
}) {
  const placements = data.placements.filter((placement) => intern === "all" || placement.id === intern);
  const days: string[] = [];
  for (let day = data.to; day >= data.from; day = addDays(day, -1)) if (day <= data.today) days.push(day);
  const totals = placements
    .map((placement) => {
      const rows = data.results.filter((row) => row.placement_id === placement.id);
      return {
        placement,
        counted: rows.reduce((sum, row) => sum + row.counted, 0),
        scheduled: rows.reduce((sum, row) => sum + row.scheduled, 0),
      };
    })
    .filter((row) => row.counted > 0 || row.scheduled > 0 || data.punches.some((punch) => punch.placement_id === row.placement.id));
  const byDay = days.map((day) => ({
    day,
    entries: placements
      .map((placement) => ({
        placement,
        punches: data.punches.filter((punch) => punch.placement_id === placement.id && darwinDateKey(punch.occurred_at) === day),
        result: data.results.find((row) => row.placement_id === placement.id && row.work_date === day) ?? null,
        kind: data.kinds.find((row) => row.placement_id === placement.id && row.work_date === day) ?? null,
        absent: data.absences.some((row) => row.placement_id === placement.id && row.work_date === day),
      }))
      .filter((entry) => entry.punches.length > 0 || (entry.result?.scheduled ?? 0) > 0 || entry.absent),
  }));

  return (
    <div className="flex flex-col gap-8">
      {totals.length > 0 ? (
        <section aria-labelledby="week-totals" className="flex flex-col gap-2">
          <h2 id="week-totals" className="caption font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Week totals
          </h2>
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                <th scope="col" className="py-2 font-semibold">Intern</th>
                <th scope="col" className="py-2 text-right font-semibold">Counted</th>
                <th scope="col" className="py-2 text-right font-semibold">Rostered</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((row) => (
                <tr key={row.placement.id} className="border-b border-border">
                  <th scope="row" className="py-2 text-left font-medium">{row.placement.intern_name}</th>
                  <td className="py-2 text-right tabular-nums">{formatMinutes(row.counted)}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">{formatMinutes(row.scheduled)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {byDay.map(({ day, entries }) =>
        entries.length === 0 ? null : (
          <section key={day} aria-labelledby={`day-${day}`} className="flex flex-col gap-2">
            <h2 id={`day-${day}`} className="caption font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {day === data.today ? `Today · ${formatDay(day)}` : formatDay(day)}
            </h2>
            <ul className="flex flex-col gap-2">
              {entries.map((entry) => (
                <InternDay key={entry.placement.id} day={day} entry={entry} editors={data.editors} onEdit={onEdit} />
              ))}
            </ul>
          </section>
        ),
      )}
      {totals.length === 0 && byDay.every(({ entries }) => entries.length === 0) ? (
        <p className="text-muted-foreground">No clock-ins this week.</p>
      ) : null}
    </div>
  );
}

function InternDay({
  day,
  entry,
  editors,
  onEdit,
}: {
  day: string;
  entry: {
    placement: Timesheet["placements"][number];
    punches: TimesheetPunch[];
    result: Timesheet["results"][number] | null;
    kind: Timesheet["kinds"][number] | null;
    absent: boolean;
  };
  editors: Record<string, string>;
  onEdit: (edit: Edit) => void;
}) {
  const { placement, punches, result, kind, absent } = entry;
  const waiting = waitingLabel(punches);
  const rows = punchDays(punches)[0]?.rows ?? [];
  const edited = [...new Set(punches.filter((punch) => punch.source === "staff_edit" && punch.confirmed_by).map((punch) => editors[punch.confirmed_by!] ?? "staff"))];
  const open = (inPunch: TimesheetPunch | null, outPunch: TimesheetPunch | null) =>
    onEdit({ placementId: placement.id, name: placement.intern_name, date: day, inPunch, outPunch });

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <p className="font-semibold">{placement.intern_name}</p>
          <div className="flex flex-wrap gap-1">
            {result?.late ? <StatusChip tone="warn" label="Late" /> : null}
            {result?.auto_closed ? <StatusChip tone="warn" label="Auto-closed" /> : null}
            {result?.unscheduled ? <StatusChip tone="neutral" label="Not rostered" /> : null}
            {absent ? <StatusChip tone="bad" label="Absent" /> : null}
            {waiting ? <StatusChip tone="warn" label={waiting} /> : null}
            {kind?.kind === "work_based" ? (
              <StatusChip
                tone={kind.status === "approved" ? "ok" : kind.status === "declined" ? "bad" : "warn"}
                label={`Work-based · ${kind.status ?? "pending"}`}
              />
            ) : null}
            {edited.map((name) => (
              <StatusChip key={name} tone="neutral" label={`Edited by ${name}`} />
            ))}
          </div>
        </div>
        {result ? (
          <p className="text-right">
            <span className="text-lg font-semibold tabular-nums">{formatMinutes(result.counted)}</span>
            <span className="block text-xs text-muted-foreground">counted{result.break > 0 ? ` · ${formatMinutes(result.break)} break` : ""}</span>
          </p>
        ) : null}
      </div>

      {rows.length === 0 ? <p className="text-muted-foreground">No clock-ins.</p> : null}
      <ol className="flex flex-col gap-1">
        {rows.map((row, index) => {
          const pause = breakBetween(row, rows[index + 1]);
          const minutes =
            row.in && row.out ? Math.max(0, Math.floor((Date.parse(row.out.occurred_at) - Date.parse(row.in.occurred_at)) / 60_000)) : null;
          return (
            <li key={row.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <TimeButton punch={row.in} label={row.in?.is_break ? "end of break" : "clock-in"} name={placement.intern_name} onClick={() => open(row.in, row.out)} />
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
                <TimeButton punch={row.out} label={row.out?.is_break ? "start of break" : "clock-out"} name={placement.intern_name} onClick={() => open(row.in, row.out)} />
                {minutes !== null ? <span className="ml-auto text-sm tabular-nums text-muted-foreground">{formatMinutes(minutes)}</span> : null}
              </div>
              {pause !== null ? (
                <p className="pl-1 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">Break {formatMinutes(pause)}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-1">
        <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => open(null, null)}>
          <Plus aria-hidden />
          Add missing session
        </Button>
        {rows.some((row) => row.in && row.out) ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => onEdit({ placementId: placement.id, name: placement.intern_name, date: day, inPunch: null, outPunch: null, addBreak: true })}
          >
            <Plus aria-hidden />
            Add break
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function TimeButton({
  punch,
  label,
  name,
  onClick,
}: {
  punch: TimesheetPunch | null;
  label: string;
  name: string;
  onClick: () => void;
}) {
  const tag = punch ? SOURCE_TAG[punch.source] : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={punch ? `Change ${name}'s ${label} at ${formatTime(punch.occurred_at)}` : `Add ${name}'s ${label}`}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-full border px-2 pr-3 text-[15px] font-semibold tabular-nums",
        punch ? "border-border hover:bg-muted" : "border-dashed border-border text-muted-foreground",
      )}
    >
      {punch?.photoUrl && punch.photo_path ? (
        <SelfieImage path={punch.photo_path} url={punch.photoUrl} className="size-7 rounded-full object-cover" compact />
      ) : (
        <span aria-hidden className="size-7 rounded-full bg-muted" />
      )}
      {punch ? formatTime(punch.occurred_at) : "—"}
      {tag ? <span className="text-xs font-medium text-muted-foreground">{tag}</span> : null}
    </button>
  );
}

/** Staff edit (Dilip, 5 Oct): set the clock-in and/or clock-out with a reason; it counts straight away. */
function EditSheet({ edit, onClose, onSaved }: { edit: Edit; onClose: () => void; onSaved: () => void }) {
  const firstName = edit.name.split(/\s+/)[0];
  const original = { in: edit.inPunch ? darwinClock(edit.inPunch.occurred_at) : "", out: edit.outPunch ? darwinClock(edit.outPunch.occurred_at) : "" };
  const [clockIn, setClockIn] = useState(original.in);
  const [clockOut, setClockOut] = useState(original.out);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adding = !edit.inPunch && !edit.outPunch;
  // An auto close is stamped at the clock-in instant; it always needs a real clock-out.
  const outChanged = clockOut !== original.out || edit.outPunch?.source === "auto_close";

  async function save() {
    const inChanged = clockIn !== original.in;
    if (!inChanged && !(outChanged && clockOut)) {
      setError("Change a time first.");
      return;
    }
    if (reason.trim().length < 5) {
      setError("Give a reason of 5 to 200 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: fail } = await createClient().rpc("staff_edit_times", {
      placement: edit.placementId,
      work_date: edit.date,
      clock_in: inChanged && clockIn ? clockIn : undefined,
      clock_out: outChanged && clockOut ? clockOut : undefined,
      replaces_in: inChanged && edit.inPunch ? edit.inPunch.id : undefined,
      replaces_out: outChanged && clockOut && edit.outPunch ? edit.outPunch.id : undefined,
      reason: reason.trim(),
    });
    setBusy(false);
    if (fail) {
      setError(errorText(fail, "Those times didn't save. Try again."));
      return;
    }
    toast.success(`Times changed. ${firstName} is told.`);
    onSaved();
  }

  return (
    <Sheet
      open
      title={adding ? `Add a session for ${firstName}` : `Change ${firstName}'s times`}
      description={`${formatDay(edit.date)}. The original punches are kept, the change goes in the audit log, and it counts straight away.`}
      onClose={onClose}
    >
      {edit.inPunch?.photoUrl || edit.outPunch?.photoUrl ? (
        <div className="grid grid-cols-2 gap-2">
          {[edit.inPunch, edit.outPunch].map((punch, index) =>
            punch?.photoUrl && punch.photo_path ? (
              <SelfieImage
                key={punch.id}
                path={punch.photo_path}
                url={punch.photoUrl}
                alt={`${index === 0 ? "Clock-in" : "Clock-out"} selfie`}
                className="h-32 w-full rounded-lg object-cover"
              />
            ) : (
              <span key={index} />
            ),
          )}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <FormField id="edit-in" label={edit.inPunch?.is_break ? "Break end" : "Clock in"}>
          {(input) => <Input {...input} type="time" value={clockIn} onChange={(event) => setClockIn(event.target.value)} />}
        </FormField>
        <FormField id="edit-out" label={edit.outPunch?.is_break ? "Break start" : "Clock out"}>
          {(input) => <Input {...input} type="time" value={clockOut} onChange={(event) => setClockOut(event.target.value)} />}
        </FormField>
      </div>
      <FormField id="edit-reason" label="Reason" hint="5 to 200 characters. The intern sees it.">
        {(input) => (
          <textarea
            {...input}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={200}
            className="min-h-16 rounded-md border border-input bg-card px-3 py-2"
          />
        )}
      </FormField>
      {error ? <FormMessage>{error}</FormMessage> : null}
      <Button type="button" className="w-full" disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : "Save times"}
      </Button>
    </Sheet>
  );
}

/** Staff add a break inside a closed session (8 Oct): the session splits around it and counts straight away. */
function BreakSheet({ edit, onClose, onSaved }: { edit: Edit; onClose: () => void; onSaved: () => void }) {
  const firstName = edit.name.split(/\s+/)[0];
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!start || !end) {
      setError("Enter the break start and end.");
      return;
    }
    if (reason.trim().length < 5) {
      setError("Give a reason of 5 to 200 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: fail } = await createClient().rpc("staff_add_break", {
      placement: edit.placementId,
      work_date: edit.date,
      break_start: start,
      break_end: end,
      reason: reason.trim(),
    });
    setBusy(false);
    if (fail) {
      setError(errorText(fail, "That break didn't save. Try again."));
      return;
    }
    toast.success(`Break added. ${firstName} is told.`);
    onSaved();
  }

  return (
    <Sheet
      open
      title={`Add a break for ${firstName}`}
      description={`${formatDay(edit.date)}. It has to sit inside a clocked session; it goes in the audit log and counts straight away.`}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3">
        <FormField id="break-start" label="Break start">
          {(input) => <Input {...input} type="time" value={start} onChange={(event) => setStart(event.target.value)} />}
        </FormField>
        <FormField id="break-end" label="Break end">
          {(input) => <Input {...input} type="time" value={end} onChange={(event) => setEnd(event.target.value)} />}
        </FormField>
      </div>
      <FormField id="break-reason" label="Reason" hint="5 to 200 characters. The intern sees it.">
        {(input) => (
          <textarea
            {...input}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={200}
            className="min-h-16 rounded-md border border-input bg-card px-3 py-2"
          />
        )}
      </FormField>
      {error ? <FormMessage>{error}</FormMessage> : null}
      <Button type="button" className="w-full" disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : "Add break"}
      </Button>
    </Sheet>
  );
}

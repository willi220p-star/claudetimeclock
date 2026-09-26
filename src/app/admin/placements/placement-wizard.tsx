"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorText, type Profile } from "@/lib/daymark";
import { darwinDateKey, formatDay, formatTimeOfDay } from "@/lib/darwin";
import { formatMinutes, plannedMinutes } from "@/lib/minutes";
import { createClient } from "@/lib/supabase/client";

const WEEKDAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
] as const;

const TIMES = (() => {
  const out: string[] = [];
  for (let m = 7 * 60; m <= 19 * 60; m += 15) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
})();

export type Day = { on: boolean; start: string; end: string };
export type PatternDay = { weekday: number; start: string; end: string };

export type WizardDraft = {
  id?: string;
  intern_id: string;
  supervisor_id: string;
  university: string;
  course: string;
  cohort_id: string;
  start_date: string;
  planned_end_date: string;
  target_hours: string;
  days: Record<number, Day>;
};

export const DEFAULT_DAY: Day = { on: false, start: "09:00", end: "17:00" };

export function emptyDraft(): WizardDraft {
  return {
    intern_id: "",
    supervisor_id: "",
    university: "",
    course: "",
    cohort_id: "",
    start_date: "",
    planned_end_date: "",
    target_hours: "",
    days: Object.fromEntries(WEEKDAYS.map(({ n }) => [n, { ...DEFAULT_DAY, on: n === 1 || n === 3 || n === 5 }])),
  };
}

export function draftFromPlacement(args: {
  id: string;
  intern_id: string;
  supervisor_id: string;
  university: string;
  course: string;
  cohort_id: string | null;
  start_date: string;
  planned_end_date: string;
  target_minutes: number;
  pattern: PatternDay[];
}): WizardDraft {
  const days = emptyDraft().days;
  for (const day of WEEKDAYS) days[day.n] = { ...DEFAULT_DAY };
  for (const row of args.pattern) {
    days[row.weekday] = { on: true, start: row.start.slice(0, 5), end: row.end.slice(0, 5) };
  }
  return {
    id: args.id,
    intern_id: args.intern_id,
    supervisor_id: args.supervisor_id,
    university: args.university,
    course: args.course,
    cohort_id: args.cohort_id ?? "",
    start_date: args.start_date,
    planned_end_date: args.planned_end_date,
    target_hours: String(args.target_minutes / 60),
    days,
  };
}

export function patternOf(days: Record<number, Day>): PatternDay[] {
  return WEEKDAYS.filter(({ n }) => days[n]?.on).map(({ n }) => ({
    weekday: n,
    start: days[n].start,
    end: days[n].end,
  }));
}

function extraSpot(error: unknown) {
  return typeof error === "object" && error !== null && "hint" in error && (error as { hint?: string }).hint === "extra_spot";
}

const selectClass = "h-11 w-full rounded-md border border-input bg-card px-3";

export function PlacementWizard({
  initial,
  interns,
  supervisors,
  cohorts,
  onCancel,
  onSaved,
}: {
  initial?: WizardDraft;
  interns: Profile[];
  supervisors: Profile[];
  cohorts: { id: string; name: string }[];
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<WizardDraft>(initial ?? emptyDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowExtra, setAllowExtra] = useState(false);
  const [needExtra, setNeedExtra] = useState(false);
  const pattern = useMemo(() => patternOf(draft.days), [draft.days]);
  const weekMinutes = pattern.reduce((sum, day) => sum + plannedMinutes(day.start, day.end), 0);
  const hours = Number(draft.target_hours);
  const targetMinutes = Number.isFinite(hours) ? Math.round(hours * 60) : 0;

  function set<K extends keyof WizardDraft>(key: K, value: WizardDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setError(null);
    if (!draft.intern_id || !draft.supervisor_id) {
      setError("Pick an intern and a supervisor.");
      setStep(1);
      return;
    }
    if (!draft.start_date || !draft.planned_end_date || targetMinutes < 60) {
      setError("Set the dates and target hours.");
      setStep(2);
      return;
    }
    if (pattern.length === 0) {
      setError("Pick at least one usual day.");
      setStep(3);
      return;
    }
    setBusy(true);
    const p = {
      id: draft.id,
      intern_id: draft.intern_id,
      supervisor_id: draft.supervisor_id,
      university: draft.university,
      course: draft.course,
      cohort_id: draft.cohort_id || null,
      start_date: draft.start_date,
      planned_end_date: draft.planned_end_date,
      target_minutes: targetMinutes,
      pattern,
    };
    const { data, error: fail } = await createClient().rpc("save_placement", { p, allow_extra: allowExtra });
    if (fail) {
      setBusy(false);
      setError(errorText(fail, "That placement didn't save. Try again."));
      if (extraSpot(fail)) setNeedExtra(true);
      return;
    }
    const id = (data as string | null) ?? draft.id;
    if (draft.id && id) {
      const today = darwinDateKey(new Date());
      const from = draft.start_date > today ? draft.start_date : today;
      const { error: patternFail } = await createClient().rpc("set_pattern", {
        placement: id,
        effective_from: from,
        days: pattern,
        allow_extra: allowExtra,
      });
      if (patternFail && extraSpot(patternFail)) {
        setBusy(false);
        setNeedExtra(true);
        setError(errorText(patternFail, "Some days need an extra spot."));
        return;
      }
      if (patternFail && (patternFail as { hint?: string }).hint !== "extra_spot") {
        // ponytail: field edits already saved; pattern change can fail if the placement has started.
        toast.message("Placement saved. The weekly pattern was left as it is.");
      }
    }
    setBusy(false);
    toast.success(draft.id ? "Placement saved." : "Placement created.");
    if (id) onSaved(id);
  }

  return (
    <div className="flex flex-col gap-6 rounded-xl bg-card p-6 shadow-card">
      <p className="text-sm text-muted-foreground">Step {step} of 4</p>
      {step === 1 ? (
        <div className="flex flex-col gap-4">
          <h2>Intern</h2>
          <FormField id="wiz-intern" label="Intern">
            {(field) => (
              <select {...field} className={selectClass} value={draft.intern_id} onChange={(e) => set("intern_id", e.target.value)}>
                <option value="">Pick an intern</option>
                {interns.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.display_name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField id="wiz-sup" label="Supervisor">
            {(field) => (
              <select
                {...field}
                className={selectClass}
                value={draft.supervisor_id}
                onChange={(e) => set("supervisor_id", e.target.value)}
              >
                <option value="">Pick a supervisor</option>
                {supervisors
                  .filter((person) => person.id !== draft.intern_id)
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.display_name}
                    </option>
                  ))}
              </select>
            )}
          </FormField>
          <FormField id="wiz-uni" label="University">
            {(field) => <Input {...field} value={draft.university} onChange={(e) => set("university", e.target.value)} />}
          </FormField>
          <FormField id="wiz-course" label="Course">
            {(field) => <Input {...field} value={draft.course} onChange={(e) => set("course", e.target.value)} />}
          </FormField>
          <FormField id="wiz-cohort" label="Cohort">
            {(field) => (
              <select {...field} className={selectClass} value={draft.cohort_id} onChange={(e) => set("cohort_id", e.target.value)}>
                <option value="">No cohort</option>
                {cohorts.map((cohort) => (
                  <option key={cohort.id} value={cohort.id}>
                    {cohort.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>
      ) : null}
      {step === 2 ? (
        <div className="flex flex-col gap-4">
          <h2>Dates &amp; target</h2>
          <FormField id="wiz-start" label="Start date">
            {(field) => (
              <Input {...field} type="date" value={draft.start_date} onChange={(e) => set("start_date", e.target.value)} />
            )}
          </FormField>
          <FormField id="wiz-end" label="Planned end date">
            {(field) => (
              <Input
                {...field}
                type="date"
                value={draft.planned_end_date}
                onChange={(e) => set("planned_end_date", e.target.value)}
              />
            )}
          </FormField>
          <FormField id="wiz-hours" label="Target hours" hint="Saved as minutes (hours × 60).">
            {(field) => (
              <Input
                {...field}
                type="number"
                min={1}
                step={0.5}
                value={draft.target_hours}
                onChange={(e) => set("target_hours", e.target.value)}
              />
            )}
          </FormField>
          {targetMinutes >= 60 ? <p className="text-sm text-muted-foreground">{formatMinutes(targetMinutes)} target</p> : null}
        </div>
      ) : null}
      {step === 3 ? (
        <div className="flex flex-col gap-4">
          <h2>Weekly pattern</h2>
          <p className="text-sm text-muted-foreground">Monday to Friday, 15-minute steps. Live planned minutes update as you go.</p>
          <PatternEditor days={draft.days} onChange={(days) => set("days", days)} />
          <p className="font-semibold">Planned {formatMinutes(weekMinutes)} a week</p>
        </div>
      ) : null}
      {step === 4 ? (
        <div className="flex flex-col gap-3">
          <h2>Review</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Intern</dt>
              <dd className="font-semibold">{interns.find((p) => p.id === draft.intern_id)?.display_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Supervisor</dt>
              <dd className="font-semibold">{supervisors.find((p) => p.id === draft.supervisor_id)?.display_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">University / course</dt>
              <dd>
                {draft.university} · {draft.course}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Cohort</dt>
              <dd>{cohorts.find((c) => c.id === draft.cohort_id)?.name ?? "None"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Dates</dt>
              <dd>
                {draft.start_date ? formatDay(draft.start_date) : "—"} – {draft.planned_end_date ? formatDay(draft.planned_end_date) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Target</dt>
              <dd>{targetMinutes >= 60 ? formatMinutes(targetMinutes) : "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Pattern</dt>
              <dd>
                {pattern.length === 0
                  ? "None"
                  : pattern
                      .map((day) => `${WEEKDAYS.find((w) => w.n === day.weekday)?.label} ${formatTimeOfDay(day.start)}–${formatTimeOfDay(day.end)}`)
                      .join("; ")}
                {pattern.length > 0 ? ` · ${formatMinutes(weekMinutes)} / week` : ""}
              </dd>
            </div>
          </dl>
          {needExtra ? (
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="size-5 accent-primary" checked={allowExtra} onChange={(e) => setAllowExtra(e.target.checked)} />
              Allow extra spots on full days
            </label>
          ) : null}
        </div>
      ) : null}
      {error ? <FormMessage>{error}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        {step > 1 ? (
          <Button type="button" variant="secondary" onClick={() => setStep((n) => n - 1)}>
            Back
          </Button>
        ) : null}
        {step < 4 ? (
          <Button type="button" onClick={() => setStep((n) => n + 1)}>
            Next
          </Button>
        ) : (
          <Button type="button" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : draft.id ? "Save placement" : "Create placement"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function weekdayLabel(n: number) {
  return WEEKDAYS.find((day) => day.n === n)?.label ?? `Day ${n}`;
}

/** Mon–Fri with a start and finish time each, in 15-minute steps; shows each day's planned hours. */
export function PatternEditor({ days, onChange }: { days: Record<number, Day>; onChange: (days: Record<number, Day>) => void }) {
  return (
    <ul className="flex flex-col gap-3">
      {WEEKDAYS.map(({ n, label }) => {
        const day = days[n] ?? DEFAULT_DAY;
        const minutes = day.on ? plannedMinutes(day.start, day.end) : 0;
        return (
          <li key={n} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center">
            <label className="flex min-h-11 items-center gap-2 sm:w-24">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={day.on}
                onChange={(e) => onChange({ ...days, [n]: { ...day, on: e.target.checked } })}
              />
              {label}
            </label>
            <div className="grid flex-1 grid-cols-2 gap-2">
              <select
                aria-label={`${label} start`}
                disabled={!day.on}
                className={selectClass}
                value={day.start}
                onChange={(e) => onChange({ ...days, [n]: { ...day, start: e.target.value } })}
              >
                {TIMES.map((time) => (
                  <option key={time} value={time}>
                    {formatTimeOfDay(time)}
                  </option>
                ))}
              </select>
              <select
                aria-label={`${label} end`}
                disabled={!day.on}
                className={selectClass}
                value={day.end}
                onChange={(e) => onChange({ ...days, [n]: { ...day, end: e.target.value } })}
              >
                {TIMES.map((time) => (
                  <option key={time} value={time}>
                    {formatTimeOfDay(time)}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-sm text-muted-foreground sm:w-20 sm:text-right">{day.on ? formatMinutes(minutes) : "—"}</p>
          </li>
        );
      })}
    </ul>
  );
}

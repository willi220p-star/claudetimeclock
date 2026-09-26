"use client";

import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";
import { emptyDraft, patternOf, PatternEditor, type Day } from "@/app/admin/placements/placement-wizard";
import { FormField, FormMessage, PasswordInput } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorText, type Profile } from "@/lib/daymark";
import { formatMinutes, plannedMinutes } from "@/lib/minutes";
import { rosterTotal } from "@/lib/periods";
import { ROLE_LABEL } from "@/lib/roles";
import { personSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/client";

type NewPerson = z.infer<typeof personSchema>;

type Placement = {
  supervisor_id: string;
  university: string;
  course: string;
  start_date: string;
  planned_end_date: string;
  target_hours: string;
  days: Record<number, Day>;
};

const ROLE_FIELDS = [
  ["is_intern", ROLE_LABEL.intern],
  ["is_supervisor", ROLE_LABEL.supervisor],
  ["is_admin", ROLE_LABEL.admin],
] as const;

const selectClass = "h-11 w-full rounded-md border border-input bg-card px-3";

function emptyPlacement(): Placement {
  const { supervisor_id, university, course, start_date, planned_end_date, target_hours, days } = emptyDraft();
  return { supervisor_id, university, course, start_date, planned_end_date, target_hours, days };
}

/** The first thing wrong with the placement part, in the order the fields appear. */
function placementProblem(p: Placement, targetMinutes: number, days: number) {
  if (!p.supervisor_id) return "Pick their supervisor.";
  if (!p.university.trim() || !p.course.trim()) return "Enter the university and the course.";
  if (!p.start_date || !p.planned_end_date) return "Set the start and end dates.";
  if (p.planned_end_date < p.start_date) return "The end date must be on or after the start date.";
  if (days === 0) return "Pick at least one day they work.";
  if (targetMinutes < 60) return "Set their target hours.";
  return null;
}

/**
 * The temporary password is sent once to the database, then cleared. It's never shown again.
 * An intern is added with their placement and weekly roster in one step (create_intern).
 */
export function AddPersonForm({ people, onAdded }: { people: Profile[]; onAdded: () => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const [placement, setPlacement] = useState<Placement>(emptyPlacement);
  const [allowExtra, setAllowExtra] = useState(false);
  const [needExtra, setNeedExtra] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<NewPerson>({
    resolver: zodResolver(personSchema),
    defaultValues: { display_name: "", email: "", password: "", is_intern: true, is_supervisor: false, is_admin: false },
  });
  const isIntern = useWatch({ control, name: "is_intern" });
  const supervisors = people.filter((person) => person.is_supervisor && person.active);
  const pattern = useMemo(() => patternOf(placement.days), [placement.days]);
  const hours = Number(placement.target_hours);
  const targetMinutes = Number.isFinite(hours) ? Math.round(hours * 60) : 0;
  const roster =
    placement.start_date && placement.planned_end_date && placement.planned_end_date >= placement.start_date
      ? rosterTotal(placement.start_date, placement.planned_end_date, (weekday) => {
          const day = pattern.find((d) => d.weekday === weekday);
          return day ? plannedMinutes(day.start, day.end) : 0;
        })
      : null;

  function set<K extends keyof Placement>(key: K, value: Placement[K]) {
    setPlacement((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(values: NewPerson) {
    setFormError(null);
    if (!values.is_intern) {
      const { error } = await createClient().rpc("create_person", values);
      if (error) {
        setFormError(errorText(error, "That person wasn't added. Try again."));
        return;
      }
    } else {
      const problem = placementProblem(placement, targetMinutes, pattern.length);
      if (problem) {
        setFormError(problem);
        return;
      }
      const { error } = await createClient().rpc("create_intern", {
        display_name: values.display_name,
        email: values.email,
        password: values.password,
        is_supervisor: values.is_supervisor,
        is_admin: values.is_admin,
        placement: {
          supervisor_id: placement.supervisor_id,
          university: placement.university.trim(),
          course: placement.course.trim(),
          start_date: placement.start_date,
          planned_end_date: placement.planned_end_date,
          target_minutes: targetMinutes,
          pattern,
        },
        allow_extra: allowExtra,
      });
      if (error) {
        setFormError(errorText(error, "That intern wasn't added. Try again."));
        if ((error as { hint?: string }).hint === "extra_spot") setNeedExtra(true);
        return;
      }
    }
    reset();
    setPlacement(emptyPlacement());
    setAllowExtra(false);
    setNeedExtra(false);
    toast.success(
      values.is_intern
        ? `${values.display_name} is added with their roster. They'll choose their own password first.`
        : `${values.display_name} can sign in now. They'll choose their own password first.`,
    );
    onAdded();
  }

  return (
    <section aria-labelledby="add-person-title" className="flex flex-col gap-4 rounded-xl bg-card p-4 shadow-card sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="add-person-title">Add a person</h2>
        <p className="text-sm text-muted-foreground">
          Give them the temporary password yourself. They choose their own when they first sign in.
        </p>
      </div>
      <form method="post" noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField id="person-name" label="Name" error={errors.display_name?.message}>
          {(field) => <Input {...field} {...register("display_name")} autoComplete="off" />}
        </FormField>
        <FormField id="person-email" label="Email" error={errors.email?.message}>
          {(field) => (
            <Input
              {...field}
              {...register("email")}
              type="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          )}
        </FormField>
        <FormField
          id="person-password"
          label="Temporary password"
          hint="12 to 72 characters. You won't see it again after you add them."
          error={errors.password?.message}
        >
          {(field) => <PasswordInput {...field} {...register("password")} autoComplete="new-password" />}
        </FormField>
        <fieldset
          className="flex flex-col gap-1"
          aria-describedby={errors.is_intern ? "person-roles-error" : undefined}
        >
          <legend className="mb-1 text-sm font-medium">Roles</legend>
          <div className="flex flex-wrap gap-x-5">
            {ROLE_FIELDS.map(([name, label]) => (
              <label key={name} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" {...register(name)} className="size-5 accent-primary" />
                {label}
              </label>
            ))}
          </div>
          {errors.is_intern ? (
            <p id="person-roles-error" className="text-sm font-medium text-bad">
              {errors.is_intern.message}
            </p>
          ) : null}
        </fieldset>

        {isIntern ? (
          <fieldset className="flex flex-col gap-4 border-t border-border pt-4">
            <legend className="sr-only">Placement</legend>
            <div className="flex flex-col gap-1">
              <h3 className="text-[17px] font-semibold">Placement and roster</h3>
              <p className="text-sm text-muted-foreground">Their roster is made for every chosen day between the dates.</p>
            </div>
            <FormField id="person-supervisor" label="Supervisor">
              {(field) => (
                <select
                  {...field}
                  className={selectClass}
                  value={placement.supervisor_id}
                  onChange={(e) => set("supervisor_id", e.target.value)}
                >
                  <option value="">Pick a supervisor</option>
                  {supervisors.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.display_name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="person-uni" label="University">
                {(field) => <Input {...field} value={placement.university} onChange={(e) => set("university", e.target.value)} />}
              </FormField>
              <FormField id="person-course" label="Course">
                {(field) => <Input {...field} value={placement.course} onChange={(e) => set("course", e.target.value)} />}
              </FormField>
              <FormField id="person-start" label="Start date">
                {(field) => (
                  <Input {...field} type="date" value={placement.start_date} onChange={(e) => set("start_date", e.target.value)} />
                )}
              </FormField>
              <FormField id="person-end" label="End date">
                {(field) => (
                  <Input
                    {...field}
                    type="date"
                    min={placement.start_date || undefined}
                    value={placement.planned_end_date}
                    onChange={(e) => set("planned_end_date", e.target.value)}
                  />
                )}
              </FormField>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Days and hours they work</legend>
              <PatternEditor days={placement.days} onChange={(days) => set("days", days)} />
            </fieldset>
            <FormField
              id="person-target"
              label="Target hours"
              hint={
                roster
                  ? `The roster adds up to ${roster.days} days, ${formatMinutes(roster.minutes)} before closures.`
                  : "The hours their university needs."
              }
            >
              {(field) => (
                <div className="flex gap-2">
                  <Input
                    {...field}
                    type="number"
                    inputMode="decimal"
                    min={1}
                    step={0.5}
                    value={placement.target_hours}
                    onChange={(e) => set("target_hours", e.target.value)}
                  />
                  {roster && roster.minutes > 0 ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="shrink-0"
                      onClick={() => set("target_hours", String(Math.round(roster.minutes / 30) / 2))}
                    >
                      Use roster
                    </Button>
                  ) : null}
                </div>
              )}
            </FormField>
            {needExtra ? (
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={allowExtra}
                  onChange={(e) => setAllowExtra(e.target.checked)}
                />
                Allow extra spots on full days
              </label>
            ) : null}
          </fieldset>
        ) : null}

        {formError ? <FormMessage>{formError}</FormMessage> : null}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Adding…" : isIntern ? "Add intern and roster" : "Add person"}
        </Button>
      </form>
    </section>
  );
}

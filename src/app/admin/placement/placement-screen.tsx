"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AdminFrame } from "@/app/admin/admin-frame";
import {
  PlacementWizard,
  draftFromPlacement,
  weekdayLabel,
  type PatternDay,
} from "@/app/admin/placements/placement-wizard";
import { EmptyState } from "@/components/empty-state";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { Button, buttonVariants } from "@/components/ui/button";
import { loadCohorts, loadPlacement, loadProfiles } from "@/lib/data";
import { formatDay, formatTimeOfDay } from "@/lib/darwin";
import { formatMinutes } from "@/lib/minutes";
import { PLACEMENT_STATUS_LABEL } from "@/lib/placement-ui";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

type Detail = NonNullable<Awaited<ReturnType<typeof loadPlacement>>>;

function rel<T extends { display_name?: string; name?: string; contact_email?: string | null }>(
  value: T | T[] | null | undefined,
): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function loadPattern(placementId: string): Promise<PatternDay[]> {
  const { data, error } = await createClient()
    .from("daymark_pattern_versions")
    .select("effective_from, daymark_pattern_days(weekday, start_time, end_time)")
    .eq("placement_id", placementId)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const days = data?.daymark_pattern_days ?? [];
  return (Array.isArray(days) ? days : [days]).map((day) => ({
    weekday: day.weekday,
    start: String(day.start_time).slice(0, 5),
    end: String(day.end_time).slice(0, 5),
  }));
}

export function PlacementScreen() {
  return (
    <AdminFrame title="Placement">
      <PlacementDesk />
    </AdminFrame>
  );
}

function PlacementDesk() {
  const id = useSearchParams().get("id") ?? "";
  const load = useCallback(async () => {
    if (!id) return null;
    const [row, pattern] = await Promise.all([loadPlacement(id), loadPattern(id)]);
    return row ? { row, pattern } : null;
  }, [id]);
  const [state, reload] = useLoad(load);
  const [profiles, reloadProfiles] = useLoad(loadProfiles);
  const [cohorts, reloadCohorts] = useLoad(loadCohorts);
  const [editing, setEditing] = useState(false);

  if (!id) {
    return (
      <>
        <PageHeader title="Placement" />
        <EmptyState action={<Link href="/admin/placements" className={buttonVariants({ variant: "secondary" })}>All placements</Link>}>
          Pick a placement from the list.
        </EmptyState>
      </>
    );
  }

  return (
    <LoadBlock
      state={state}
      reload={reload}
      empty="That placement wasn't found."
      action={<Link href="/admin/placements" className={buttonVariants({ variant: "secondary" })}>All placements</Link>}
    >
      {(data) => {
        if (!data) {
          return (
            <EmptyState action={<Link href="/admin/placements" className={buttonVariants({ variant: "secondary" })}>All placements</Link>}>
              That placement wasn&apos;t found.
            </EmptyState>
          );
        }
        const { row, pattern } = data;
        const intern = rel(row.intern);
        const supervisor = rel(row.supervisor);
        const cohort = rel(row.cohort);
        if (editing) {
          return (
            <LoadBlock
              state={
                profiles.status === "error"
                  ? profiles
                  : cohorts.status === "error"
                    ? cohorts
                    : profiles.status === "ready" && cohorts.status === "ready"
                      ? { status: "ready" as const, data: true }
                      : { status: "loading" as const }
              }
              reload={() => {
                reloadProfiles();
                reloadCohorts();
              }}
            >
              {() => (
                <PlacementWizard
                  initial={draftFromPlacement({
                    id: row.id,
                    intern_id: row.intern_id,
                    supervisor_id: row.supervisor_id,
                    university: row.university,
                    course: row.course,
                    cohort_id: row.cohort_id,
                    start_date: row.start_date,
                    planned_end_date: row.planned_end_date,
                    target_minutes: row.target_minutes,
                    pattern,
                  })}
                  interns={profiles.status === "ready" ? profiles.data.filter((p) => p.is_intern) : []}
                  supervisors={profiles.status === "ready" ? profiles.data.filter((p) => p.is_supervisor && p.active) : []}
                  cohorts={cohorts.status === "ready" ? cohorts.data : []}
                  onCancel={() => setEditing(false)}
                  onSaved={() => {
                    setEditing(false);
                    reload();
                  }}
                />
              )}
            </LoadBlock>
          );
        }
        return <PlacementFields row={row} intern={intern} supervisor={supervisor} cohort={cohort} pattern={pattern} onEdit={() => setEditing(true)} />;
      }}
    </LoadBlock>
  );
}

function PlacementFields({
  row,
  intern,
  supervisor,
  cohort,
  pattern,
  onEdit,
}: {
  row: Detail;
  intern: { display_name?: string; contact_email?: string | null } | null;
  supervisor: { display_name?: string } | null;
  cohort: { name?: string } | null;
  pattern: PatternDay[];
  onEdit: () => void;
}) {
  return (
    <>
      <PageHeader
        title={intern?.display_name ?? "Placement"}
        description={intern?.contact_email ?? undefined}
        actions={
          <>
            <Link href="/admin/placements" className={buttonVariants({ variant: "secondary" })}>
              All placements
            </Link>
            <Button type="button" onClick={onEdit}>
              Edit
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap gap-2">
        <StatusChip tone="info" label={PLACEMENT_STATUS_LABEL[row.status] ?? row.status} />
        {row.ended_on ? <StatusChip tone="neutral" label={`Ended ${formatDay(row.ended_on)}`} /> : null}
        {row.target_reached_at ? <StatusChip tone="ok" label="Target reached" /> : null}
      </div>
      <dl className="grid gap-4 rounded-xl bg-card p-6 shadow-card sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">Supervisor</dt>
          <dd className="font-semibold">{supervisor?.display_name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Cohort</dt>
          <dd className="font-semibold">{cohort?.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">University / course</dt>
          <dd>
            {row.university} · {row.course}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Dates</dt>
          <dd>
            {formatDay(row.start_date)} – {formatDay(row.planned_end_date)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Target</dt>
          <dd>{formatMinutes(row.target_minutes)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Lifecycle</dt>
          <dd>{PLACEMENT_STATUS_LABEL[row.status] ?? row.status}</dd>
        </div>
      </dl>
      <section aria-labelledby="pattern-title" className="flex flex-col gap-3">
        <h2 id="pattern-title">Weekly pattern</h2>
        {pattern.length === 0 ? (
          <p className="text-sm text-muted-foreground">No usual days on file.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pattern
              .slice()
              .sort((a, b) => a.weekday - b.weekday)
              .map((day) => (
                <li key={day.weekday} className="flex justify-between gap-3 rounded-lg bg-card px-4 py-3 shadow-card">
                  <span className="font-semibold">{weekdayLabel(day.weekday)}</span>
                  <span>
                    {formatTimeOfDay(day.start)} – {formatTimeOfDay(day.end)}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>
    </>
  );
}

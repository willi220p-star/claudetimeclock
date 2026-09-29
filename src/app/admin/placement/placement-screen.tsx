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
import { PdfDownloads } from "@/components/pdf-downloads";
import { ChangeDaysSheet } from "@/components/roster-edit";
import { StatusChip } from "@/components/status-chip";
import { Button, buttonVariants } from "@/components/ui/button";
import { loadCohorts, loadPlacement, loadProfiles } from "@/lib/data";
import { darwinDateKey, formatDay, formatTimeOfDay } from "@/lib/darwin";
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

type PatternVersion = { effective_from: string; days: PatternDay[] };

/** Every weekly pattern of the placement, newest first (date-range changes add future ones). */
async function loadPatternHistory(placementId: string): Promise<PatternVersion[]> {
  const { data, error } = await createClient()
    .from("daymark_pattern_versions")
    .select("effective_from, daymark_pattern_days(weekday, start_time, end_time)")
    .eq("placement_id", placementId)
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((version) => {
    const days = version.daymark_pattern_days ?? [];
    return {
      effective_from: version.effective_from,
      days: (Array.isArray(days) ? days : [days])
        .map((day) => ({ weekday: day.weekday, start: String(day.start_time).slice(0, 5), end: String(day.end_time).slice(0, 5) }))
        .sort((a, b) => a.weekday - b.weekday),
    };
  });
}

/** The pattern in force today: the newest one that has started, else the first one. */
function currentPattern(versions: PatternVersion[], today: string) {
  return (versions.find((v) => v.effective_from <= today) ?? versions.at(-1))?.days ?? [];
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
    const [row, versions] = await Promise.all([loadPlacement(id), loadPatternHistory(id)]);
    return row ? { row, versions } : null;
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
        const { row, versions } = data;
        const today = darwinDateKey(new Date());
        const pattern = currentPattern(versions, today);
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
        return (
          <PlacementFields
            row={row}
            intern={intern}
            supervisor={supervisor}
            cohort={cohort}
            versions={versions}
            today={today}
            onEdit={() => setEditing(true)}
            onChanged={reload}
          />
        );
      }}
    </LoadBlock>
  );
}

function PlacementFields({
  row,
  intern,
  supervisor,
  cohort,
  versions,
  today,
  onEdit,
  onChanged,
}: {
  row: Detail;
  intern: { display_name?: string; contact_email?: string | null } | null;
  supervisor: { display_name?: string } | null;
  cohort: { name?: string } | null;
  versions: PatternVersion[];
  today: string;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [changing, setChanging] = useState(false);
  const pattern = currentPattern(versions, today);
  const describe = (days: PatternDay[]) =>
    days.length === 0
      ? "No days"
      : days.map((day) => `${weekdayLabel(day.weekday)} ${formatTimeOfDay(day.start)}–${formatTimeOfDay(day.end)}`).join(" · ");
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
      <PdfDownloads placementId={row.id} status={row.status} reportApprovedAt={row.report_approved_at} />
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="pattern-title">Weekly pattern</h2>
          {row.status === "active" || row.status === "extended" || row.status === "target_reached" ? (
            <Button type="button" variant="secondary" onClick={() => setChanging(true)}>
              Change days
            </Button>
          ) : null}
        </div>
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
        {versions.length > 1 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Pattern changes</h3>
            <ol className="flex flex-col gap-1 text-sm">
              {versions.map((version) => (
                <li key={version.effective_from} className="flex flex-col rounded-lg bg-card px-4 py-2 shadow-card sm:flex-row sm:gap-3">
                  <span className="font-semibold sm:w-40">
                    {version.effective_from > today ? "From " : "Since "}
                    {formatDay(version.effective_from)}
                  </span>
                  <span className="text-muted-foreground">{describe(version.days)}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>
      {changing ? (
        <ChangeDaysSheet
          open
          today={today}
          placements={[{ id: row.id, intern_name: intern?.display_name ?? "Intern", start_date: row.start_date, planned_end_date: row.planned_end_date }]}
          onClose={() => setChanging(false)}
          onDone={() => {
            setChanging(false);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

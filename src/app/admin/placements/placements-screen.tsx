"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminFrame } from "@/app/admin/admin-frame";
import { PlacementWizard, emptyDraft } from "@/app/admin/placements/placement-wizard";
import { LoadBlock } from "@/components/load-block";
import { PaceChip } from "@/components/pace-chip";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { loadCohorts, loadPlacements, loadProfiles, loadProgressAll } from "@/lib/data";
import { formatDay } from "@/lib/darwin";
import { formatMinutes } from "@/lib/minutes";
import { PLACEMENT_STATUS_LABEL } from "@/lib/placement-ui";
import { useLoad } from "@/lib/use-load";

const selectClass = "h-11 rounded-md border border-input bg-card px-3";

function relName(rel: { name?: string; display_name?: string } | { name?: string; display_name?: string }[] | null) {
  const row = Array.isArray(rel) ? rel[0] : rel;
  return row?.display_name ?? row?.name ?? "—";
}

export function PlacementsScreen() {
  return (
    <AdminFrame title="Placements">
      <PlacementsDesk />
    </AdminFrame>
  );
}

function PlacementsDesk() {
  const router = useRouter();
  const [placements, reloadPlacements] = useLoad(loadPlacements);
  const [progress, reloadProgress] = useLoad(loadProgressAll);
  const [profiles, reloadProfiles] = useLoad(loadProfiles);
  const [cohorts, reloadCohorts] = useLoad(loadCohorts);
  const [creating, setCreating] = useState(false);
  const [cohort, setCohort] = useState("all");
  const [status, setStatus] = useState("all");
  const [supervisor, setSupervisor] = useState("all");
  const [pace, setPace] = useState("all");

  const progressById = useMemo(() => {
    const map = new Map<string, { pace: string; days_late: number | null }>();
    if (progress.status === "ready") {
      for (const row of progress.data) map.set(row.placement_id, { pace: row.pace, days_late: row.days_late });
    }
    return map;
  }, [progress]);

  const supervisors = useMemo(() => {
    if (placements.status !== "ready") return [];
    const seen = new Map<string, string>();
    for (const row of placements.data) {
      if (row.supervisor_id) seen.set(row.supervisor_id, relName(row.supervisor));
    }
    return [...seen.entries()];
  }, [placements]);

  const cohortOptions = useMemo(() => {
    if (placements.status !== "ready") return [];
    const seen = new Map<string, string>();
    for (const row of placements.data) {
      if (row.cohort_id) seen.set(row.cohort_id, relName(row.cohort));
    }
    return [...seen.entries()];
  }, [placements]);

  return (
    <>
      <PageHeader
        title="Placements"
        description="Create and edit intern placements."
        actions={
          creating ? null : (
            <Button type="button" onClick={() => setCreating(true)}>
              New placement
            </Button>
          )
        }
      />
      {creating ? (
        <LoadBlock
          state={
            profiles.status === "error"
              ? profiles
              : cohorts.status === "error"
                ? cohorts
                : profiles.status === "ready" && cohorts.status === "ready"
                  ? { status: "ready" as const, data: { profiles: profiles.data, cohorts: cohorts.data } }
                  : { status: "loading" as const }
          }
          reload={() => {
            reloadProfiles();
            reloadCohorts();
          }}
        >
          {({ profiles: people, cohorts: cohortRows }) => (
            <PlacementWizard
              initial={emptyDraft()}
              interns={people.filter((p) => p.is_intern && p.active)}
              supervisors={people.filter((p) => p.is_supervisor && p.active)}
              cohorts={cohortRows}
              onCancel={() => setCreating(false)}
              onSaved={(id) => {
                setCreating(false);
                reloadPlacements();
                router.push(`/admin/placement?id=${id}`);
              }}
            />
          )}
        </LoadBlock>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="filter-cohort">Cohort</Label>
              <select id="filter-cohort" className={selectClass} value={cohort} onChange={(e) => setCohort(e.target.value)}>
                <option value="all">All cohorts</option>
                {cohortOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="filter-status">Status</Label>
              <select id="filter-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">All statuses</option>
                {Object.entries(PLACEMENT_STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="filter-sup">Supervisor</Label>
              <select id="filter-sup" className={selectClass} value={supervisor} onChange={(e) => setSupervisor(e.target.value)}>
                <option value="all">All supervisors</option>
                {supervisors.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="filter-pace">Pace</Label>
              <select id="filter-pace" className={selectClass} value={pace} onChange={(e) => setPace(e.target.value)}>
                <option value="all">All paces</option>
                <option value="green">On pace</option>
                <option value="amber">Behind</option>
                <option value="red">At risk</option>
              </select>
            </div>
          </div>
          <LoadBlock
            state={placements}
            reload={() => {
              reloadPlacements();
              reloadProgress();
            }}
            empty="No placements yet. Create one, or import a CSV."
            action={
              <Button type="button" onClick={() => setCreating(true)}>
                New placement
              </Button>
            }
          >
            {(rows) => {
              const filtered = rows.filter((row) => {
                if (cohort !== "all" && row.cohort_id !== cohort) return false;
                if (status !== "all" && row.status !== status) return false;
                if (supervisor !== "all" && row.supervisor_id !== supervisor) return false;
                const mark = progressById.get(row.id);
                if (pace !== "all" && mark?.pace !== pace) return false;
                return true;
              });
              if (filtered.length === 0) {
                return <p className="text-sm text-muted-foreground">No placements match those filters.</p>;
              }
              return (
                <>
                  <div className="hidden overflow-x-auto sm:block">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">Intern</th>
                          <th className="py-2 pr-3 font-medium">Supervisor</th>
                          <th className="py-2 pr-3 font-medium">Cohort</th>
                          <th className="py-2 pr-3 font-medium">Status</th>
                          <th className="py-2 pr-3 font-medium">Dates</th>
                          <th className="py-2 pr-3 font-medium">Target</th>
                          <th className="py-2 font-medium">Pace</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((row) => {
                          const mark = progressById.get(row.id);
                          return (
                            <tr key={row.id} className="border-t border-border">
                              <td className="py-3 pr-3">
                                <Link href={`/admin/placement?id=${row.id}`} className="font-semibold">
                                  {relName(row.intern)}
                                </Link>
                              </td>
                              <td className="py-3 pr-3">{relName(row.supervisor)}</td>
                              <td className="py-3 pr-3">{relName(row.cohort)}</td>
                              <td className="py-3 pr-3">
                                <StatusChip tone="info" label={PLACEMENT_STATUS_LABEL[row.status] ?? row.status} />
                              </td>
                              <td className="py-3 pr-3">
                                {formatDay(row.start_date)} – {formatDay(row.planned_end_date)}
                              </td>
                              <td className="py-3 pr-3">{formatMinutes(row.target_minutes)}</td>
                              <td className="py-3">{mark ? <PaceChip daysLate={mark.days_late} /> : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <ul className="flex flex-col gap-2 sm:hidden">
                    {filtered.map((row) => {
                      const mark = progressById.get(row.id);
                      return (
                        <li key={row.id} className="flex flex-col gap-2 rounded-lg bg-card p-4 shadow-card">
                          <Link href={`/admin/placement?id=${row.id}`} className="font-semibold">
                            {relName(row.intern)}
                          </Link>
                          <p className="text-sm text-muted-foreground">
                            {relName(row.supervisor)} · {relName(row.cohort)}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <StatusChip tone="info" label={PLACEMENT_STATUS_LABEL[row.status] ?? row.status} />
                            {mark ? <PaceChip daysLate={mark.days_late} /> : null}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {formatDay(row.start_date)} – {formatDay(row.planned_end_date)} · {formatMinutes(row.target_minutes)}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </>
              );
            }}
          </LoadBlock>
        </>
      )}
    </>
  );
}

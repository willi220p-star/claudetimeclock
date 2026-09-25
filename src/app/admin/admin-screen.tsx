"use client";

import Link from "next/link";
import { AdminFrame } from "@/app/admin/admin-frame";
import { LoadBlock } from "@/components/load-block";
import { MetricCard } from "@/components/metric-card";
import { PaceChip } from "@/components/pace-chip";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { buttonVariants } from "@/components/ui/button";
import { loadAdminKpi, loadInbox, loadProgressAll } from "@/lib/data";
import { darwinDateKey, formatDay, relativeOrDate } from "@/lib/darwin";
import { formatMinutes } from "@/lib/minutes";
import { addDays } from "@/lib/periods";
import {
  RISK_LABEL,
  REQUEST_STATUS_LABEL,
  requestLabel,
  type AdminKpi,
  type ProgressRow,
} from "@/lib/placement-ui";
import { useLoad } from "@/lib/use-load";

function pct(value: number | null) {
  return value == null ? "—" : `${value}%`;
}

const HEAT = [
  "bg-muted text-muted-foreground",
  "bg-ok-bg text-ok",
  "bg-lavender/50 text-foreground",
  "bg-warn-bg text-warn",
  "bg-card text-foreground ring-2 ring-inset ring-primary",
] as const;

export function AdminScreen() {
  return (
    <AdminFrame title="Overview">
      <OverviewDesk />
    </AdminFrame>
  );
}

function OverviewDesk() {
  const [kpi, reloadKpi] = useLoad(loadAdminKpi);
  const [progress, reloadProgress] = useLoad(loadProgressAll);
  const [inbox, reloadInbox] = useLoad(loadInbox);
  const today = darwinDateKey(new Date());
  const soonUntil = addDays(today, 14);

  return (
    <>
      <PageHeader title="Overview" description="How placements are tracking across the office." />
      <LoadBlock state={kpi} reload={reloadKpi} skeleton={<KpiSkeleton />}>
        {(data) => <KpiGrid kpi={data} />}
      </LoadBlock>
      <LoadBlock state={progress} reload={reloadProgress} empty="No one is at risk right now.">
        {(rows) => {
          const atRisk = rows.filter((row) => row.risk_reasons.length > 0);
          const finishing = rows.filter((row) => row.planned_end_date >= today && row.planned_end_date <= soonUntil);
          return (
            <>
              <section aria-labelledby="at-risk-title" className="flex flex-col gap-3">
                <h2 id="at-risk-title">At risk</h2>
                {atRisk.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No one is at risk right now.</p>
                ) : (
                  <RiskTable rows={atRisk} />
                )}
              </section>
              <section aria-labelledby="finishing-title" className="flex flex-col gap-3">
                <h2 id="finishing-title">Finishing soon</h2>
                <p className="text-sm text-muted-foreground">
                  {kpi.status === "ready" ? kpi.data.finishing_soon : finishing.length} placement
                  {(kpi.status === "ready" ? kpi.data.finishing_soon : finishing.length) === 1 ? "" : "s"} ending in the next 14 days.
                </p>
                {finishing.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {finishing.map((row) => (
                      <li key={row.placement_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-card p-4 shadow-card">
                        <Link href={`/admin/placement?id=${row.placement_id}`} className="font-semibold">
                          {row.intern_name}
                        </Link>
                        <span className="text-sm text-muted-foreground">{formatDay(row.planned_end_date)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            </>
          );
        }}
      </LoadBlock>
      <LoadBlock state={inbox} reload={reloadInbox} empty="No escalated requests.">
        {(rows) => {
          const escalated = rows.filter((row) => row.escalated_at || row.status === "pending_admin");
          return (
            <section aria-labelledby="escalated-title" className="flex flex-col gap-3">
              <div className="flex items-end justify-between gap-3">
                <h2 id="escalated-title">Escalated requests</h2>
                <Link href="/admin/requests" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  All requests
                </Link>
              </div>
              {escalated.length === 0 ? (
                <p className="text-sm text-muted-foreground">No escalated requests.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {escalated.map((row) => (
                    <li key={row.id} className="flex flex-col gap-2 rounded-lg bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold">
                          {requestLabel(row.type)} · {row.daymark_profiles?.display_name ?? "Intern"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {REQUEST_STATUS_LABEL[row.status] ?? row.status}
                          {row.needs_extra_spot ? " · extra spot" : ""}
                          {" · "}
                          {relativeOrDate(row.created_at, new Date())}
                        </p>
                      </div>
                      <Link href="/admin/requests" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                        Review
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        }}
      </LoadBlock>
      {kpi.status === "ready" ? <Heatmap days={kpi.data.heatmap} /> : null}
    </>
  );
}

function KpiGrid({ kpi }: { kpi: AdminKpi }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <MetricCard
        className="sm:col-span-2 xl:col-span-3"
        label="% on pace"
        value={pct(kpi.pct_on_pace)}
        sub={`${kpi.active} active placement${kpi.active === 1 ? "" : "s"}`}
        tone={kpi.pct_on_pace == null ? "neutral" : kpi.pct_on_pace >= 70 ? "ok" : kpi.pct_on_pace >= 40 ? "warn" : "bad"}
      />
      <MetricCard
        label="Active"
        value={String(kpi.active)}
        sub={`${kpi.starting_soon} starting soon · ${kpi.finishing_soon} finishing soon`}
      />
      <MetricCard
        label="Counted hours"
        value={formatMinutes(kpi.counted_fortnight)}
        sub={`${formatMinutes(kpi.counted_all_time)} all time`}
      />
      <MetricCard label="Attendance" value={pct(kpi.attendance_pct)} sub={`${pct(kpi.on_time_pct)} on time`} />
      <MetricCard
        label="No-shows"
        value={String(kpi.no_shows_fortnight)}
        sub={`${kpi.missed_punches_fortnight} missed punch${kpi.missed_punches_fortnight === 1 ? "" : "es"} this fortnight`}
        tone={kpi.no_shows_fortnight > 0 ? "warn" : "ok"}
      />
      <MetricCard
        label="Desk use"
        value={pct(kpi.desk_use_pct)}
        sub={`${kpi.days_at_four} day${kpi.days_at_four === 1 ? "" : "s"} at 4`}
        sparkline={kpi.heatmap.map((day) => day.headcount)}
      />
      <MetricCard
        label="Outcomes"
        value={String(kpi.outcomes.on_time + kpi.outcomes.late + kpi.outcomes.withdrawn)}
        sub={`${kpi.outcomes.on_time} on time · ${kpi.outcomes.late} late · ${kpi.outcomes.withdrawn} withdrawn`}
      />
      <section className="flex flex-col gap-2 rounded-lg bg-card p-6 shadow-card">
        <h3 className="caption font-semibold text-muted-foreground">Approval turnaround</h3>
        {kpi.turnaround.length === 0 ? (
          <p className="text-sm text-muted-foreground">No decisions in the last 30 days.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {kpi.turnaround.map((row) => (
              <li key={row.supervisor_id} className="flex justify-between gap-3">
                <span>{row.name}</span>
                <span className="tabular-nums">{row.median_hours} h</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-2 rounded-lg bg-card p-6 shadow-card">
        <h3 className="caption font-semibold text-muted-foreground">Interns per supervisor</h3>
        {kpi.interns_per_supervisor.length === 0 ? (
          <p className="text-sm text-muted-foreground">No supervisors yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {kpi.interns_per_supervisor.map((row) => (
              <li key={row.supervisor_id} className="flex justify-between gap-3">
                <span>{row.name}</span>
                <span className="tabular-nums">{row.interns}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RiskTable({ rows }: { rows: ProgressRow[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Intern</th>
              <th className="py-2 pr-3 font-medium">Pace</th>
              <th className="py-2 font-medium">Reasons</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.placement_id} className="border-t border-border">
                <td className="py-3 pr-3">
                  <Link href={`/admin/placement?id=${row.placement_id}`} className="font-semibold">
                    {row.intern_name}
                  </Link>
                </td>
                <td className="py-3 pr-3">
                  <PaceChip daysLate={row.days_late} />
                </td>
                <td className="py-3">
                  <div className="flex flex-wrap gap-1">
                    {row.risk_reasons.map((reason) => (
                      <StatusChip key={reason} tone="warn" label={RISK_LABEL[reason] ?? reason} />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-2 sm:hidden">
        {rows.map((row) => (
          <li key={row.placement_id} className="flex flex-col gap-2 rounded-lg bg-card p-4 shadow-card">
            <Link href={`/admin/placement?id=${row.placement_id}`} className="font-semibold">
              {row.intern_name}
            </Link>
            <PaceChip daysLate={row.days_late} />
            <div className="flex flex-wrap gap-1">
              {row.risk_reasons.map((reason) => (
                <StatusChip key={reason} tone="warn" label={RISK_LABEL[reason] ?? reason} />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function Heatmap({ days }: { days: AdminKpi["heatmap"] }) {
  return (
    <section aria-labelledby="heatmap-title" className="flex flex-col gap-3">
      <h2 id="heatmap-title">Desk use this fortnight</h2>
      <p className="text-sm text-muted-foreground">Daily headcount 0–4. A 4th intern is outlined.</p>
      <ol className="grid grid-cols-5 gap-2 sm:grid-cols-7">
        {days.map((day) => {
          const n = Math.min(4, Math.max(0, day.headcount));
          return (
            <li
              key={day.date}
              className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-md p-2 text-center ${HEAT[n]}`}
            >
              <span className="caption">{formatDay(day.date)}</span>
              <span className="text-lg font-semibold tabular-nums">{day.headcount}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function KpiSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <div className="h-32 rounded-lg bg-muted sm:col-span-2 xl:col-span-3" />
      <div className="h-28 rounded-lg bg-muted" />
      <div className="h-28 rounded-lg bg-muted" />
      <div className="h-28 rounded-lg bg-muted" />
    </div>
  );
}

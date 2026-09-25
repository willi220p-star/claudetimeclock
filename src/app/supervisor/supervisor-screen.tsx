"use client";

import { useCallback } from "react";
import Link from "next/link";
import { InboxPanel } from "@/app/supervisor/inbox-panel";
import { boardHours, boardStatusKey, loadTodayDesk, pctText } from "@/app/supervisor/supervisor";
import { DeskGate } from "@/components/desk-gate";
import { StaffShell } from "@/components/desk-shell";
import { EmptyState } from "@/components/empty-state";
import { LoadBlock } from "@/components/load-block";
import { MetricCard } from "@/components/metric-card";
import { MinutesText } from "@/components/minutes-text";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { darwinDateKey, formatDay, formatTime, formatTimeOfDay } from "@/lib/darwin";
import { formatMinutes } from "@/lib/minutes";
import { lastWeekStart } from "@/lib/periods";
import { BOARD_STATUS, RISK_LABEL, checkinOverdue, type TodayPerson } from "@/lib/placement-ui";
import { useLoad } from "@/lib/use-load";

export function SupervisorScreen() {
  return (
    <DeskGate role="supervisor">
      {(profile) => (
        <StaffShell profile={profile} role="supervisor" title="Today">
          <TodayDesk />
        </StaffShell>
      )}
    </DeskGate>
  );
}

function TodayDesk() {
  const load = useCallback(() => loadTodayDesk(), []);
  const [state, reload] = useLoad(load);

  return (
    <>
      <PageHeader title="Today" description="Who's in, what's waiting, and who's at risk." />
      <LoadBlock
        state={state}
        reload={reload}
        skeleton={
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Skeleton className="h-28 rounded-lg" />
              <Skeleton className="h-28 rounded-lg" />
              <Skeleton className="h-28 rounded-lg" />
              <Skeleton className="h-28 rounded-lg" />
              <Skeleton className="h-28 rounded-lg" />
              <Skeleton className="h-28 rounded-lg" />
            </div>
            <Skeleton className="h-48 rounded-xl" />
          </div>
        }
      >
        {({ kpi, board, inbox, progress }) => {
          const atRisk = progress.filter((row) => row.risk_reasons.length > 0);
          const placements = new Map(progress.map((row) => [row.intern_id, row.placement_id]));
          return (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <MetricCard
                  label="Approvals waiting"
                  value={String(kpi.approvals_waiting)}
                  sub={kpi.oldest_hours != null ? `Oldest ${kpi.oldest_hours} h` : "None waiting"}
                  tone={kpi.oldest_hours != null && kpi.oldest_hours > 48 ? "warn" : "neutral"}
                />
                <MetricCard
                  label="At risk"
                  value={String(kpi.at_risk)}
                  tone={kpi.at_risk > 0 ? "warn" : "ok"}
                />
                <MetricCard
                  label="Attendance / on time"
                  value={pctText(kpi.attendance_pct)}
                  sub={`On time ${pctText(kpi.on_time_pct)}`}
                />
                <MetricCard
                  label="Overtime approved"
                  value={formatMinutes(kpi.overtime_approved_minutes)}
                  sub="This fortnight"
                />
                <MetricCard label="Work logs" value={pctText(kpi.work_log_pct)} sub="This fortnight" />
                <Link href="/supervisor/summary" className="rounded-xl">
                  <MetricCard
                    label="Check-ins due"
                    value={String(kpi.checkins_due)}
                    sub={
                      kpi.last_checkin.week_start
                        ? `Last ${formatDay(kpi.last_checkin.week_start)}${
                            kpi.last_checkin.average != null ? ` · avg ${kpi.last_checkin.average.toFixed(1)}` : ""
                          }`
                        : "No check-ins yet"
                    }
                    tone={
                      kpi.checkins_due > 0 || checkinOverdue(kpi.last_checkin.week_start, lastWeekStart(darwinDateKey(new Date())))
                        ? "warn"
                        : "ok"
                    }
                    className="h-full"
                  />
                </Link>
              </div>

              <section className="flex flex-col gap-3">
                <h2>{board.label}</h2>
                {board.people.length === 0 ? (
                  <EmptyState>Nobody is on the board today.</EmptyState>
                ) : (
                  <BoardTable people={board.people} placements={placements} />
                )}
              </section>

              <section className="flex flex-col gap-3">
                <h2>Approvals</h2>
                <InboxPanel
                  items={inbox}
                  onDone={reload}
                  empty="No approvals waiting. New requests from your interns will show up here."
                />
              </section>

              <section className="flex flex-col gap-3">
                <h2>At risk</h2>
                {atRisk.length === 0 ? (
                  <EmptyState>None of your interns are at risk.</EmptyState>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {atRisk.map((row) => (
                      <li key={row.placement_id} className="flex flex-col gap-2 rounded-lg bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
                        <Link href={`/supervisor/intern?id=${row.placement_id}`} className="font-semibold">
                          {row.intern_name}
                        </Link>
                        <div className="flex flex-wrap gap-1">
                          {row.risk_reasons.map((reason) => (
                            <StatusChip key={reason} tone="warn" label={RISK_LABEL[reason] ?? reason} />
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          );
        }}
      </LoadBlock>
    </>
  );
}

function BoardTable({
  people,
  placements,
}: {
  people: TodayPerson[];
  placements: Map<string, string>;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg bg-card shadow-card sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-4 py-3 font-semibold">Intern</th>
              <th className="px-4 py-3 font-semibold">Scheduled</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Hours</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person, index) => (
              <BoardRow key={person.person_id ?? `${person.display_name}-${index}`} person={person} placementId={person.person_id ? placements.get(person.person_id) : undefined} as="tr" />
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-2 sm:hidden">
        {people.map((person, index) => (
          <BoardRow
            key={person.person_id ?? `${person.display_name}-${index}`}
            person={person}
            placementId={person.person_id ? placements.get(person.person_id) : undefined}
            as="card"
          />
        ))}
      </ul>
    </>
  );
}

function BoardRow({
  person,
  placementId,
  as,
}: {
  person: TodayPerson;
  placementId?: string;
  as: "tr" | "card";
}) {
  const key = boardStatusKey(person);
  const status = BOARD_STATUS[key] ?? { label: key, tone: "neutral" as const };
  const label =
    key === "in" && person.since ? `${status.label} ${formatTime(person.since)}` : status.label;
  const hours = boardHours(person);
  const scheduled =
    person.start && person.end ? `${formatTimeOfDay(person.start)}–${formatTimeOfDay(person.end)}` : "—";
  const name = placementId ? (
    <Link href={`/supervisor/intern?id=${placementId}`} className="font-semibold">
      {person.display_name}
    </Link>
  ) : (
    <span className="font-semibold">{person.display_name}</span>
  );
  const chips = (
    <div className="flex flex-wrap gap-1">
      <StatusChip tone={status.tone} label={label} />
      {person.late && key !== "late" ? <StatusChip tone="warn" label="Late" /> : null}
      {person.extra ? <StatusChip tone="info" label="Extra spot" /> : null}
    </div>
  );
  const hoursCell = hours == null ? "—" : <MinutesText minutes={hours} />;

  if (as === "card") {
    return (
      <li className="flex flex-col gap-2 rounded-lg bg-card p-4 shadow-card">
        {name}
        <p className="text-sm text-muted-foreground">Scheduled {scheduled}</p>
        {chips}
        <p className="text-sm">Hours {hoursCell}</p>
      </li>
    );
  }

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">{name}</td>
      <td className="px-4 py-3">{scheduled}</td>
      <td className="px-4 py-3">{chips}</td>
      <td className="px-4 py-3">{hoursCell}</td>
    </tr>
  );
}

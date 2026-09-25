"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { DeskGate } from "@/components/desk-gate";
import { StaffShell } from "@/components/desk-shell";
import { EmptyState } from "@/components/empty-state";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { StatusChip, type Tone } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { darwinDateKey, formatDay } from "@/lib/darwin";
import { loadCheckinsDue, loadMondaySummary } from "@/lib/data";
import { formatMinutes } from "@/lib/minutes";
import { addDays, lastWeekStart, mondayOf } from "@/lib/periods";
import { RISK_LABEL, asRecord, owedLabel } from "@/lib/placement-ui";
import { useLoad } from "@/lib/use-load";

type SummaryRow = Awaited<ReturnType<typeof loadMondaySummary>>[number];

// progress_rows pace (§7.8): green on plan, amber 1–5 days late, red later or no forecast.
const PACE: Record<string, { tone: Tone; label: string }> = {
  green: { tone: "ok", label: "On pace" },
  amber: { tone: "warn", label: "A little behind" },
  red: { tone: "bad", label: "Off pace" },
};

export function SummaryScreen() {
  return (
    <DeskGate role="supervisor">
      {(profile) => (
        <StaffShell profile={profile} role="supervisor" title="Summary">
          <SummaryDesk />
        </StaffShell>
      )}
    </DeskGate>
  );
}

function SummaryDesk() {
  const today = darwinDateKey(new Date());
  const thisWeek = mondayOf(today);
  const param = useSearchParams().get("week");
  const initial = param && /^\d{4}-\d{2}-\d{2}$/.test(param) && mondayOf(param) === param && param <= thisWeek
    ? param
    : lastWeekStart(today);
  const [week, setWeek] = useState(initial);
  const load = useCallback(
    () => Promise.all([loadMondaySummary(week), loadCheckinsDue()]).then(([rows, due]) => ({ rows, due })),
    [week],
  );
  const [state, reload] = useLoad(load);

  return (
    <>
      <PageHeader
        title="Monday summary"
        description={`Week of ${formatDay(week)} to ${formatDay(addDays(week, 6))}.`}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Button type="button" variant="secondary" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}>
              <ChevronLeft aria-hidden className="size-4" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              aria-label="Next week"
              disabled={week >= thisWeek}
              onClick={() => setWeek(addDays(week, 7))}
            >
              <ChevronRight aria-hidden className="size-4" />
            </Button>
            <Button type="button" variant="secondary" onClick={() => window.print()}>
              <Printer aria-hidden className="size-4" />
              Print
            </Button>
          </div>
        }
      />
      <LoadBlock
        state={state}
        reload={reload}
        skeleton={
          <div className="flex flex-col gap-3">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        }
      >
        {({ rows, due }) => (
          <>
            {due.length > 0 ? (
              <section className="flex flex-col gap-2 rounded-xl bg-card p-4 shadow-card print:hidden">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="caption font-semibold text-muted-foreground">Check-ins due</h2>
                  <StatusChip tone="warn" label={`${due.length} for the week of ${formatDay(due[0].week_start)}`} />
                </div>
                <ul className="flex flex-col">
                  {due.map((row) => (
                    <li key={row.placement_id} className="border-b border-border last:border-0">
                      <Link
                        href={`/supervisor/intern?id=${row.placement_id}&tab=checkins`}
                        className="flex min-h-11 items-center justify-between gap-2 font-semibold"
                      >
                        {row.intern_name}
                        <span className="text-sm font-normal text-primary">Check in</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {rows.length === 0 ? (
              <EmptyState>None of your interns had a live placement that week.</EmptyState>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {rows.map((row) => (
                  <SummaryCard key={row.placement_id} row={row} />
                ))}
              </ul>
            )}
          </>
        )}
      </LoadBlock>
    </>
  );
}

function SummaryCard({ row }: { row: SummaryRow }) {
  const pace = PACE[row.pace] ?? { tone: "neutral" as const, label: row.pace };
  const checkin = asRecord(row.checkin);
  const average = typeof checkin?.average === "number" ? checkin.average : null;
  const comment = typeof checkin?.comment === "string" ? checkin.comment : null;
  const facts: [string, string][] = [
    ["Counted", `${formatMinutes(row.counted)} of ${formatMinutes(row.scheduled)}`],
    ["Balance at week end", owedLabel(row.owed)],
    ["Late days", String(row.late_days)],
    ["No-shows", String(row.no_shows)],
    [
      "Overtime",
      row.overtime_pending > 0
        ? `${formatMinutes(row.overtime_approved)} approved · ${formatMinutes(row.overtime_pending)} pending`
        : `${formatMinutes(row.overtime_approved)} approved`,
    ],
    ["Work logs", `${row.work_logs} of ${row.days_worked} ${row.days_worked === 1 ? "day" : "days"} worked`],
    ["Requests waiting", String(row.pending_requests)],
  ];

  return (
    <li className="flex break-inside-avoid flex-col gap-3 rounded-xl bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/supervisor/intern?id=${row.placement_id}`} className="font-semibold">
          {row.intern_name}
        </Link>
        <StatusChip tone={pace.tone} label={pace.label} />
      </div>
      {row.risk_reasons.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {row.risk_reasons.map((reason) => (
            <StatusChip key={reason} tone="warn" label={RISK_LABEL[reason] ?? reason} />
          ))}
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="caption text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
        <p className="caption text-muted-foreground">Check-in</p>
        {average == null ? (
          <Link href={`/supervisor/intern?id=${row.placement_id}&tab=checkins`} className="text-primary print:text-foreground">
            No check-in for this week
          </Link>
        ) : (
          <p>
            Average {average.toFixed(1)} of 5{comment ? ` · ${comment}` : ""}
          </p>
        )}
      </div>
    </li>
  );
}

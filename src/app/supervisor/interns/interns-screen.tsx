"use client";

import { useCallback } from "react";
import Link from "next/link";
import { forecastText, owedText, pctText } from "@/app/supervisor/supervisor";
import { DeskGate } from "@/components/desk-gate";
import { StaffShell } from "@/components/desk-shell";
import { LoadBlock } from "@/components/load-block";
import { PaceChip } from "@/components/pace-chip";
import { PageHeader } from "@/components/page-header";
import { StatusChip } from "@/components/status-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDay } from "@/lib/darwin";
import { loadProgressForSupervisor } from "@/lib/data";
import { PLACEMENT_STATUS_LABEL, RISK_LABEL } from "@/lib/placement-ui";
import { useLoad } from "@/lib/use-load";

export function InternsScreen() {
  return (
    <DeskGate role="supervisor">
      {(profile) => (
        <StaffShell profile={profile} role="supervisor" title="Interns">
          <InternsDesk />
        </StaffShell>
      )}
    </DeskGate>
  );
}

function InternsDesk() {
  const load = useCallback(() => loadProgressForSupervisor(), []);
  const [state, reload] = useLoad(load);

  return (
    <>
      <PageHeader title="Interns" description="Pace, forecast and attendance for your placements." />
      <LoadBlock
        state={state}
        reload={reload}
        empty="You don't have any interns on a live placement."
        skeleton={
          <div className="flex flex-col gap-2">
            <Skeleton className="h-28 rounded-lg" />
            <Skeleton className="h-28 rounded-lg" />
          </div>
        }
      >
        {(rows) => (
          <>
            <div className="hidden overflow-x-auto rounded-lg bg-card shadow-card sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 font-semibold">Intern</th>
                    <th className="px-4 py-3 font-semibold">Pace</th>
                    <th className="px-4 py-3 font-semibold">Forecast vs plan</th>
                    <th className="px-4 py-3 font-semibold">Owed</th>
                    <th className="px-4 py-3 font-semibold">Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.placement_id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <Link href={`/supervisor/intern?id=${row.placement_id}`} className="font-semibold">
                          {row.intern_name}
                        </Link>
                        <p className="text-muted-foreground">{PLACEMENT_STATUS_LABEL[row.status] ?? row.status}</p>
                      </td>
                      <td className="px-4 py-3">
                        <PaceChip daysLate={row.days_late} />
                      </td>
                      <td className="px-4 py-3">{forecastText(row, formatDay)}</td>
                      <td className="px-4 py-3">{owedText(row.owed)}</td>
                      <td className="px-4 py-3">{pctText(row.attendance_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="flex flex-col gap-2 sm:hidden">
              {rows.map((row) => (
                <li key={row.placement_id} className="flex flex-col gap-2 rounded-lg bg-card p-4 shadow-card">
                  <Link href={`/supervisor/intern?id=${row.placement_id}`} className="font-semibold">
                    {row.intern_name}
                  </Link>
                  <PaceChip daysLate={row.days_late} />
                  <p className="text-sm">{forecastText(row, formatDay)}</p>
                  <p className="text-sm text-muted-foreground">Owed {owedText(row.owed)}</p>
                  {row.attendance_pct != null ? (
                    <p className="text-sm text-muted-foreground">Attendance {pctText(row.attendance_pct)}</p>
                  ) : null}
                  {row.risk_reasons.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {row.risk_reasons.map((reason) => (
                        <StatusChip key={reason} tone="warn" label={RISK_LABEL[reason] ?? reason} />
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </LoadBlock>
    </>
  );
}

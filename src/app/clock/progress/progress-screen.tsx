"use client";

import { useCallback } from "react";
import { InternFrame } from "@/app/clock/intern-frame";
import { DeskGate } from "@/components/desk-gate";
import { LoadBlock } from "@/components/load-block";
import { MinutesText } from "@/components/minutes-text";
import { PaceChip } from "@/components/pace-chip";
import { PageHeader } from "@/components/page-header";
import { ProgressRing } from "@/components/progress-ring";
import { formatDay } from "@/lib/darwin";
import { loadInternKpi, loadMyPlacement, loadWeekHours } from "@/lib/data";
import { formatMinutes } from "@/lib/minutes";
import { useLoad } from "@/lib/use-load";

export function ProgressScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <InternFrame profile={profile} title="Progress">
          <ProgressDesk />
        </InternFrame>
      )}
    </DeskGate>
  );
}

function ProgressDesk() {
  const load = useCallback(async () => {
    const [kpi, placement] = await Promise.all([loadInternKpi(), loadMyPlacement()]);
    const weeks = placement ? await loadWeekHours(placement.id) : [];
    return { kpi, weeks };
  }, []);
  const [state, reload] = useLoad(load);

  return (
    <>
      <PageHeader title="Progress" description="Hours counted against your target. The forecast is written as text." />
      <LoadBlock state={state} reload={reload} empty="No placement hours yet.">
        {({ kpi, weeks }) =>
          kpi ? (
            <div className="flex flex-col gap-6">
              <section className="flex flex-col items-center gap-3 rounded-xl bg-card p-6 shadow-card">
                <ProgressRing
                  counted={kpi.counted_total}
                  target={kpi.target_minutes}
                  label={`${formatMinutes(kpi.counted_total)} of ${formatMinutes(kpi.target_minutes)} counted`}
                >
                  <p className="text-sm font-semibold">
                    <MinutesText minutes={kpi.remaining} /> left
                  </p>
                </ProgressRing>
                <p>
                  Week {kpi.week_no} of {kpi.total_weeks}
                </p>
                <PaceChip daysLate={kpi.days_late} />
                <p className="text-center text-muted-foreground">
                  {kpi.forecast_finish
                    ? `Finishes ${formatDay(kpi.forecast_finish)}${forecastLag(kpi.days_late)}`
                    : "Can't forecast"}
                </p>
              </section>
              <section className="flex flex-col gap-3">
                <h2>Weekly hours</h2>
                {weeks.length === 0 ? (
                  <p className="text-muted-foreground">No weekly totals yet.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {weeks.map((week) => {
                      const scheduled = week.scheduled ?? 0;
                      const counted = week.counted ?? 0;
                      const width = scheduled > 0 ? Math.min(100, Math.round((counted / scheduled) * 100)) : 0;
                      return (
                        <li key={week.week_start ?? week.week_no} className="flex flex-col gap-1">
                          <div className="flex justify-between text-sm">
                            <span>Week {week.week_no}</span>
                            <span>
                              <MinutesText minutes={counted} /> / <MinutesText minutes={scheduled} />
                            </span>
                          </div>
                          <div className="h-3 rounded-md bg-muted">
                            <div className="h-3 rounded-md bg-teal" style={{ width: `${width}%` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              <p className="text-sm text-muted-foreground">
                On time {kpi.on_time_pct ?? "—"}% · Attendance {kpi.attendance_pct ?? "—"}% · Work-log streak{" "}
                {kpi.work_log_streak}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground">No progress yet.</p>
          )
        }
      </LoadBlock>
    </>
  );
}

function forecastLag(daysLate: number | null) {
  if (daysLate === null) return "";
  if (daysLate === 0) return " · on plan";
  if (daysLate < 0) return ` · ${-daysLate} days early`;
  return ` · ${daysLate} ${daysLate === 1 ? "day" : "days"} late`;
}

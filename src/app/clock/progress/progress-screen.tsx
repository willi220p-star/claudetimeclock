"use client";

import { useCallback } from "react";
import { InternShell } from "@/components/desk-shell";
import { DeskGate } from "@/components/desk-gate";
import { LoadBlock } from "@/components/load-block";
import { MinutesText } from "@/components/minutes-text";
import { PaceChip } from "@/components/pace-chip";
import { PageHeader } from "@/components/page-header";
import { ProgressRing } from "@/components/progress-ring";
import { ForecastChart } from "@/components/forecast-chart";
import { formatDay } from "@/lib/darwin";
import { loadFortnightHours, loadInternKpi, loadMyPlacement, loadPlacementProgress, loadWeekHours } from "@/lib/data";
import { formatMinutes } from "@/lib/minutes";
import { weekNo } from "@/lib/periods";
import { forecastSeries, fortnightLabel, type InternKpi } from "@/lib/placement-ui";
import { useLoad } from "@/lib/use-load";

export function ProgressScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <InternShell profile={profile} title="Progress">
          <ProgressDesk />
        </InternShell>
      )}
    </DeskGate>
  );
}

function ProgressDesk() {
  const load = useCallback(async () => {
    const [kpi, placement] = await Promise.all([loadInternKpi(), loadMyPlacement()]);
    if (!placement) return { kpi, weeks: [], progress: null, fortnight: null };
    const [weeks, progress] = await Promise.all([loadWeekHours(placement.id), loadPlacementProgress(placement.id)]);
    const fortnight =
      progress?.fortnight_start && progress.fortnight_end
        ? {
            start: progress.fortnight_start,
            end: progress.fortnight_end,
            ...(await loadFortnightHours(placement.id, progress.fortnight_start)),
          }
        : null;
    return { kpi, weeks, progress, fortnight };
  }, []);
  const [state, reload] = useLoad(load);

  return (
    <>
      <PageHeader title="Progress" description="Hours counted against your target. The forecast is written as text." />
      <LoadBlock state={state} reload={reload} empty="No placement hours yet.">
        {({ kpi, weeks, progress, fortnight }) =>
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
              {fortnight ? (
                <section aria-labelledby="fortnight-title" className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card">
                  <p className="caption text-muted-foreground">Visa self-check</p>
                  <h2 id="fortnight-title" className="text-[17px] leading-snug font-semibold">
                    {fortnightLabel(fortnight.start, fortnight.end, fortnight.counted)}
                  </h2>
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Counted</dt>
                      <dd className="font-semibold">
                        <MinutesText minutes={fortnight.counted} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Scheduled</dt>
                      <dd className="font-semibold">
                        <MinutesText minutes={fortnight.scheduled} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Worked</dt>
                      <dd className="font-semibold">
                        <MinutesText minutes={fortnight.worked} />
                      </dd>
                    </div>
                  </dl>
                  <p className="text-sm text-muted-foreground">
                    Worked is your time on the clock; counted is what goes toward your placement. Check the limits on your
                    own visa.
                  </p>
                </section>
              ) : null}
              {progress ? <ForecastCard kpi={kpi} weeks={weeks} progress={progress} /> : null}
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

type Progress = NonNullable<Awaited<ReturnType<typeof loadPlacementProgress>>>;

function ForecastCard({
  kpi,
  weeks,
  progress,
}: {
  kpi: InternKpi;
  weeks: Awaited<ReturnType<typeof loadWeekHours>>;
  progress: Progress;
}) {
  const start = progress.start_date;
  const forecastWeek = progress.forecast_finish && start ? weekNo(progress.forecast_finish, start) : null;
  const target = progress.target_minutes ?? kpi.target_minutes;
  const points = forecastSeries({
    weeks,
    targetMinutes: target,
    totalWeeks: progress.total_weeks ?? kpi.total_weeks,
    currentWeek: progress.week_no ?? kpi.week_no,
    forecastWeek,
  });
  const summary =
    `Cumulative counted hours by week: ${formatMinutes(kpi.counted_total)} of ${formatMinutes(target)} by week ` +
    `${kpi.week_no} of ${kpi.total_weeks}. ` +
    (progress.forecast_finish
      ? `Forecast finish ${formatDay(progress.forecast_finish)}, week ${forecastWeek}${forecastLag(kpi.days_late)}.`
      : "No forecast yet.");
  return (
    <section aria-labelledby="forecast-title" className="flex flex-col gap-2 rounded-xl bg-card p-4 shadow-card">
      <p className="caption text-muted-foreground">Forecast</p>
      <h2 id="forecast-title" className="text-[17px] leading-snug font-semibold">
        Hours to target
      </h2>
      <ForecastChart points={points} targetHours={Math.round(target / 6) / 10} forecastWeek={forecastWeek} summary={summary} />
    </section>
  );
}

function forecastLag(daysLate: number | null) {
  if (daysLate === null) return "";
  if (daysLate === 0) return " · on plan";
  if (daysLate < 0) return ` · ${-daysLate} days early`;
  return ` · ${daysLate} ${daysLate === 1 ? "day" : "days"} late`;
}

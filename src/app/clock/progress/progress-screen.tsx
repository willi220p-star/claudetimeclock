"use client";

import { useCallback } from "react";
import { BarsChart, ChartCard, ChartTable } from "@/components/bar-chart";
import { InternShell } from "@/components/desk-shell";
import { DeskGate } from "@/components/desk-gate";
import { LoadBlock } from "@/components/load-block";
import { MinutesText } from "@/components/minutes-text";
import { PaceChip } from "@/components/pace-chip";
import { PageHeader } from "@/components/page-header";
import { ProgressRing } from "@/components/progress-ring";
import { ForecastChart } from "@/components/forecast-chart";
import { attendanceBreakdown, sessionSpan, weekByDay, weeklyBars } from "@/lib/chart-data";
import { darwinDateKey, formatDay } from "@/lib/darwin";
import type { Profile } from "@/lib/daymark";
import {
  loadDayResults,
  loadInternKpi,
  loadMyPlacement,
  loadPlacementProgress,
  loadScheduledDays,
  loadWeekHours,
} from "@/lib/data";
import { formatMinutes } from "@/lib/minutes";
import { addDays, mondayOf, weekNo } from "@/lib/periods";
import { loadPunches } from "@/lib/punches";
import { forecastSeries, type InternKpi } from "@/lib/placement-ui";
import { useLoad } from "@/lib/use-load";

export function ProgressScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <InternShell profile={profile} title="Progress">
          <ProgressDesk profile={profile} />
        </InternShell>
      )}
    </DeskGate>
  );
}

function ProgressDesk({ profile }: { profile: Profile }) {
  const load = useCallback(async () => {
    const now = new Date();
    const today = darwinDateKey(now);
    const weekStart = mondayOf(today);
    const [kpi, placement, punches] = await Promise.all([
      loadInternKpi(),
      loadMyPlacement(),
      // ponytail: 200 punches covers a week of breaks; raise if anyone clocks more.
      loadPunches({ userId: profile.id, since: `${weekStart}T00:00:00+09:30`, limit: 200 }),
    ]);
    if (!placement) return { kpi, weeks: [], progress: null, week: weekByDay(punches, weekStart, now), attendance: null };
    const [weeks, progress, results, days] = await Promise.all([
      loadWeekHours(placement.id),
      loadPlacementProgress(placement.id),
      loadDayResults(placement.id, placement.start_date, addDays(weekStart, 6)),
      loadScheduledDays(placement.id, placement.start_date, today),
    ]);
    return {
      kpi,
      weeks,
      progress,
      week: weekByDay(punches, weekStart, now, results),
      attendance: attendanceBreakdown(days, results.filter((row) => row.work_date <= today)),
    };
  }, [profile.id]);
  const [state, reload] = useLoad(load);

  return (
    <>
      <PageHeader title="Progress" description="Hours counted against your target. The forecast is written as text." />
      <LoadBlock state={state} reload={reload} empty="No placement hours yet.">
        {({ kpi, weeks, progress, week, attendance }) =>
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
              {progress ? <ForecastCard kpi={kpi} weeks={weeks} progress={progress} /> : null}
              <WeekCard week={week} />
              <WeeklyCard weeks={weeks} />
              {attendance ? <AttendanceCard rows={attendance} /> : null}
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

type Week = ReturnType<typeof weekByDay>;

/** "Your total this week, per day and per shift": clocked time from your punches. */
function WeekCard({ week }: { week: Week }) {
  const worked = week.days.filter((day) => day.minutes > 0);
  const summary =
    worked.length === 0
      ? "No time clocked this week yet."
      : `${formatMinutes(week.total)} clocked this week: ` +
        worked.map((day) => `${day.label} ${formatMinutes(day.minutes)}`).join(", ") +
        ".";
  return (
    <ChartCard
      id="this-week"
      title={`This week · ${formatMinutes(week.total)}`}
      summary={summary}
      table={
        <ChartTable
          columns={["Day", "Shift", "Time"]}
          rows={week.days.flatMap((day) => [
            ...day.sessions.map((session, index) => ({
              key: session.id,
              cells: [formatDay(day.date), `Shift ${index + 1}: ${sessionSpan(session)}`, formatMinutes(session.minutes)],
            })),
            ...(day.sessions.length > 1 || (day.counted !== null && day.counted !== day.minutes)
              ? [
                  {
                    key: `${day.date}-total`,
                    cells: [
                      `${day.label} total`,
                      day.counted !== null ? `Counted ${formatMinutes(day.counted)}` : "",
                      formatMinutes(day.minutes),
                    ],
                  },
                ]
              : []),
          ])}
        />
      }
    >
      <BarsChart
        data={week.days}
        category="label"
        series={[{ key: "hours", name: "Clocked", color: "var(--primary)" }]}
        detail={(day) => [
          ...day.sessions.map((session, index) => `Shift ${index + 1}: ${sessionSpan(session)} · ${formatMinutes(session.minutes)}`),
          ...(day.counted !== null ? [`Counted ${formatMinutes(day.counted)}`] : []),
        ]}
      />
    </ChartCard>
  );
}

function WeeklyCard({ weeks }: { weeks: Awaited<ReturnType<typeof loadWeekHours>> }) {
  if (weeks.length === 0) {
    return (
      <section className="flex flex-col gap-2 rounded-xl bg-card p-4 shadow-card">
        <h2 className="text-[17px] leading-snug font-semibold">Weekly hours</h2>
        <p className="text-muted-foreground">No weekly totals yet.</p>
      </section>
    );
  }
  const counted = weeks.reduce((sum, week) => sum + (week.counted ?? 0), 0);
  const rostered = weeks.reduce((sum, week) => sum + (week.scheduled ?? 0), 0);
  return (
    <ChartCard
      id="weekly-hours"
      title="Weekly hours vs rostered"
      summary={`${formatMinutes(counted)} counted of ${formatMinutes(rostered)} rostered over ${weeks.length} ${weeks.length === 1 ? "week" : "weeks"}.`}
      table={
        <ChartTable
          columns={["Week", "Counted", "Rostered"]}
          rows={weeks.map((week) => ({
            key: week.week_start ?? String(week.week_no),
            cells: [`Week ${week.week_no}`, formatMinutes(week.counted ?? 0), formatMinutes(week.scheduled ?? 0)],
          }))}
        />
      }
    >
      <BarsChart
        data={weeklyBars(weeks)}
        category="label"
        series={[
          { key: "rostered", name: "Rostered", color: "var(--ash)" },
          { key: "counted", name: "Counted", color: "var(--primary)" },
        ]}
      />
    </ChartCard>
  );
}

function AttendanceCard({ rows }: { rows: ReturnType<typeof attendanceBreakdown> }) {
  const dayText = (days: number) => `${days} ${days === 1 ? "day" : "days"}`;
  return (
    <ChartCard
      id="attendance"
      title="Attendance so far"
      summary={rows.map((row) => `${row.label} ${dayText(row.days)}`).join(", ") + "."}
      table={<ChartTable columns={["", "Days"]} rows={rows.map((row) => ({ key: row.key, cells: [row.label, row.days] }))} />}
    >
      <BarsChart
        data={rows}
        category="label"
        horizontal
        series={[{ key: "days", name: "Days", color: "var(--primary)" }]}
        valueText={dayText}
        tickText={String}
      />
    </ChartCard>
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

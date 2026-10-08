"use client";

import Link from "next/link";
import { owedText, pctText } from "@/app/supervisor/supervisor";
import { BarsChart, ChartCard, ChartTable } from "@/components/bar-chart";
import { DeskGate } from "@/components/desk-gate";
import { StaffShell } from "@/components/desk-shell";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { attendanceRates, hoursOf, owedRanking, periodHours } from "@/lib/chart-data";
import { darwinDateKey, formatDay } from "@/lib/darwin";
import { loadDayResults, loadProgressForSupervisor, loadScheduledDays } from "@/lib/data";
import { formatMinutes } from "@/lib/minutes";
import { addDays } from "@/lib/periods";
import { useLoad } from "@/lib/use-load";

export function SupervisorProgressScreen() {
  return (
    <DeskGate role="supervisor">
      {(profile) => (
        <StaffShell profile={profile} role="supervisor" title="Progress">
          <ProgressDesk />
        </StaffShell>
      )}
    </DeskGate>
  );
}

const percent = (value: number) => `${value}%`;

async function loadFortnight() {
  const rows = await loadProgressForSupervisor();
  const today = darwinDateKey(new Date());
  const from = rows[0]?.fortnight_start ?? addDays(today, -13);
  const to = rows[0]?.fortnight_end ?? today;
  // ponytail: two queries per intern; fine for a supervisor's handful. One RPC if that grows.
  const interns = await Promise.all(
    rows.map(async (row) => {
      const [results, days] = await Promise.all([
        loadDayResults(row.placement_id, row.start_date, to),
        loadScheduledDays(row.placement_id, from, to),
      ]);
      const hours = periodHours(results, days, from, to);
      return {
        id: row.placement_id,
        name: row.intern_name,
        owed: row.owed,
        counted: hours.counted,
        rostered: hours.rostered,
        ...attendanceRates(results),
      };
    }),
  );
  return { from, to, rows, interns };
}

function ProgressDesk() {
  const [state, reload] = useLoad(loadFortnight);

  return (
    <>
      <PageHeader title="Progress" description="Hours this fortnight against the roster, attendance and hours owed. Tap a bar for its numbers." />
      <LoadBlock state={state} reload={reload}>
        {({ from, to, rows, interns }) =>
          interns.length === 0 ? (
            <p className="text-muted-foreground">You don&apos;t have any interns on a live placement.</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                id="fortnight"
                title={`Hours this fortnight · ${formatDay(from)} – ${formatDay(to)}`}
                summary={interns.map((row) => `${row.name} ${formatMinutes(row.counted)} of ${formatMinutes(row.rostered)}`).join("; ") + "."}
              >
                <BarsChart
                  horizontal
                  category="name"
                  data={interns.map((row) => ({ name: row.name, counted: hoursOf(row.counted), rostered: hoursOf(row.rostered) }))}
                  series={[
                    { key: "rostered", name: "Rostered", color: "var(--ash)" },
                    { key: "counted", name: "Counted", color: "var(--primary)" },
                  ]}
                />
              </ChartCard>
              <ChartCard
                id="attendance"
                title="Attendance and on time"
                summary={interns.map((row) => `${row.name} attendance ${pctText(row.attendancePct)}, on time ${pctText(row.onTimePct)}`).join("; ") + "."}
              >
                <BarsChart
                  horizontal
                  category="name"
                  data={interns.map((row) => ({ name: row.name, attendance: row.attendancePct, onTime: row.onTimePct }))}
                  series={[
                    { key: "attendance", name: "Attendance", color: "var(--primary)" },
                    { key: "onTime", name: "On time", color: "var(--teal)" },
                  ]}
                  valueText={percent}
                  tickText={percent}
                  domainMax={100}
                />
              </ChartCard>
              <OwedCard rows={rows} />
              <section aria-labelledby="interns-title" className="flex min-w-0 flex-col gap-2 rounded-xl bg-card p-4 shadow-card">
                <h2 id="interns-title" className="text-[17px] leading-snug font-semibold">
                  Interns
                </h2>
                <div className="overflow-x-auto">
                  <ChartTable
                    columns={["Intern", "Fortnight", "Attendance", "On time", "Owed"]}
                    rows={interns.map((row) => ({
                      key: row.id,
                      cells: [
                        <Link key="name" href={`/supervisor/intern?id=${row.id}`} className="font-semibold text-primary">
                          {row.name}
                        </Link>,
                        `${formatMinutes(row.counted)} / ${formatMinutes(row.rostered)}`,
                        pctText(row.attendancePct),
                        pctText(row.onTimePct),
                        owedText(row.owed),
                      ],
                    }))}
                  />
                </div>
              </section>
            </div>
          )
        }
      </LoadBlock>
    </>
  );
}

function OwedCard({ rows }: { rows: Awaited<ReturnType<typeof loadProgressForSupervisor>> }) {
  const ranking = owedRanking(rows);
  return (
    <ChartCard
      id="owed"
      title="Hours owed"
      summary={
        ranking.length === 0
          ? "Nobody owes hours."
          : ranking.map((row) => `${row.label} owes ${formatMinutes(row.owed)}`).join("; ") + "."
      }
    >
      {ranking.length > 0 ? (
        <BarsChart horizontal category="label" data={ranking} series={[{ key: "hours", name: "Owed", color: "var(--primary)" }]} />
      ) : null}
    </ChartCard>
  );
}

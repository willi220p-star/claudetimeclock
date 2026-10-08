"use client";

import Link from "next/link";
import { AdminFrame } from "@/app/admin/admin-frame";
import { BarsChart, ChartCard, ChartTable } from "@/components/bar-chart";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { progressToTarget, requestStats } from "@/lib/chart-data";
import { darwinDateKey, formatDay } from "@/lib/darwin";
import { loadHeadcounts, loadProgressAll, loadRequestStatuses, loadSites } from "@/lib/data";
import { formatMinutes } from "@/lib/minutes";
import { addDays } from "@/lib/periods";
import { useLoad } from "@/lib/use-load";

export function AdminProgressScreen() {
  return (
    <AdminFrame title="Progress">
      <ProgressDesk />
    </AdminFrame>
  );
}

const percent = (value: number) => `${value}%`;
const count = (value: number) => String(value);

async function loadAll() {
  const now = new Date();
  const today = darwinDateKey(now);
  const to = addDays(today, 13);
  const [progress, sites, requests] = await Promise.all([loadProgressAll(), loadSites(), loadRequestStatuses()]);
  const offices = await Promise.all(
    sites
      .filter((site) => site.active)
      .map(async (site) => ({ site, days: await loadHeadcounts(today, to, site.id) })),
  );
  return { today, to, targets: progressToTarget(progress), offices, requests: requestStats(requests, now) };
}

function ProgressDesk() {
  const [state, reload] = useLoad(loadAll);

  return (
    <>
      <PageHeader title="Progress" description="Every intern against target, office bookings against capacity, and requests. Tap a bar for its numbers." />
      <LoadBlock state={state} reload={reload}>
        {({ today, to, targets, offices, requests }) => (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              id="targets"
              title="Progress to target"
              summary={
                targets.length === 0
                  ? "No live placements."
                  : targets.map((row) => `${row.label} ${row.pct}%`).join("; ") + "."
              }
              table={
                <ChartTable
                  columns={["Intern", "Counted", "Target"]}
                  rows={targets.map((row) => ({
                    key: row.id,
                    cells: [
                      <Link key="name" href={`/admin/placement?id=${row.id}`} className="font-semibold text-primary">
                        {row.label}
                      </Link>,
                      `${formatMinutes(row.counted)} (${row.pct}%)`,
                      formatMinutes(row.target),
                    ],
                  }))}
                />
              }
            >
              {targets.length > 0 ? (
                <BarsChart
                  horizontal
                  category="label"
                  data={targets}
                  series={[{ key: "pct", name: "Of target", color: "var(--primary)" }]}
                  valueText={percent}
                  tickText={percent}
                  domainMax={100}
                  detail={(row) => [`${formatMinutes(row.counted)} of ${formatMinutes(row.target)}`]}
                />
              ) : null}
            </ChartCard>
            {offices.map(({ site, days }) => {
              const over = days.filter((day) => day.headcount > site.standard_capacity);
              return (
                <ChartCard
                  key={site.id}
                  id={`office-${site.id}`}
                  title={`${site.name} · next two weeks`}
                  summary={
                    `Rostered per day ${formatDay(today)} to ${formatDay(to)} against a normal capacity of ` +
                    `${site.standard_capacity} and a maximum of ${site.hard_capacity}. ` +
                    (over.length === 0
                      ? "No day is over normal capacity."
                      : `Over normal capacity: ${over.map((day) => `${formatDay(day.work_date)} (${day.headcount})`).join(", ")}.`)
                  }
                  table={
                    <ChartTable
                      columns={["Day", "Rostered", "Capacity"]}
                      rows={days.map((day) => ({ key: day.work_date, cells: [formatDay(day.work_date), day.headcount, day.label] }))}
                    />
                  }
                >
                  <BarsChart
                    category="day"
                    data={days.map((day) => ({ ...day, day: day.work_date.slice(8).replace(/^0/, "") }))}
                    series={[{ key: "headcount", name: "Rostered", color: "var(--primary)" }]}
                    valueText={count}
                    tickText={count}
                    tipTitle={(day) => formatDay(day.work_date)}
                    detail={(day) => [day.label]}
                    domainMax={Math.max(site.hard_capacity, ...days.map((day) => day.headcount))}
                    references={[
                      { value: site.standard_capacity, label: "Normal" },
                      { value: site.hard_capacity, label: "Max" },
                    ]}
                  />
                </ChartCard>
              );
            })}
            <ChartCard
              id="request-status"
              title="Requests by status"
              summary={requests.byStatus.map((row) => `${row.label} ${row.count}`).join("; ") + "."}
              table={<ChartTable columns={["Status", "Requests"]} rows={requests.byStatus.map((row) => ({ key: row.key, cells: [row.label, row.count] }))} />}
            >
              <BarsChart
                horizontal
                category="label"
                data={requests.byStatus}
                series={[{ key: "count", name: "Requests", color: "var(--primary)" }]}
                valueText={count}
                tickText={count}
              />
            </ChartCard>
            <ChartCard
              id="request-age"
              title="Waiting requests by age"
              summary={requests.byAge.map((row) => `${row.label} ${row.count}`).join("; ") + "."}
              table={<ChartTable columns={["Waiting", "Requests"]} rows={requests.byAge.map((row) => ({ key: row.label, cells: [row.label, row.count] }))} />}
            >
              <BarsChart
                category="label"
                data={requests.byAge}
                series={[{ key: "count", name: "Requests", color: "var(--primary)" }]}
                valueText={count}
                tickText={count}
              />
            </ChartCard>
          </div>
        )}
      </LoadBlock>
    </>
  );
}

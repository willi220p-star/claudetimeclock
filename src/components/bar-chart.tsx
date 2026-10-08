"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMinutes } from "@/lib/minutes";

const TICK = { fill: "var(--muted-foreground)", fontSize: 12 };

export type BarSeries = { key: string; name: string; color: string };

/** Hours (one decimal) back to "7h 30m". */
export const hoursText = (value: number) => formatMinutes(Math.round(value * 60));

/**
 * A titled chart card. The chart is one image for screen readers, described by `summary`; every
 * number in it is also in the table under "Show the numbers", so the tooltip never gates a value.
 */
export function ChartCard({
  id,
  title,
  summary,
  table,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  table?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-2 rounded-xl bg-card p-4 shadow-card">
      <h2 id={`${id}-title`} className="text-[17px] leading-snug font-semibold">
        {title}
      </h2>
      {children ? (
        <figure role="img" aria-labelledby={`${id}-title`} aria-describedby={`${id}-summary`} className="m-0">
          {children}
        </figure>
      ) : null}
      <p id={`${id}-summary`} className="text-sm text-muted-foreground">
        {summary}
      </p>
      {table ? (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer content-center font-medium text-primary">Show the numbers</summary>
          <div className="overflow-x-auto">{table}</div>
        </details>
      ) : null}
    </section>
  );
}

/** A plain table for ChartCard: the first column is the row header. */
export function ChartTable({ columns, rows }: { columns: string[]; rows: { key: string; cells: ReactNode[] }[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left">
          {columns.map((column) => (
            <th key={column} scope="col" className="py-2 pr-3 font-semibold">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-border last:border-0">
            {row.cells.map((cell, index) =>
              index === 0 ? (
                <th key={index} scope="row" className="py-2 pr-3 text-left font-normal">
                  {cell}
                </th>
              ) : (
                <td key={index} className="py-2 pr-3 tabular-nums">
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type TipEntry = { name?: unknown; value?: unknown; color?: string; payload?: unknown };

function TipBox<T>({
  active,
  payload,
  label,
  valueText,
  detail,
  tipTitle,
}: {
  active?: boolean;
  payload?: readonly TipEntry[];
  label?: unknown;
  valueText: (value: number) => string;
  detail?: (row: T) => string[];
  tipTitle?: (row: T) => string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as T;
  return (
    <div className="max-w-64 rounded-xl border border-border bg-card px-3 py-2 text-[13px] shadow-card">
      <p className="font-semibold">{tipTitle ? tipTitle(row) : String(label ?? "")}</p>
      {payload.map((entry) => (
        <p key={String(entry.name)} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-3 rounded-full" style={{ background: entry.color }} />
          <span className="font-semibold">{typeof entry.value === "number" ? valueText(entry.value) : "—"}</span>
          <span className="text-muted-foreground">{String(entry.name ?? "")}</span>
        </p>
      ))}
      {detail?.(row).map((line) => (
        <p key={line} className="text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * Bars from the theme tokens, tap or hover for values. `horizontal` lists categories down the side
 * (names read at 390 px); otherwise categories run along the bottom. Two or more series get a legend.
 */
export function BarsChart<T extends object>({
  data,
  category,
  series,
  horizontal = false,
  valueText = hoursText,
  tickText = (value: number) => `${value}h`,
  detail,
  tipTitle,
  references = [],
  domainMax,
}: {
  data: T[];
  category: keyof T & string;
  series: BarSeries[];
  horizontal?: boolean;
  valueText?: (value: number) => string;
  tickText?: (value: number) => string;
  detail?: (row: T) => string[];
  tipTitle?: (row: T) => string;
  references?: { value: number; label: string }[];
  domainMax?: number;
}) {
  const band = series.length * 12 + 14;
  const height = horizontal ? data.length * band + 56 : 240;
  const radius: [number, number, number, number] = horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
  const valueAxis = {
    type: "number" as const,
    tickLine: false,
    axisLine: false,
    tick: TICK,
    tickFormatter: tickText,
    allowDecimals: false,
    domain: [0, domainMax ?? "auto"] as [number, number | "auto"],
  };
  const categoryAxis = {
    type: "category" as const,
    dataKey: category as string,
    tickLine: false,
    axisLine: { stroke: "var(--border)" },
    tick: TICK,
    interval: 0 as const,
  };
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 12, bottom: 0, left: horizontal ? 0 : -16 }}
          barGap={2}
          barCategoryGap={horizontal ? 6 : "20%"}
          accessibilityLayer={false}
        >
          <CartesianGrid horizontal={!horizontal} vertical={horizontal} stroke="var(--border)" />
          {horizontal ? (
            <>
              <XAxis {...valueAxis} />
              <YAxis
                {...categoryAxis}
                width={96}
                tickFormatter={(value: string) => (value.length > 13 ? `${value.slice(0, 12)}…` : value)}
              />
            </>
          ) : (
            <>
              <XAxis {...categoryAxis} interval={data.length > 14 ? "preserveStartEnd" : 0} />
              <YAxis {...valueAxis} width={48} />
            </>
          )}
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            content={(props) => <TipBox<T> {...props} valueText={valueText} detail={detail} tipTitle={tipTitle} />}
          />
          {series.length > 1 ? (
            <Legend
              iconType="square"
              iconSize={10}
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value) => <span className="text-muted-foreground">{value}</span>}
            />
          ) : null}
          {references.map((line) => (
            <ReferenceLine
              key={line.label}
              {...(horizontal ? { x: line.value } : { y: line.value })}
              stroke="var(--muted-foreground)"
              strokeDasharray="2 4"
              label={{ value: line.label, position: horizontal ? "top" : "insideTopRight", fill: "var(--muted-foreground)", fontSize: 12 }}
            />
          ))}
          {series.map((item) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.name}
              fill={item.color}
              radius={radius}
              maxBarSize={28}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

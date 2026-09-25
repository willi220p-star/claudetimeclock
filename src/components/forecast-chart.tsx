"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ForecastPoint } from "@/lib/placement-ui";
import { formatMinutes } from "@/lib/minutes";

const TICK = { fill: "var(--muted-foreground)", fontSize: 12 };

function hoursText(value: unknown) {
  return typeof value === "number" ? formatMinutes(Math.round(value * 60)) : String(value ?? "");
}

/**
 * Cumulative counted hours per placement week against the plan, the target and the forecast
 * finish. Screen readers get `summary` (the figure is one image); the same numbers are on the
 * page as text and in the weekly list. Series differ by dash as well as colour.
 */
export function ForecastChart({
  points,
  targetHours,
  forecastWeek,
  summary,
}: {
  points: ForecastPoint[];
  targetHours: number;
  forecastWeek: number | null;
  summary: string;
}) {
  return (
    <figure role="img" aria-label={summary} className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 20, right: 12, bottom: 0, left: -12 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="week"
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tick={TICK}
            tickFormatter={(week: number) => (week === 0 ? "" : `W${week}`)}
            interval="preserveStartEnd"
          />
          <YAxis tickLine={false} axisLine={false} tick={TICK} unit="h" width={52} />
          <Tooltip
            formatter={(value) => hoursText(value)}
            labelFormatter={(week) => `Week ${week}`}
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow-card)",
              fontSize: 13,
            }}
          />
          <Legend
            iconType="plainline"
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value) => <span className="text-muted-foreground">{value}</span>}
          />
          <ReferenceLine
            y={targetHours}
            stroke="var(--teal-ink)"
            strokeDasharray="2 4"
            label={{ value: "Target", position: "insideTopLeft", fill: "var(--muted-foreground)", fontSize: 12 }}
          />
          {forecastWeek !== null ? (
            <ReferenceLine
              x={forecastWeek}
              stroke="var(--muted-foreground)"
              strokeDasharray="2 4"
              label={{ value: "Finish", position: "top", fill: "var(--muted-foreground)", fontSize: 12 }}
            />
          ) : null}
          <Line
            name="Plan"
            dataKey="plan"
            stroke="var(--ash)"
            strokeDasharray="6 4"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            name="Counted"
            dataKey="counted"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--primary)", stroke: "var(--card)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
          <Line
            name="Forecast"
            dataKey="projection"
            stroke="var(--primary)"
            strokeDasharray="2 3"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}

"use client";

import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { LoadBlock } from "@/components/load-block";
import { formatMinutes, workloadBar } from "@/components/tasks/task-helpers";
import { Button } from "@/components/ui/button";
import { darwinDateKey, formatDay } from "@/lib/darwin";
import { createClient } from "@/lib/supabase/client";
import { addDays, mondayOf } from "@/lib/periods";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";

async function loadWorkload(weekStart: string) {
  const { data, error } = await createClient().rpc("task_workload", { week_start: weekStart });
  if (error) throw error;
  return (data ?? []).sort((a, b) => a.person_name.localeCompare(b.person_name));
}

/**
 * Workload (D49), staff Tasks pages: one row per intern with the week's estimated hours against rostered hours,
 * red when the estimate is over, plus overdue, blocked and in-review counts.
 */
export function TaskWorkload() {
  const thisWeek = mondayOf(darwinDateKey(new Date()));
  const [week, setWeek] = useState(thisWeek);
  const load = useCallback(() => loadWorkload(week), [week]);
  const [state, reload] = useLoad(load);

  return (
    <section aria-label="Workload" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 aria-live="polite" className="min-w-0 flex-1 text-xl">
          {week === thisWeek ? "This week" : `Week of ${formatDay(week)}`}
        </h2>
        <Button type="button" variant="ghost" size="icon" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}>
          <ChevronLeft aria-hidden />
        </Button>
        {week !== thisWeek ? (
          <Button type="button" variant="ghost" onClick={() => setWeek(thisWeek)}>
            This week
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}>
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Estimated hours of open tasks due {formatDay(week)} to {formatDay(addDays(week, 6))}, against rostered hours.
      </p>
      <LoadBlock state={state} reload={reload} empty="No active interns to show.">
        {(rows) => (
          <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card shadow-card">
            {rows.map((row) => {
              const bar = workloadBar(row.estimate_due_minutes, row.rostered_minutes);
              const counts = [
                row.open_tasks ? `${row.open_tasks} open` : null,
                row.overdue ? `${row.overdue} overdue` : null,
                row.blocked ? `${row.blocked} blocked` : null,
                row.in_review ? `${row.in_review} in review` : null,
              ].filter(Boolean);
              return (
                <li key={row.person_id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold">{row.person_name}</span>
                    <span className={cn("text-sm", bar.over ? "font-semibold text-bad" : "text-muted-foreground")}>
                      {formatMinutes(row.estimate_due_minutes)} of {formatMinutes(row.rostered_minutes)} rostered
                      {bar.over ? " · Over" : ""}
                    </span>
                  </div>
                  <span
                    role="meter"
                    aria-label={`${row.person_name}'s estimated hours against rostered hours`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={bar.percent}
                    aria-valuetext={`${formatMinutes(row.estimate_due_minutes)} of ${formatMinutes(row.rostered_minutes)}${bar.over ? ", over" : ""}`}
                    className="flex h-2 overflow-hidden rounded-full bg-muted"
                  >
                    <span className={cn("rounded-full", bar.over ? "bg-bad" : "bg-primary")} style={{ width: `${bar.percent}%` }} />
                  </span>
                  {counts.length ? (
                    <p className="flex flex-wrap gap-x-3 text-[13px] text-muted-foreground">
                      {counts.map((text) => (
                        <span key={text} className={text?.includes("overdue") || text?.includes("blocked") ? "font-semibold text-bad" : undefined}>
                          {text}
                        </span>
                      ))}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </LoadBlock>
    </section>
  );
}

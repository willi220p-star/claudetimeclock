"use client";

import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { TaskRow } from "@/components/tasks/task-parts";
import {
  PRIORITY_LABEL,
  WEEKDAYS,
  agendaDays,
  calendarWeeks,
  isOverdue,
  monthTitle,
  tasksByDay,
  type Priority,
  type TaskItem,
} from "@/components/tasks/task-helpers";
import { Button } from "@/components/ui/button";
import { darwinDateKey, formatDay } from "@/lib/darwin";
import { loadMyPlacement, loadScheduledDays } from "@/lib/data";
import { addMonths, monthStart } from "@/lib/periods";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";

const PRIORITY_DOT: Record<string, string> = { high: "bg-bad", medium: "bg-warn", low: "bg-ash" };

async function loadRostered(month: string) {
  const placement = await loadMyPlacement();
  if (!placement) return [];
  const days = await loadScheduledDays(placement.id, month, addMonths(month, 1));
  return days.filter((day) => day.status === "scheduled").map((day) => day.work_date);
}

/**
 * Calendar view (D49): tasks by due date with a priority dot. A month grid from 640px; on phones an agenda list by
 * day, since seven columns at 390px are too cramped. Interns also see their rostered days marked.
 */
export function TaskCalendar({
  rows,
  onOpen,
  rostered = false,
  showPerson = false,
}: {
  rows: TaskItem[];
  onOpen: (row: TaskItem) => void;
  rostered?: boolean;
  showPerson?: boolean;
}) {
  const today = darwinDateKey(new Date());
  const [month, setMonth] = useState(() => monthStart(today));
  const load = useCallback(() => (rostered ? loadRostered(month) : Promise.resolve([])), [rostered, month]);
  const [roster] = useLoad(load);
  const shifts = new Set(roster.status === "ready" ? roster.data : []);
  const byDay = tasksByDay(rows);
  const agenda = agendaDays(rows, month, shifts);
  const undated = rows.filter((row) => !row.due_date && row.status !== "done").length;
  const label = (row: TaskItem) => (showPerson && row.person_name ? `${row.title} · ${row.person_name}` : row.title);

  return (
    <section aria-label="Calendar" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 aria-live="polite" className="min-w-0 flex-1 text-xl">
          {monthTitle(month)}
        </h2>
        <Button type="button" variant="ghost" size="icon" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft aria-hidden />
        </Button>
        {month !== monthStart(today) ? (
          <Button type="button" variant="ghost" onClick={() => setMonth(monthStart(today))}>
            Today
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight aria-hidden />
        </Button>
      </div>

      {rostered ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span aria-hidden className="size-2 rounded-full bg-teal" /> Rostered day
        </p>
      ) : null}

      <div className="hidden overflow-hidden rounded-xl bg-card shadow-card sm:block">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              {WEEKDAYS.map((day) => (
                <th key={day} scope="col" className="py-2 text-xs font-semibold text-muted-foreground">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {calendarWeeks(month).map((week) => (
              <tr key={week[0].date}>
                {week.map((day) => {
                  const tasks = byDay.get(day.date) ?? [];
                  const shift = shifts.has(day.date);
                  return (
                    <td
                      key={day.date}
                      aria-current={day.date === today ? "date" : undefined}
                      className={cn("h-28 border-t border-l border-border p-1 align-top first:border-l-0", day.inMonth ? null : "bg-muted/40")}
                    >
                      <div className="flex items-center gap-1 px-1">
                        <span
                          className={cn(
                            "grid size-7 place-items-center rounded-full text-sm",
                            day.date === today ? "bg-primary font-semibold text-primary-foreground" : day.inMonth ? null : "text-muted-foreground",
                          )}
                        >
                          <span className="sr-only">{formatDay(day.date)}</span>
                          <span aria-hidden>{Number(day.date.slice(8))}</span>
                        </span>
                        {shift ? (
                          <span className="size-2 rounded-full bg-teal">
                            <span className="sr-only">Rostered</span>
                          </span>
                        ) : null}
                      </div>
                      <ul className="mt-0.5 flex flex-col gap-0.5">
                        {tasks.map((row) => (
                          <li key={row.item_id}>
                            <button
                              type="button"
                              aria-haspopup="dialog"
                              onClick={() => onOpen(row)}
                              className={cn(
                                "flex min-h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-xs hover:bg-muted",
                                row.status === "done" ? "text-muted-foreground line-through" : isOverdue(row, new Date()) ? "text-bad" : null,
                              )}
                            >
                              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", PRIORITY_DOT[row.priority] ?? PRIORITY_DOT.low)} />
                              <span className="truncate">{label(row)}</span>
                              <span className="sr-only">, {PRIORITY_LABEL[row.priority as Priority] ?? row.priority} priority</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-4 sm:hidden">
        {agenda.length === 0 ? (
          <EmptyState>Nothing due in {monthTitle(month)}. Give a task a due date and it shows here.</EmptyState>
        ) : (
          agenda.map((day) => (
            <section key={day.date} aria-labelledby={`agenda-${day.date}`} className="flex flex-col gap-1.5">
              <h3 id={`agenda-${day.date}`} className="mx-1 flex items-center gap-2 text-[15px] font-semibold text-muted-foreground">
                <span className={day.date === today ? "text-primary" : undefined}>
                  {day.date === today ? `Today, ${formatDay(day.date)}` : formatDay(day.date)}
                </span>
                {shifts.has(day.date) ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium">
                    <span aria-hidden className="size-2 rounded-full bg-teal" />
                    Rostered
                  </span>
                ) : null}
              </h3>
              {day.rows.length === 0 ? (
                <p className="mx-1 text-sm text-muted-foreground">No tasks due.</p>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card shadow-card">
                  {day.rows.map((row) => (
                    <TaskRow key={row.item_id} row={row} name={label(row)} onOpen={() => onOpen(row)} />
                  ))}
                </ul>
              )}
            </section>
          ))
        )}
      </div>
      {undated > 0 ? (
        <p className="text-sm text-muted-foreground">
          {undated === 1
            ? "1 open task has no due date, so it's only in the list."
            : `${undated} open tasks have no due date, so they're only in the list.`}
        </p>
      ) : null}
    </section>
  );
}

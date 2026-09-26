"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DeskGate } from "@/components/desk-gate";
import { StaffShell } from "@/components/desk-shell";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { darwinDateKey, formatDay, formatTimeOfDay } from "@/lib/darwin";
import { loadClosures, loadRoster, type RosterRow } from "@/lib/data";
import type { Profile } from "@/lib/daymark";
import { addDays, addMonths, isoWeekday, mondayOf, monthGrid, monthStart } from "@/lib/periods";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";

type Role = "admin" | "supervisor";
type View = "week" | "month" | "list";

const VIEWS: { value: View; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "list", label: "List" },
];

/** Who is working: a week or month calendar and a day-by-day list. Supervisors see their own interns. */
export function RosterScreen({ role }: { role: Role }) {
  return (
    <DeskGate role={role}>
      {(profile) => (
        <StaffShell profile={profile} role={role} title="Roster">
          <RosterDesk role={role} profile={profile} />
        </StaffShell>
      )}
    </DeskGate>
  );
}

function rangeOf(view: View, anchor: string) {
  if (view === "month") {
    const from = monthStart(anchor);
    return { from, to: addDays(addMonths(from, 1), -1) };
  }
  const from = mondayOf(anchor);
  return { from, to: addDays(from, view === "list" ? 13 : 6) };
}

function RosterDesk({ role, profile }: { role: Role; profile: Profile }) {
  const today = darwinDateKey(new Date());
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(today);
  const [picked, setPicked] = useState<string | null>(null);
  const { from, to } = rangeOf(view, anchor);

  const load = useCallback(async () => {
    const [rows, closures] = await Promise.all([
      loadRoster(from, to, role === "supervisor" ? profile.id : undefined),
      loadClosures(from, to),
    ]);
    return { rows, closures };
  }, [from, to, role, profile.id]);
  const [state, reload] = useLoad(load);

  function step(direction: 1 | -1) {
    setPicked(null);
    setAnchor(view === "month" ? addMonths(monthStart(anchor), direction) : addDays(from, (view === "list" ? 14 : 7) * direction));
  }

  const title =
    view === "month"
      ? format(parseISO(from), "MMMM yyyy")
      : view === "week"
        ? `Week of ${formatDay(from)}`
        : `${formatDay(from)} – ${formatDay(to)}`;
  const link = (row: RosterRow) =>
    role === "admin" ? `/admin/placement?id=${row.placement_id}` : `/supervisor/intern?id=${row.intern_id}`;

  return (
    <>
      <PageHeader
        title="Roster"
        description={role === "admin" ? "Who is working, for every intern." : "Who is working, for your interns."}
        actions={
          <div role="group" aria-label="Roster view" className="flex rounded-full bg-muted p-1">
            {VIEWS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={view === option.value}
                onClick={() => {
                  setView(option.value);
                  setPicked(null);
                }}
                className={cn(
                  "min-h-11 rounded-full px-4 text-[15px] font-medium transition-colors sm:px-5",
                  view === option.value ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="icon" aria-label={`Previous ${view === "list" ? "two weeks" : view}`} onClick={() => step(-1)}>
          <ChevronLeft aria-hidden className="size-5" />
        </Button>
        <div className="flex flex-col items-center">
          <h2 aria-live="polite" className="text-center text-[17px] font-semibold">
            {title}
          </h2>
          {anchor !== today ? (
            <button
              type="button"
              className="min-h-8 text-sm text-primary"
              onClick={() => {
                setAnchor(today);
                setPicked(null);
              }}
            >
              Today
            </button>
          ) : null}
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label={`Next ${view === "list" ? "two weeks" : view}`} onClick={() => step(1)}>
          <ChevronRight aria-hidden className="size-5" />
        </Button>
      </div>

      <LoadBlock state={state} reload={reload}>
        {({ rows, closures }) => {
          const on = (date: string) => rows.filter((row) => row.work_date === date);
          const closure = (date: string) => closures.find((c) => c.day === date)?.name ?? null;

          if (view === "month") {
            return (
              <div className="mt-2 flex flex-col gap-4">
                <div aria-hidden className="grid grid-cols-5 gap-1.5 text-center lg:gap-2">
                  {["Mon", "Tue", "Wed", "Thu", "Fri"].map((name) => (
                    <p key={name} className="caption text-muted-foreground">
                      {name}
                    </p>
                  ))}
                </div>
                <ol className="grid grid-cols-5 gap-1.5 lg:gap-2">
                  {monthGrid(from)
                    .flat()
                    .map((date, index) => {
                      if (!date) return <li key={`blank-${index}`} aria-hidden />;
                      const working = on(date).filter((row) => row.status === "scheduled");
                      const closed = closure(date);
                      return (
                        <li key={date}>
                          <button
                            type="button"
                            aria-label={`${formatDay(date)}. ${closed ?? `${working.length} working`}`}
                            aria-current={date === today ? "date" : undefined}
                            aria-pressed={picked === date}
                            onClick={() => setPicked(date)}
                            className={cn(
                              "flex min-h-20 w-full flex-col items-start gap-1 rounded-xl p-2 text-left shadow-card lg:min-h-28 lg:p-3",
                              closed ? "bg-muted" : "bg-card",
                              picked === date && "ring-2 ring-primary",
                            )}
                          >
                            <span
                              className={cn(
                                "grid size-7 place-items-center rounded-full text-sm font-semibold tabular-nums",
                                date === today && "bg-primary text-primary-foreground",
                              )}
                            >
                              {Number(date.slice(8))}
                            </span>
                            <span className="hidden flex-col text-xs text-muted-foreground lg:flex">
                              {working.slice(0, 3).map((row) => (
                                <span key={row.id} className="truncate">
                                  {row.intern_name.split(" ")[0]}
                                </span>
                              ))}
                              {working.length > 3 ? <span>+{working.length - 3} more</span> : null}
                            </span>
                            <span className="mt-auto text-xs font-semibold tabular-nums lg:hidden">
                              {closed ? "Closed" : working.length || ""}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                </ol>
                <p className="text-sm text-muted-foreground">Tap a day to see who is working. Weekends aren&apos;t shown.</p>
                {picked ? <DayCard date={picked} rows={on(picked)} closure={closure(picked)} today={today} link={link} /> : null}
              </div>
            );
          }

          const days = Array.from({ length: view === "week" ? 7 : 14 }, (_, i) => addDays(from, i)).filter(
            // Weekends only show when someone is rostered on them.
            (date) => isoWeekday(date) <= 5 || on(date).length > 0,
          );
          return (
            <ol className={cn("mt-2 grid gap-3", view === "week" && "lg:grid-cols-5")}>
              {days.map((date) => (
                <li key={date}>
                  <DayCard date={date} rows={on(date)} closure={closure(date)} today={today} link={link} compact={view === "week"} />
                </li>
              ))}
            </ol>
          );
        }}
      </LoadBlock>
    </>
  );
}

function DayCard({
  date,
  rows,
  closure,
  today,
  link,
  compact = false,
}: {
  date: string;
  rows: RosterRow[];
  closure: string | null;
  today: string;
  link: (row: RosterRow) => string;
  compact?: boolean;
}) {
  const working = rows.filter((row) => row.status === "scheduled");
  const leave = rows.filter((row) => row.status === "leave");
  return (
    <section
      aria-label={formatDay(date)}
      className={cn("flex h-full flex-col gap-2 rounded-xl bg-card p-4 shadow-card", date === today && "ring-2 ring-primary")}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold">
          {formatDay(date)}
          {date === today ? <span className="ml-2 text-sm font-normal text-primary">Today</span> : null}
        </h3>
        <span className="text-sm text-muted-foreground tabular-nums">
          {closure ? "Closed" : `${working.length} working`}
        </span>
      </div>
      {closure ? <p className="text-sm text-muted-foreground">{closure}</p> : null}
      {working.length === 0 && leave.length === 0 && !closure ? (
        <p className="text-sm text-muted-foreground">No one rostered.</p>
      ) : null}
      <ul className="flex flex-col divide-y divide-border">
        {[...working, ...leave].map((row) => (
          <li key={row.id}>
            <Link
              href={link(row)}
              className={cn(
                "flex min-h-11 items-center justify-between gap-2 py-1.5",
                compact && "lg:flex-col lg:items-start lg:gap-0",
              )}
            >
              <span className={cn("font-medium", row.status === "leave" && "text-muted-foreground")}>{row.intern_name}</span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {row.status === "leave"
                  ? "On leave"
                  : `${formatTimeOfDay(row.start_time)}–${formatTimeOfDay(row.end_time)}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

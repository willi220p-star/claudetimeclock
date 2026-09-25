"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { format, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { InternShell } from "@/components/desk-shell";
import { DAY_STATUS, DayStatusBadge, type DayStatus } from "@/components/day-status-badge";
import { DeskGate } from "@/components/desk-gate";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { RequestForm } from "@/components/request-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  loadClockStatus,
  loadClosures,
  loadDayResults,
  loadHeadcounts,
  loadMyPlacement,
  loadScheduledDays,
} from "@/lib/data";
import { formatDay, formatTimeOfDay } from "@/lib/darwin";
import { addDays, addMonths, mondayOf, monthGrid, monthStart } from "@/lib/periods";
import { FULL_SPOT_TEXT, dayCellStatus } from "@/lib/placement-ui";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";

type Sheet = { date: string; dayId?: string; start?: string; end?: string; mine: boolean; full: boolean };
type View = "week" | "month";

export function ScheduleScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <InternShell profile={profile} title="Schedule">
          <ScheduleDesk />
        </InternShell>
      )}
    </DeskGate>
  );
}

const WIDE = "(min-width: 1024px)";

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Month is the default at 1024px and up, week on phones, until the intern picks one. */
function useDefaultView(): View {
  return useSyncExternalStore(subscribeWide, () => (window.matchMedia(WIDE).matches ? "month" : "week"), () => "week");
}

function ScheduleDesk() {
  const defaultView = useDefaultView();
  const [chosen, setChosen] = useState<View | null>(null);
  const view = chosen ?? defaultView;
  const [anchor, setAnchor] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [action, setAction] = useState<"swap" | "shift_change" | "leave" | "extra_day" | "punch_fix" | null>(null);

  const load = useCallback(async () => {
    const [placement, status] = await Promise.all([loadMyPlacement(), loadClockStatus().catch(() => null)]);
    if (!placement) return null;
    const today = status?.today ?? placement.start_date;
    const base = anchor ?? today;
    const from = view === "week" ? mondayOf(base) : monthStart(base);
    const to = view === "week" ? addDays(from, 6) : addDays(addMonths(from, 1), -1);
    const [days, counts, closures, results] = await Promise.all([
      loadScheduledDays(placement.id, from, to),
      loadHeadcounts(from, to),
      loadClosures(from, to),
      loadDayResults(placement.id, from, to),
    ]);
    return { view, from, today, days, counts, closures, results };
  }, [view, anchor]);
  const [state, reload] = useLoad(load);
  const shown = state.status === "ready" ? state.data : null;

  function step(direction: 1 | -1) {
    if (!shown) return;
    setAnchor(shown.view === "week" ? addDays(shown.from, 7 * direction) : addMonths(shown.from, direction));
  }

  return (
    <>
      <PageHeader
        title="Schedule"
        description="Tap a day to swap, take leave, or ask for an extra spot."
        actions={
          <div role="group" aria-label="Calendar view" className="flex rounded-full bg-muted p-1">
            {(["week", "month"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => setChosen(option)}
                className={cn(
                  "min-h-11 rounded-full px-5 text-[15px] font-medium transition-colors",
                  view === option ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
        }
      />
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="icon" aria-label={`Previous ${view}`} disabled={!shown} onClick={() => step(-1)}>
          <ChevronLeft aria-hidden className="size-5" />
        </Button>
        <h2 aria-live="polite" className="text-[17px] font-semibold">
          {shown ? (shown.view === "week" ? `Week of ${formatDay(shown.from)}` : format(parseISO(shown.from), "MMMM yyyy")) : " "}
        </h2>
        <Button type="button" variant="ghost" size="icon" aria-label={`Next ${view}`} disabled={!shown} onClick={() => step(1)}>
          <ChevronRight aria-hidden className="size-5" />
        </Button>
      </div>
      <LoadBlock state={state} reload={reload} empty="Your placement isn't set up yet.">
        {(data) => {
          if (!data) return null;
          const info = (date: string) => {
            const day = data.days.find((row) => row.work_date === date);
            const count = data.counts.find((row) => row.work_date === date);
            const closure = data.closures.find((row) => row.day === date);
            const result = data.results.find((row) => row.work_date === date);
            const status: DayStatus = dayCellStatus({
              workDate: date,
              today: data.today,
              dayStatus: day?.status,
              counted: result?.counted,
              noShow: result?.no_show,
              closure: closure?.name,
            });
            return {
              day,
              closure,
              full: Boolean(count?.full),
              office: count?.label ?? "0/3",
              status: day || closure ? status : null,
              time: day ? `${formatTimeOfDay(day.start_time)}–${formatTimeOfDay(day.end_time)}` : null,
            };
          };
          const open = (date: string) => {
            const { day, full } = info(date);
            setSheet({
              date,
              dayId: day?.id,
              start: day?.start_time,
              end: day?.end_time,
              mine: Boolean(day && (day.status === "scheduled" || day.status === "leave")),
              full,
            });
          };

          if (data.view === "month") {
            return (
              <div className="mt-2 flex flex-col gap-2">
                <div aria-hidden className="grid grid-cols-5 gap-1.5 text-center lg:gap-2">
                  {["Mon", "Tue", "Wed", "Thu", "Fri"].map((name) => (
                    <p key={name} className="caption text-muted-foreground">
                      {name}
                    </p>
                  ))}
                </div>
                <ol className="grid grid-cols-5 gap-1.5 lg:gap-2">
                  {monthGrid(data.from)
                    .flat()
                    .map((date, index) => {
                      if (!date) return <li key={`blank-${index}`} aria-hidden />;
                      const cell = info(date);
                      const meta = cell.status ? DAY_STATUS[cell.status] : null;
                      const Icon = meta?.icon;
                      const office = cell.full ? "Full" : cell.office;
                      const label = [
                        formatDay(date),
                        cell.closure?.name ?? meta?.label ?? "Not on your schedule",
                        cell.time,
                        `Office ${office}`,
                      ]
                        .filter(Boolean)
                        .join(". ");
                      return (
                        <li key={date}>
                          <button
                            type="button"
                            aria-label={label}
                            aria-current={date === data.today ? "date" : undefined}
                            onClick={() => open(date)}
                            className={cn(
                              "flex min-h-20 w-full flex-col items-start gap-1 rounded-xl p-2 text-left shadow-card lg:min-h-28 lg:p-3",
                              cell.closure ? "bg-muted" : "bg-card",
                            )}
                          >
                            <span
                              className={cn(
                                "grid size-7 place-items-center rounded-full text-sm font-semibold tabular-nums",
                                date === data.today && "bg-primary text-primary-foreground",
                              )}
                            >
                              {Number(date.slice(8))}
                            </span>
                            {cell.status && Icon ? (
                              <>
                                <Icon aria-hidden className="size-4 text-muted-foreground lg:hidden" />
                                <span className="hidden lg:block">
                                  <DayStatusBadge status={cell.status} />
                                </span>
                              </>
                            ) : null}
                            {cell.time ? <span className="hidden text-xs text-muted-foreground lg:block">{cell.time}</span> : null}
                            <span className={cn("mt-auto text-xs tabular-nums", cell.full ? "font-semibold text-bad" : "text-muted-foreground")}>
                              {office}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                </ol>
                <p className="text-sm text-muted-foreground">Weekends aren&apos;t shown. The number is office spots taken of 3.</p>
              </div>
            );
          }

          return (
            <ol className="mt-2 grid gap-2">
              {Array.from({ length: 7 }, (_, i) => addDays(data.from, i)).map((date) => {
                const cell = info(date);
                return (
                  <li key={date}>
                    <button
                      type="button"
                      className="flex w-full flex-col gap-2 rounded-xl bg-card p-4 text-left shadow-card"
                      onClick={() => open(date)}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{formatDay(date)}</span>
                        {cell.status ? <DayStatusBadge status={cell.status} /> : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {cell.time ?? cell.closure?.name ?? "Not on your schedule"}
                      </p>
                      <p className="text-sm">{cell.full ? FULL_SPOT_TEXT : `Office ${cell.office}`}</p>
                    </button>
                  </li>
                );
              })}
            </ol>
          );
        }}
      </LoadBlock>

      <Dialog
        open={sheet !== null && action === null}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
      >
        <DialogContent>
          <DialogTitle>{sheet ? formatDay(sheet.date) : "Day"}</DialogTitle>
          <DialogDescription>Pick what you need. The preview shows before you send it.</DialogDescription>
          <div className="flex flex-col gap-2">
            {sheet?.mine && sheet.dayId ? (
              <>
                <Button type="button" onClick={() => setAction("swap")}>
                  Swap
                </Button>
                <Button type="button" variant="secondary" onClick={() => setAction("shift_change")}>
                  Change times
                </Button>
              </>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => setAction("leave")}>
              Leave
            </Button>
            {sheet && shown && sheet.date <= shown.today && sheet.date >= addDays(shown.today, -7) ? (
              <Button type="button" variant="secondary" onClick={() => setAction("punch_fix")}>
                Punch fix
              </Button>
            ) : null}
            <Button type="button" onClick={() => setAction("extra_day")}>
              {sheet?.full ? FULL_SPOT_TEXT : "Extra day"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAction(null);
            setSheet(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogTitle>{action === "swap" ? "Swap" : action === "extra_day" ? "Extra day" : "Request"}</DialogTitle>
          <DialogDescription>The Preview panel is the server verdict.</DialogDescription>
          {action && sheet ? (
            <RequestForm
              type={action}
              defaults={{
                scheduled_day_id: sheet.dayId,
                start: sheet.start,
                end: sheet.end,
                date: sheet.date,
                dates: action === "leave" ? [sheet.date] : undefined,
              }}
              onSubmitted={() => {
                setAction(null);
                setSheet(null);
                reload();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

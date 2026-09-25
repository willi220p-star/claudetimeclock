"use client";

import { useCallback, useMemo, useState } from "react";
import { InternFrame } from "@/app/clock/intern-frame";
import { DayStatusBadge } from "@/components/day-status-badge";
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
import { addDays, mondayOf } from "@/lib/periods";
import { FULL_SPOT_TEXT, dayCellStatus } from "@/lib/placement-ui";
import { useLoad } from "@/lib/use-load";

type Sheet = { date: string; dayId?: string; start?: string; end?: string; mine: boolean; full: boolean };

export function ScheduleScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <InternFrame profile={profile} title="Schedule">
          <ScheduleDesk />
        </InternFrame>
      )}
    </DeskGate>
  );
}

function ScheduleDesk() {
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [action, setAction] = useState<"swap" | "shift_change" | "leave" | "extra_day" | "punch_fix" | null>(null);

  const load = useCallback(async () => {
    const [placement, status] = await Promise.all([loadMyPlacement(), loadClockStatus().catch(() => null)]);
    if (!placement) return { placement: null, days: [], counts: [], closures: [], results: [], today: status?.today ?? "" };
    const today = status?.today ?? placement.start_date;
    const start = weekStart ?? mondayOf(today);
    const end = addDays(start, 6);
    const [days, counts, closures, results] = await Promise.all([
      loadScheduledDays(placement.id, start, end),
      loadHeadcounts(start, end),
      loadClosures(start, end),
      loadDayResults(placement.id, start, end),
    ]);
    return { placement, days, counts, closures, results, today, start };
  }, [weekStart]);
  const [state, reload] = useLoad(load);

  const start = state.status === "ready" ? (state.data.start ?? weekStart) : weekStart;
  const dates = useMemo(() => (start ? Array.from({ length: 7 }, (_, i) => addDays(start, i)) : []), [start]);

  return (
    <>
      <PageHeader
        title="Schedule"
        description="This week. Tap a day to swap, take leave, or ask for an extra spot."
        actions={
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => start && setWeekStart(addDays(start, -7))}>
              Previous week
            </Button>
            <Button type="button" variant="secondary" onClick={() => start && setWeekStart(addDays(start, 7))}>
              Next week
            </Button>
          </div>
        }
      />
      <LoadBlock state={state} reload={reload} empty="Your placement isn't set up yet.">
        {(data) => (
          <ol className="grid gap-2">
            {dates.map((date) => {
              const day = data.days.find((row) => row.work_date === date);
              const count = data.counts.find((row) => row.work_date === date);
              const closure = data.closures.find((row) => row.day === date);
              const result = data.results.find((row) => row.work_date === date);
              const full = Boolean(count?.full);
              const status = dayCellStatus({
                workDate: date,
                today: data.today,
                dayStatus: day?.status,
                counted: result?.counted,
                noShow: result?.no_show,
                closure: closure?.name,
              });
              return (
                <li key={date}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-2 rounded-xl bg-card p-4 text-left shadow-card"
                    onClick={() =>
                      setSheet({
                        date,
                        dayId: day?.id,
                        start: day?.start_time,
                        end: day?.end_time,
                        mine: Boolean(day && (day.status === "scheduled" || day.status === "leave")),
                        full,
                      })
                    }
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{formatDay(date)}</span>
                      {day || closure ? <DayStatusBadge status={closure ? "closure" : status} /> : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {day
                        ? `${formatTimeOfDay(day.start_time)}–${formatTimeOfDay(day.end_time)}`
                        : closure
                          ? closure.name
                          : "Not on your schedule"}
                    </p>
                    <p className="text-sm">{full ? FULL_SPOT_TEXT : `Office ${count?.label ?? "0/3"}`}</p>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
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
            {sheet && state.status === "ready" && sheet.date <= state.data.today && sheet.date >= addDays(state.data.today, -7) ? (
              <Button type="button" variant="secondary" onClick={() => setAction("punch_fix")}>
                Punch fix
              </Button>
            ) : null}
            <Button type="button" onClick={() => setAction("extra_day")}>
              Extra day
            </Button>
            {sheet?.full ? <p className="text-sm">{FULL_SPOT_TEXT}</p> : null}
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
              initialType={action}
              initialFields={fieldsFor(action, sheet)}
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

function fieldsFor(action: NonNullable<typeof action>, sheet: Sheet): Record<string, string> {
  const start = sheet.start?.slice(0, 5) ?? "09:00";
  const end = sheet.end?.slice(0, 5) ?? "17:00";
  if (action === "swap") return { scheduled_day_id: sheet.dayId ?? "", start, end };
  if (action === "shift_change") return { scheduled_day_id: sheet.dayId ?? "", start, end };
  if (action === "leave") return { dates: sheet.date, kind: "personal" };
  if (action === "punch_fix") return { date: sheet.date };
  return { date: sheet.date, start, end };
}

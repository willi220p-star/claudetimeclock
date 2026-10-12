"use client";

import { useCallback, useState } from "react";
import { format, parseISO } from "date-fns";
import { ChevronRight } from "lucide-react";
import { InternShell } from "@/components/desk-shell";
import { DAY_STATUS, DayStatusBadge } from "@/components/day-status-badge";
import { DeskGate } from "@/components/desk-gate";
import { EmptyState } from "@/components/empty-state";
import { LoadBlock } from "@/components/load-block";
import { MinutesText } from "@/components/minutes-text";
import { PageHeader } from "@/components/page-header";
import { RequestForm } from "@/components/request-form";
import { ScheduleTabs } from "@/components/segmented-nav";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  loadDayKinds,
  loadDayResults,
  loadMyPlacement,
  loadPunchesForPlacement,
  loadRequestsForPlacement,
  loadScheduledDays,
  loadSettings,
} from "@/lib/data";
import { darwinDateKey, formatDay, formatTime } from "@/lib/darwin";
import { historyFrom, historyMonths, historyRows, type HistoryRow } from "@/lib/history";
import { formatMinutes } from "@/lib/minutes";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";

export function HistoryScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <InternShell profile={profile} title="Shift history">
          <ScheduleTabs />
          <HistoryDesk />
        </InternShell>
      )}
    </DeskGate>
  );
}

/** Shift history (D46): every day since the placement started, a month at a time, newest first. */
function HistoryDesk() {
  const [months, setMonths] = useState(1);
  const [fixing, setFixing] = useState<HistoryRow | null>(null);
  const load = useCallback(async () => {
    const [placement, fixDays] = await Promise.all([
      loadMyPlacement(),
      loadSettings().then(
        ({ settings }) => settings.punch_fix_days,
        () => 7,
      ),
    ]);
    if (!placement) return null;
    const today = darwinDateKey(new Date());
    const from = historyFrom(placement.start_date, today, months);
    const [days, results, kinds, punches, requests] = await Promise.all([
      loadScheduledDays(placement.id, from, today),
      loadDayResults(placement.id, from, today),
      loadDayKinds(placement.id, from, today),
      loadPunchesForPlacement(placement.intern_id, `${from}T00:00:00+09:30`, `${today}T23:59:59+09:30`),
      loadRequestsForPlacement(placement.id),
    ]);
    return {
      months,
      earlier: from > placement.start_date,
      groups: historyMonths(historyRows({ days, results, kinds, punches, requests, today, fixDays })),
    };
  }, [months]);
  const [state, reload] = useLoad(load);
  const loadingEarlier = state.status === "ready" && state.data !== null && state.data.months !== months;

  return (
    <>
      <PageHeader title="Shift history" description="Every day since you started. Tap a day to ask for a fix." />
      <div className="mt-6">
        <LoadBlock state={state} reload={reload} empty="Your placement isn't set up yet.">
          {(data) =>
            data ? (
              <div className="flex flex-col gap-6">
                {data.groups.length === 0 ? <EmptyState>No shifts yet. Days you clock show here.</EmptyState> : null}
                {data.groups.map((group) => (
                  <section key={group.key} aria-labelledby={`month-${group.key}`} className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-2 px-1">
                      <h2 id={`month-${group.key}`} className="text-xl font-bold">
                        {format(parseISO(`${group.key}-01`), "MMMM yyyy")}
                      </h2>
                      <span className="text-[15px] text-muted-foreground">{formatMinutes(group.counted)} counted</span>
                    </div>
                    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl bg-card shadow-card">
                      {group.rows.map((row) => (
                        <li key={row.date}>
                          <DayRow row={row} onFix={() => setFixing(row)} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                {data.earlier ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full sm:w-fit"
                    disabled={loadingEarlier}
                    onClick={() => setMonths((count) => count + 1)}
                  >
                    {loadingEarlier ? "Loading…" : "Load earlier"}
                  </Button>
                ) : null}
              </div>
            ) : null
          }
        </LoadBlock>
      </div>

      <Dialog
        open={fixing !== null}
        onOpenChange={(open) => {
          if (!open) setFixing(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogTitle>{fixing ? `Fix ${formatDay(fixing.date)}` : "Fix a day"}</DialogTitle>
          <DialogDescription>Change the times that are wrong and say what happened. Your supervisor checks it.</DialogDescription>
          {fixing ? (
            <RequestForm
              type="punch_fix"
              defaults={{ date: fixing.date, ...fixing.fix }}
              onSubmitted={() => {
                setFixing(null);
                reload();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function DayRow({ row, onFix }: { row: HistoryRow; onFix: () => void }) {
  const date = parseISO(row.date);
  const details = [
    ...row.breaks.map((item) => `Break ${formatTime(item.start)}–${item.end ? formatTime(item.end) : "not ended"}`),
    row.dayType,
  ].filter(Boolean);
  const content = (
    <>
      <span className="flex w-11 shrink-0 flex-col items-center">
        <span className="text-xs text-muted-foreground">{format(date, "EEE")}</span>
        <span className="text-xl font-bold tabular-nums">{format(date, "d")}</span>
        <span className="sr-only">{format(date, "MMMM")}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {row.clockIn ? (
          <span>
            {formatTime(row.clockIn)} –{" "}
            {row.missingOut ? (
              <span className="font-semibold text-bad">no clock-out</span>
            ) : row.clockOut ? (
              formatTime(row.clockOut)
            ) : (
              "still clocked in"
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">{row.status ? DAY_STATUS[row.status].label : "No clock-in"}</span>
        )}
        {row.chips.length > 0 || row.status || details.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {row.status && row.clockIn ? <DayStatusBadge status={row.status} /> : null}
            {row.chips.map((chip) => (
              <StatusChip key={chip.label} tone={chip.tone} label={chip.label} />
            ))}
            {details.length > 0 ? <span className="text-[13px] text-muted-foreground">{details.join(" · ")}</span> : null}
            {row.missingOut && row.canFix ? <span className="text-[13px] font-semibold text-primary">Tap to fix</span> : null}
          </span>
        ) : null}
      </span>
      <span className={cn("shrink-0 font-semibold", !row.counted && "text-muted-foreground")}>
        {row.counted === null ? "—" : <MinutesText minutes={row.counted} />}
      </span>
      {row.canFix ? (
        <>
          <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <span className="sr-only">. Ask for a fix</span>
        </>
      ) : null}
    </>
  );
  const layout = "flex min-h-16 w-full items-center gap-3 py-3 pr-2 pl-3 text-left";
  if (!row.canFix) return <div className={layout}>{content}</div>;
  return (
    <button type="button" onClick={onFix} className={cn(layout, "hover:bg-muted/50", row.missingOut && "bg-bad-bg/40")}>
      {content}
    </button>
  );
}

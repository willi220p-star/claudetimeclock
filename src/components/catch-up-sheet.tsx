"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-field";
import { TimeField } from "@/components/roster-edit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { backOnTrack, MAX_DAYS, pickedMinutes, presetOf, presetTimes, quickFill, type Picks, type Preset, type Times } from "@/lib/catch-up";
import { loadCatchUpSlots } from "@/lib/data";
import { formatDay, formatTimeOfDay } from "@/lib/darwin";
import { errorText } from "@/lib/daymark";
import { formatMinutes } from "@/lib/minutes";
import { mondayOf } from "@/lib/periods";
import { coversLine } from "@/lib/placement-ui";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";

const PRESETS: { key: Preset; label: string }[] = [
  { key: "full", label: "Full day" },
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "custom", label: "Custom" },
];

/**
 * Catch up (Dilip, 5 Oct): the intern picks free office days and times; the supervisor approves
 * them as extra days. Quick fill picks the earliest days that cover the balance.
 */
export function CatchUpSheet({ placementId, onClose, onDone }: { placementId: string; onClose: () => void; onDone?: () => void }) {
  const router = useRouter();
  const load = useCallback(() => loadCatchUpSlots(placementId), [placementId]);
  const [slots] = useLoad(load);
  const [picks, setPicks] = useState<Picks>({});
  const [custom, setCustom] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = Object.keys(picks).length;

  function toggle(date: string, usual: Times) {
    setPicks((current) => {
      const next = { ...current };
      if (next[date]) delete next[date];
      else next[date] = { ...usual };
      return next;
    });
  }

  function setTimes(date: string, times: Times) {
    setPicks((current) => ({ ...current, [date]: times }));
  }

  async function send() {
    setBusy(true);
    setError(null);
    const days = Object.keys(picks)
      .sort()
      .map((date) => ({ date, ...picks[date] }));
    const { error: fail } = await createClient().rpc("submit_catch_up_days", { placement: placementId, days });
    setBusy(false);
    if (fail) {
      setError(errorText(fail, "Those days didn't send. Try again."));
      return;
    }
    toast.success(days.length === 1 ? "1 day sent to your supervisor." : `${days.length} days sent to your supervisor.`);
    onDone?.();
    onClose();
    router.push("/clock/requests");
  }

  return (
    <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>Catch up</DialogTitle>
        <DialogDescription>Pick free office days that suit you. Your supervisor approves them.</DialogDescription>
        {slots.status === "loading" ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : slots.status === "error" ? (
          <FormMessage>{slots.message}</FormMessage>
        ) : (
          (() => {
            const data = slots.data;
            const picked = pickedMinutes(picks, data.break_minutes);
            const owed = data.owed_minutes;
            const track = backOnTrack(picks, owed, data.break_minutes);
            const weeks = new Map<string, typeof data.days>();
            for (const day of data.days) {
              const week = mondayOf(day.date);
              weeks.set(week, [...(weeks.get(week) ?? []), day]);
            }
            return (
              <div className="flex flex-col gap-5">
                <section aria-label="Your balance" className="flex flex-col gap-2 border-y border-border py-4">
                  <p className="caption font-semibold uppercase tracking-[0.12em] text-muted-foreground">Behind by</p>
                  <p className="text-3xl font-bold tabular-nums">{formatMinutes(owed)}</p>
                  <div
                    role="progressbar"
                    aria-label="Hours picked"
                    aria-valuemin={0}
                    aria-valuemax={owed}
                    aria-valuenow={Math.min(picked, owed)}
                    className="h-2 overflow-hidden rounded-full bg-muted"
                  >
                    <div className="h-full bg-primary transition-all" style={{ width: `${owed > 0 ? Math.min(100, (picked / owed) * 100) : 0}%` }} />
                  </div>
                  <p className="text-sm">{coversLine(picked, owed)}</p>
                  {track ? <p className="text-sm font-semibold text-ok">Back on track by {formatDay(track)}</p> : null}
                  {data.days.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" onClick={() => setPicks(quickFill(data))}>
                        Quick fill
                      </Button>
                      {count > 0 ? (
                        <Button type="button" variant="ghost" onClick={() => setPicks({})}>
                          Clear
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </section>

                {data.days.length === 0 ? (
                  <p className="text-muted-foreground">
                    No free office days are left in your placement. Ask your supervisor about an extra spot.
                  </p>
                ) : (
                  [...weeks.entries()].map(([week, days]) => (
                    <section key={week} aria-label={`Week of ${formatDay(week)}`} className="flex flex-col gap-2">
                      <h3 className="caption font-semibold uppercase tracking-[0.12em] text-muted-foreground">Week of {formatDay(week)}</h3>
                      <ul className="flex flex-col gap-2">
                        {days.map((day) => {
                          const times = picks[day.date];
                          const preset = times ? (custom[day.date] ? "custom" : presetOf(times, data.usual)) : null;
                          return (
                            <li key={day.date} className={cn("rounded-lg border p-3", times ? "border-primary" : "border-border")}>
                              <label className="flex min-h-11 items-center gap-3">
                                <input
                                  type="checkbox"
                                  className="size-5 accent-primary"
                                  checked={Boolean(times)}
                                  onChange={() => toggle(day.date, data.usual)}
                                />
                                <span className="font-semibold">{formatDay(day.date)}</span>
                                <span className="ml-auto text-sm text-muted-foreground">
                                  {day.free === 1 ? "1 spot free" : `${day.free} spots free`}
                                </span>
                              </label>
                              {times ? (
                                <div className="mt-2 flex flex-col gap-3">
                                  <div role="radiogroup" aria-label={`Times on ${formatDay(day.date)}`} className="flex flex-wrap gap-1">
                                    {PRESETS.map((item) => (
                                      <button
                                        key={item.key}
                                        type="button"
                                        role="radio"
                                        aria-checked={preset === item.key}
                                        onClick={() => {
                                          setCustom((current) => ({ ...current, [day.date]: item.key === "custom" }));
                                          if (item.key !== "custom") setTimes(day.date, presetTimes(item.key, data.usual));
                                        }}
                                        className={cn(
                                          "min-h-11 rounded-full px-4 text-sm font-semibold",
                                          preset === item.key ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                                        )}
                                      >
                                        {item.label}
                                      </button>
                                    ))}
                                  </div>
                                  {preset === "custom" ? (
                                    <div className="grid grid-cols-2 gap-3">
                                      <TimeField id={`cu-start-${day.date}`} label="Start" value={times.start} onChange={(start) => setTimes(day.date, { ...times, start })} />
                                      <TimeField id={`cu-end-${day.date}`} label="End" value={times.end} onChange={(end) => setTimes(day.date, { ...times, end })} />
                                    </div>
                                  ) : (
                                    <p className="text-sm text-muted-foreground">
                                      {formatTimeOfDay(times.start)}–{formatTimeOfDay(times.end)}
                                    </p>
                                  )}
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))
                )}

                {count > MAX_DAYS ? <FormMessage>Send up to {MAX_DAYS} days at a time.</FormMessage> : null}
                {error ? <FormMessage>{error}</FormMessage> : null}
                <Button type="button" className="w-full" disabled={count === 0 || count > MAX_DAYS || busy} onClick={() => void send()}>
                  {busy ? "Sending…" : count === 1 ? "Send 1 day to your supervisor" : `Send ${count} days to your supervisor`}
                </Button>
              </div>
            );
          })()
        )}
      </DialogContent>
    </Dialog>
  );
}

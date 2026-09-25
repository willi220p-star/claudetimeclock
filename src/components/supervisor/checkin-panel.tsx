"use client";

import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { FormField, FormMessage } from "@/components/form-field";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/darwin";
import { dataError, saveCheckin, type loadCheckins } from "@/lib/data";
import { checkinWeeks, lastWeekStart } from "@/lib/periods";
import { CHECKIN_ANCHORS, CHECKIN_AREAS, checkinAverage, type CheckinScores } from "@/lib/placement-ui";

type Checkin = Awaited<ReturnType<typeof loadCheckins>>[number];

const EMPTY: CheckinScores = { reliability: 0, quality: 0, communication: 0 };

/** §11.3 weekly check-in: three 1–5 ratings and a comment, one per week (a second save edits it). */
export function CheckinPanel({
  placementId,
  startDate,
  endDate,
  today,
  checkins,
  onSaved,
}: {
  placementId: string;
  startDate: string;
  endDate: string;
  today: string;
  checkins: Checkin[];
  onSaved: () => void;
}) {
  const weeks = checkinWeeks(today, startDate, endDate);
  const lastWeek = lastWeekStart(today);
  const byWeek = new Map(checkins.map((row) => [row.week_start, row]));
  const [week, setWeek] = useState(weeks.includes(lastWeek) ? lastWeek : (weeks[0] ?? ""));
  const [scores, setScores] = useState<CheckinScores>(() => scoresOf(byWeek.get(week)));
  const [comment, setComment] = useState(byWeek.get(week)?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = scores.reliability > 0 && scores.quality > 0 && scores.communication > 0;
  const lastWeekDue = weeks.includes(lastWeek) && !byWeek.has(lastWeek);

  function pickWeek(next: string) {
    setWeek(next);
    setScores(scoresOf(byWeek.get(next)));
    setComment(byWeek.get(next)?.comment ?? "");
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveCheckin({ placement: placementId, week_start: week, ...scores, comment: comment.trim() || undefined });
      toast.success(`Check-in saved for the week of ${formatDay(week)}.`);
      onSaved();
    } catch (err) {
      setError(dataError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {weeks.length === 0 ? (
        <EmptyState>Check-ins open once the placement&apos;s first week has started.</EmptyState>
      ) : (
        <form
          className="flex flex-col gap-4 rounded-xl bg-card p-4 shadow-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (complete && !busy) void save();
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="caption font-semibold text-muted-foreground">Weekly check-in</h2>
            {lastWeekDue ? <StatusChip tone="warn" label="Due" /> : null}
          </div>
          <FormField id="checkin-week" label="Week of">
            {(input) => (
              <select
                {...input}
                value={week}
                onChange={(event) => pickWeek(event.target.value)}
                className="h-11 rounded-md border border-input bg-card px-3"
              >
                {weeks.map((key) => (
                  <option key={key} value={key}>
                    {formatDay(key)}
                    {key === lastWeek ? " (last week)" : ""}
                    {byWeek.has(key) ? " · done" : ""}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {CHECKIN_AREAS.map((area) => (
            <fieldset key={area.key} className="flex flex-col gap-2">
              <legend className="mb-2 font-medium">{area.label}</legend>
              <div className="grid grid-cols-5 gap-1 rounded-lg bg-muted p-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className="relative">
                    <input
                      type="radio"
                      name={area.key}
                      value={n}
                      checked={scores[area.key] === n}
                      onChange={() => setScores((prev) => ({ ...prev, [area.key]: n }))}
                      className="peer sr-only"
                      aria-label={`${area.label} ${n}${CHECKIN_ANCHORS[n] ? `, ${CHECKIN_ANCHORS[n]}` : ""}`}
                    />
                    <span className="flex min-h-11 cursor-pointer items-center justify-center rounded-md text-sm font-semibold text-muted-foreground peer-checked:bg-card peer-checked:text-foreground peer-checked:shadow-card peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
                      {n}
                    </span>
                  </label>
                ))}
              </div>
              <p className="flex justify-between text-xs text-muted-foreground" aria-hidden>
                <span>1 {CHECKIN_ANCHORS[1]}</span>
                <span>5 {CHECKIN_ANCHORS[5]}</span>
              </p>
            </fieldset>
          ))}
          <FormField id="checkin-comment" label="Comment" hint={`Optional. ${comment.length}/1000 characters.`}>
            {(input) => (
              <textarea
                {...input}
                value={comment}
                maxLength={1000}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                className="min-h-20 rounded-md border border-input bg-card px-3 py-2"
              />
            )}
          </FormField>
          {error ? <FormMessage>{error}</FormMessage> : null}
          <Button type="submit" disabled={!complete || busy} className="w-fit">
            {byWeek.has(week) ? "Update check-in" : "Save check-in"}
          </Button>
          {!complete ? <p className="text-sm text-muted-foreground">Rate all three areas to save.</p> : null}
        </form>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="caption font-semibold text-muted-foreground">Past check-ins</h2>
        {checkins.length === 0 ? (
          <EmptyState>No check-ins yet.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {checkins.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 rounded-xl bg-card p-4 shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">Week of {formatDay(row.week_start)}</p>
                  <StatusChip
                    tone={checkinAverage(row) < 3 ? "warn" : "ok"}
                    label={`Average ${checkinAverage(row).toFixed(1)}`}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Reliability {row.reliability} · Quality {row.quality} · Communication {row.communication}
                </p>
                {row.comment ? <p className="text-sm">{row.comment}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function scoresOf(row: Checkin | undefined): CheckinScores {
  return row ? { reliability: row.reliability, quality: row.quality, communication: row.communication } : EMPTY;
}

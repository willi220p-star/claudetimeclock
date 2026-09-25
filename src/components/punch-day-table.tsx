"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { dayHeading, formatTimeOnly, localDateInput, type EventType } from "@/lib/daymark";

type SlotPunch = {
  id: string;
  event_type: EventType;
  occurred_at: string;
  place_name: string | null;
  photoUrl: string | null;
};

type Slot = {
  id: string;
  occurred_at: string;
  place_name: string | null;
  photoUrl: string | null;
};

type DayRow = {
  id: string;
  shift_in: Slot | null;
  shift_out: Slot | null;
  break_in: Slot | null;
  break_out: Slot | null;
};

const COLUMNS: Array<{ key: keyof Omit<DayRow, "id">; label: string }> = [
  { key: "shift_in", label: "Clock in" },
  { key: "shift_out", label: "Clock out" },
  { key: "break_in", label: "Break in" },
  { key: "break_out", label: "Break out" },
];

export function PunchDayTable({ punches }: { punches: SlotPunch[] }) {
  const [photo, setPhoto] = useState<{ src: string; title: string; place: string | null } | null>(null);
  const days = useMemo(() => groupDays(punches), [punches]);

  if (days.length === 0) {
    return (
      <p className="rounded-2xl bg-card px-4 py-8 text-sm leading-relaxed text-muted-foreground">
        No punches yet. Clock in at the Regus office and the time, place, and photo land in this table.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {days.map((day) => (
        <section key={day.dateKey} className="flex flex-col gap-3">
          <h2 className="font-heading text-xl tracking-tight">{day.heading}</h2>
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  {COLUMNS.map((column) => (
                    <th key={column.key} className="px-3 py-2 font-medium">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {day.rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0 align-top">
                    {COLUMNS.map((column) => (
                      <td key={column.key} className="px-3 py-3">
                        <SlotCell
                          slot={row[column.key]}
                          label={column.label}
                          onPhoto={(src, title, place) => setPhoto({ src, title, place })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <Dialog open={photo !== null} onOpenChange={(open) => { if (!open) setPhoto(null); }}>
        <DialogContent>
          {photo ? (
            <>
              <DialogTitle>{photo.title}</DialogTitle>
              {/* Signed photo URLs expire and are not a stable remote image host. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.src} alt="" className="mt-3 max-h-[70vh] w-full rounded-xl object-contain" />
              {photo.place ? <p className="mt-3 text-sm leading-relaxed">{photo.place}</p> : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SlotCell({
  slot,
  label,
  onPhoto,
}: {
  slot: Slot | null;
  label: string;
  onPhoto: (src: string, title: string, place: string | null) => void;
}) {
  if (!slot) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium tabular-nums">{formatTimeOnly(slot.occurred_at)}</p>
      <p className="text-xs leading-snug text-muted-foreground">{slot.place_name ?? "Place not recorded"}</p>
      {slot.photoUrl ? (
        <button
          type="button"
          className="mt-1 size-10 overflow-hidden rounded-lg border"
          onClick={() => onPhoto(slot.photoUrl!, `${label} · ${formatTimeOnly(slot.occurred_at)}`, slot.place_name)}
          aria-label={`Open the ${label.toLowerCase()} photo`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slot.photoUrl} alt="" className="size-full object-cover" />
        </button>
      ) : null}
    </div>
  );
}

function groupDays(punches: SlotPunch[]) {
  const byDay = new Map<string, SlotPunch[]>();
  for (const punch of punches) {
    const key = localDateInput(new Date(punch.occurred_at));
    const list = byDay.get(key);
    if (list) list.push(punch);
    else byDay.set(key, [punch]);
  }

  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([dateKey, dayPunches]) => ({
      dateKey,
      heading: dayHeading(dateKey),
      rows: rowsForDay(dayPunches),
    }));
}

function rowsForDay(punches: SlotPunch[]): DayRow[] {
  const sorted = [...punches].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const rows: DayRow[] = [];
  let current: DayRow | null = null;

  for (const punch of sorted) {
    const key = punch.event_type;
    if (!current || current[key]) {
      current = {
        id: punch.id,
        shift_in: null,
        shift_out: null,
        break_in: null,
        break_out: null,
      };
      rows.push(current);
    }
    current[key] = {
      id: punch.id,
      occurred_at: punch.occurred_at,
      place_name: punch.place_name,
      photoUrl: punch.photoUrl,
    };
  }

  return rows;
}

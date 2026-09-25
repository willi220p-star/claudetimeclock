"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { StatusChip } from "@/components/status-chip";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatDay, formatTime } from "@/lib/darwin";
import { errorText, FLAG_LABEL, formatDistance, SOURCE_LABEL } from "@/lib/daymark";
import { selfieUrl, type PunchCard } from "@/lib/punches";
import { punchDays } from "@/lib/time";

/** Punches by Darwin day, one clock-in/clock-out pair per row. `detail` adds distance, accuracy and flags. */
export function PunchDayTable({ punches, detail = false }: { punches: PunchCard[]; detail?: boolean }) {
  const [photo, setPhoto] = useState<{ url: string; title: string } | null>(null);
  const days = useMemo(() => punchDays(punches), [punches]);

  async function openSelfie(punch: PunchCard, title: string) {
    try {
      setPhoto({ url: await selfieUrl(punch.photo_path!), title });
    } catch (error) {
      toast.error(errorText(error, "That selfie didn't open. Try again."));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {days.map((day) => (
        <section key={day.dateKey} className="flex flex-col gap-2">
          <h3 className="font-semibold">{formatDay(day.dateKey)}</h3>
          <ul className="flex flex-col gap-2">
            {day.rows.map((row) => (
              <li key={row.id} className="grid grid-cols-1 gap-4 rounded-lg bg-card p-4 shadow-card sm:grid-cols-2">
                <PunchCell punch={row.in} label="Clock in" detail={detail} onOpen={openSelfie} />
                <PunchCell punch={row.out} label="Clock out" detail={detail} onOpen={openSelfie} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      <Dialog
        open={photo !== null}
        onOpenChange={(open) => {
          if (!open) setPhoto(null);
        }}
      >
        <DialogContent>
          {photo ? (
            <>
              <DialogTitle>{photo.title}</DialogTitle>
              <DialogDescription>Selfies are private. Each view uses a link that expires after 60 seconds.</DialogDescription>
              {/* Signed URLs expire in 60 seconds, so next/image caching doesn't apply. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className="mt-4 max-h-[70vh] w-full rounded-lg object-contain" />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PunchCell({
  punch,
  label,
  detail,
  onOpen,
}: {
  punch: PunchCard | null;
  label: string;
  detail: boolean;
  onOpen: (punch: PunchCard, title: string) => void;
}) {
  if (!punch) {
    return (
      <div>
        <p className="caption text-muted-foreground">{label}</p>
        <p className="text-muted-foreground">
          <span aria-hidden>—</span>
          <span className="sr-only">None</span>
        </p>
      </div>
    );
  }

  const time = formatTime(punch.occurred_at);
  const flags = punch.flags.filter((flag) => FLAG_LABEL[flag]);
  return (
    <div className="flex min-w-0 items-start gap-3">
      {punch.photoUrl ? (
        <button
          type="button"
          className="size-11 shrink-0 overflow-hidden rounded-md border border-border"
          onClick={() => onOpen(punch, `${label} · ${formatDay(punch.occurred_at)}, ${time}`)}
          aria-label={`Open the ${label.toLowerCase()} selfie from ${time}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={punch.photoUrl} alt="" className="size-full object-cover" />
        </button>
      ) : null}
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="caption text-muted-foreground">{label}</p>
        <p className="font-semibold">{time}</p>
        {punch.place_name ? <p className="truncate text-sm text-muted-foreground">{punch.place_name}</p> : null}
        {detail && punch.distance_m !== null ? (
          <p className="text-sm text-muted-foreground">
            {formatDistance(punch.distance_m)} from the office
            {punch.accuracy_m !== null ? ` · ±${formatDistance(punch.accuracy_m)}` : ""}
          </p>
        ) : null}
        {detail && (flags.length > 0 || SOURCE_LABEL[punch.source]) ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {SOURCE_LABEL[punch.source] ? <StatusChip tone="neutral" label={SOURCE_LABEL[punch.source]} /> : null}
            {flags.map((flag) => (
              <StatusChip key={flag} tone="warn" label={FLAG_LABEL[flag]} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

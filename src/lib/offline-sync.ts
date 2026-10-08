"use client";

import { errorText, PHOTO_BUCKET } from "@/lib/daymark";
import { listQueue, removeFromQueue, type QueuedItem } from "@/lib/offline-queue";
import { createClient } from "@/lib/supabase/client";

export type SyncResult = { sent: number; refused: { item: QueuedItem; message: string }[]; waiting: number };

/** No signal (keep the item and retry) versus the database saying no (drop it and tell the intern). */
export function isNetworkError(error: unknown) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error);
  return /failed to fetch|load failed|network|fetch failed|timed? ?out/i.test(message);
}

let running: Promise<SyncResult> | null = null;

/** Send this phone's waiting clocks, oldest first; stop at the first network failure. One run at a time. */
export function syncQueue(userId: string) {
  running ??= send(userId).finally(() => {
    running = null;
  });
  return running;
}

async function send(userId: string): Promise<SyncResult> {
  const supabase = createClient();
  const items = await listQueue(userId);
  const result: SyncResult = { sent: 0, refused: [], waiting: 0 };
  for (const [index, item] of items.entries()) {
    try {
      if (item.kind === "log") {
        const { error } = await supabase.rpc("save_work_log", { work_date: item.workDate, summary: item.summary });
        if (error) throw error;
      } else if (item.kind === "typed") {
        // ponytail: typed times only count for today (report_missed_time); one sent a day late is refused and reported.
        const { error } = await supabase.rpc("report_missed_time", { event: item.event, at_time: item.atTime, note: item.note ?? undefined });
        if (error) throw error;
      } else {
        const { error: uploadError } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(`${userId}/${item.id}.jpg`, item.photo, { contentType: "image/jpeg", upsert: false });
        // Uploaded on an earlier try whose reply was lost: carry on.
        if (uploadError && !/exists|duplicate/i.test(uploadError.message)) throw uploadError;
        const { error } = await supabase.rpc("submit_offline_punch", {
          offline_id: item.id,
          action: item.action,
          occurred_at: item.occurredAt,
          latitude: item.latitude,
          longitude: item.longitude,
          accuracy_m: item.accuracy,
          gesture: item.gesture,
          day_kind: item.dayKind ?? undefined,
        });
        if (error) throw error;
      }
      await removeFromQueue(item.id);
      result.sent += 1;
    } catch (error) {
      if (isNetworkError(error)) {
        result.waiting = items.length - index;
        return result;
      }
      // ponytail: a refused clock is dropped after telling the intern; the supervisor can add the time
      // on Timesheets. Upgrade path: keep refused items in a "needs attention" list.
      await removeFromQueue(item.id);
      result.refused.push({ item, message: errorText(error, "That clock couldn't be saved.") });
    }
  }
  return result;
}

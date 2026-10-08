"use client";

import { errorText, PHOTO_BUCKET } from "@/lib/daymark";
import { addToQueue, listQueue, removeFromQueue } from "@/lib/offline-queue";
import { createClient } from "@/lib/supabase/client";

/** `consent`: the server wants the notice acknowledged again before anything more is sent. */
export type SyncResult = { sent: number; refused: number; waiting: number; consent: boolean };

/** No signal: the clock sheet keeps the clock on the phone instead of showing an error. */
export function isNetworkError(error: unknown) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error);
  return /failed to fetch|load failed|network|fetch failed|timed? ?out/i.test(message);
}

// The database's own refusals (raise ... using errcode): sending again won't change the answer.
const REFUSAL_CODES = new Set(["22023", "42501", "P0001"]);

/**
 * What a failed send means for a waiting item: `refused` is a definite "no" (set it aside and tell the
 * intern); `consent` stops the whole sync until the notice is acknowledged again; anything else
 * (no signal, 5xx, a captive portal's HTML, a day-type question) is `retry`: keep it and try later.
 */
export function syncVerdict(error: unknown): "refused" | "consent" | "retry" {
  const { code, hint } = (typeof error === "object" && error !== null ? error : {}) as { code?: unknown; hint?: unknown };
  if (hint === "consent") return "consent";
  if (hint === "day_kind" || typeof code !== "string" || !REFUSAL_CODES.has(code)) return "retry";
  return "refused";
}

const running = new Map<string, Promise<SyncResult>>();

/** Send this phone's waiting clocks, oldest first; stop at the first one that can't go yet. One run per person. */
export function syncQueue(userId: string) {
  let run = running.get(userId);
  if (!run) {
    run = send(userId).finally(() => running.delete(userId));
    running.set(userId, run);
  }
  return run;
}

async function send(userId: string): Promise<SyncResult> {
  const supabase = createClient();
  const items = (await listQueue(userId)).filter((item) => !item.refused);
  const result: SyncResult = { sent: 0, refused: 0, waiting: 0, consent: false };
  for (const [index, item] of items.entries()) {
    try {
      if (item.kind === "log") {
        const { error } = await supabase.rpc("save_work_log", { work_date: item.workDate, summary: item.summary });
        if (error) throw error;
      } else if (item.kind === "typed") {
        // Filed on the day of `at` (the day it was typed), not the day it reaches the server.
        const { error } = await supabase.rpc("submit_offline_typed", {
          offline_id: item.id,
          event: item.event,
          at: item.occurredAt,
          note: item.note ?? undefined,
          day_kind: item.dayKind ?? undefined,
        });
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
      const verdict = syncVerdict(error);
      if (verdict !== "refused") {
        result.waiting = items.length - index;
        result.consent = verdict === "consent";
        return result;
      }
      // Set aside on this phone so Home can say what happened; the supervisor adds the time.
      await addToQueue({ ...item, refused: errorText(error, "The server refused it.") });
      result.refused += 1;
    }
  }
  return result;
}

"use client";

import { PHOTO_BUCKET, PUNCH_COLUMNS, SHIFT_EVENTS, SIGNED_URL_SECONDS, type Punch } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";

export type PunchCard = Punch & { photoUrl: string | null };

/** Clock-ins and clock-outs, newest first, with 60-second signed selfie thumbnails (§14). */
export async function loadPunches({
  userId,
  since,
  limit,
}: {
  userId?: string;
  since?: string;
  limit: number;
}): Promise<PunchCard[]> {
  const supabase = createClient();
  let query = supabase
    .from("daymark_punches")
    .select(PUNCH_COLUMNS)
    .in("event_type", SHIFT_EVENTS)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (userId) query = query.eq("user_id", userId);
  if (since) query = query.gte("occurred_at", since);

  const { data, error } = await query;
  if (error) throw error;
  const rows = data as Punch[];

  const paths = rows.map((row) => row.photo_path).filter((path): path is string => Boolean(path));
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
    }
  }
  return rows.map((row) => ({ ...row, photoUrl: row.photo_path ? (urls.get(row.photo_path) ?? null) : null }));
}

/** A fresh 60-second link for opening one selfie full size. */
export async function selfieUrl(path: string) {
  const { data, error } = await createClient().storage.from(PHOTO_BUCKET).createSignedUrls([path], SIGNED_URL_SECONDS);
  const url = data?.[0]?.signedUrl;
  if (error || !url) throw error ?? new Error("That selfie didn't open. Try again.");
  return url;
}

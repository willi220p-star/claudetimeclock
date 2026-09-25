"use client";

import type { Punch } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";

export type PunchCard = Punch & { photoUrl: string | null };

const ownPunchLoads = new Map<string, Promise<PunchCard[]>>();

export function forgetOwnPunches() {
  ownPunchLoads.clear();
}

export function ownPunches(userId: string) {
  const existing = ownPunchLoads.get(userId);
  if (existing) return existing;
  const pending = loadOwnPunches(userId);
  ownPunchLoads.set(userId, pending);
  return pending;
}

export async function loadOwnPunches(userId: string): Promise<PunchCard[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("daymark_punches")
    .select("id, user_id, event_type, occurred_at, latitude, longitude, accuracy_m, photo_path, place_name")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false })
    .limit(80);

  if (error || !data) return [];

  const rows = data as Punch[];
  const urls = new Map<string, string>();
  if (rows.length > 0) {
    const { data: signed } = await supabase.storage
      .from("daymark-photos")
      .createSignedUrls(
        rows.map((row) => row.photo_path),
        60 * 60,
      );
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
    }
  }

  return rows.map((row) => ({ ...row, photoUrl: urls.get(row.photo_path) ?? null }));
}

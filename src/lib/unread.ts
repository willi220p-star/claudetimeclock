"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { unreadNotificationCount } from "@/lib/data";
import type { Tables } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";

type Notification = Tables<"daymark_notifications">;

/**
 * Live changes to one person's notifications over Supabase Realtime. The table is in the
 * `supabase_realtime` publication and RLS limits delivery to the person's own rows; the filter
 * just keeps the stream small. Returns the unsubscribe.
 */
export function subscribeNotifications(
  personId: string,
  on: { insert?: (row: Notification) => void; update?: () => void },
) {
  const supabase = createClient();
  const filter = `person_id=eq.${personId}`;
  const table = "daymark_notifications";
  const channel = supabase.channel(`notifications:${personId}:${crypto.randomUUID()}`);
  if (on.insert) {
    const insert = on.insert;
    channel.on<Notification>("postgres_changes", { event: "INSERT", schema: "public", table, filter }, (change) =>
      insert(change.new),
    );
  }
  if (on.update) channel.on("postgres_changes", { event: "UPDATE", schema: "public", table, filter }, on.update);
  channel.subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** The header bell count: fetched once, then kept live, with a toast for each new notification. */
export function useLiveUnread(personId: string) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    const refresh = () =>
      unreadNotificationCount(personId).then(
        (next) => {
          if (live) setCount(next);
        },
        () => undefined,
      );
    void refresh();
    const stop = subscribeNotifications(personId, {
      insert: (row) => {
        toast(row.title, { description: row.body });
        void refresh();
      },
      update: () => void refresh(), // read on another page or device
    });
    return () => {
      live = false;
      stop();
    };
  }, [personId]);
  return count;
}

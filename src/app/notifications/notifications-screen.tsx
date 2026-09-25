"use client";

import { useCallback, useEffect, useState } from "react";
import { InternFrame } from "@/app/clock/intern-frame";
import { EmptyState } from "@/components/empty-state";
import { LoadBlock } from "@/components/load-block";
import { DeskGate } from "@/components/desk-gate";
import { buttonVariants } from "@/components/ui/button";
import { loadNotifications } from "@/lib/data";
import { relativeOrDate } from "@/lib/darwin";
import type { Profile } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";
import Link from "next/link";

export function NotificationsScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <InternFrame profile={profile} title="Notifications">
          <NotificationsDesk profile={profile} />
        </InternFrame>
      )}
    </DeskGate>
  );
}

function NotificationsDesk({ profile }: { profile: Profile }) {
  const load = useCallback(() => loadNotifications(profile.id, 40), [profile.id]);
  const [state, reload] = useLoad(load);
  const [now] = useState(() => new Date());

  useEffect(() => {
    if (state.status !== "ready") return;
    const unread = state.data.filter((row) => !row.read_at).map((row) => row.id);
    if (unread.length === 0) return;
    void createClient().rpc("mark_notifications_read", { ids: unread });
  }, [state]);

  return (
    <div className="flex flex-col gap-6">
      <h1>Notifications</h1>
      <LoadBlock
        state={state}
        reload={reload}
        empty="No notifications yet."
        action={
          <Link href="/clock" className={buttonVariants({ variant: "secondary" })}>
            Back to Today
          </Link>
        }
      >
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState action={<Link href="/clock" className={buttonVariants({ variant: "secondary" })}>Back to Today</Link>}>
              No notifications yet.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <li key={row.id} className="rounded-xl bg-card p-4 shadow-card">
                  <p className="font-semibold">{row.title}</p>
                  <p className="text-sm text-muted-foreground">{row.body}</p>
                  <p className="caption mt-1 text-muted-foreground">{relativeOrDate(row.created_at, now)}</p>
                  {row.link ? (
                    <Link href={row.link} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary">
                      Open
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        }
      </LoadBlock>
    </div>
  );
}

"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { InternFrame } from "@/app/clock/intern-frame";
import { EmptyState } from "@/components/empty-state";
import { LoadBlock } from "@/components/load-block";
import { Opening, useHydrated } from "@/components/desk-gate";
import { StaffShell } from "@/components/desk-shell";
import { buttonVariants } from "@/components/ui/button";
import { sessionProfile } from "@/lib/browser-session";
import { loadNotifications, markNotificationsRead } from "@/lib/data";
import { relativeOrDate } from "@/lib/darwin";
import type { Profile } from "@/lib/daymark";
import { ROLE_HOME, rolesOf } from "@/lib/roles";
import { useLoad } from "@/lib/use-load";
import { useRouter } from "next/navigation";

export function NotificationsScreen() {
  if (!useHydrated()) return <Opening label="Opening notifications…" />;
  return <NotificationsSession />;
}

function NotificationsSession() {
  const router = useRouter();
  const profile = use(sessionProfile());

  useEffect(() => {
    if (!profile) router.replace("/");
  }, [profile, router]);

  if (!profile) return <Opening label="Sending you to sign in…" />;

  const role = rolesOf(profile)[0];
  const body = <NotificationsDesk profile={profile} home={role ? ROLE_HOME[role] : "/"} />;
  if (role === "intern") {
    return (
      <InternFrame profile={profile} title="Notifications">
        {body}
      </InternFrame>
    );
  }
  if (role === "supervisor" || role === "admin") {
    return (
      <StaffShell profile={profile} role={role} title="Notifications">
        {body}
      </StaffShell>
    );
  }
  return body;
}

function NotificationsDesk({ profile, home }: { profile: Profile; home: string }) {
  const load = useCallback(() => loadNotifications(profile.id, 40), [profile.id]);
  const [state, reload] = useLoad(load);
  const [now] = useState(() => new Date());

  useEffect(() => {
    if (state.status !== "ready") return;
    const unread = state.data.filter((row) => !row.read_at).map((row) => row.id);
    if (unread.length === 0) return;
    void markNotificationsRead(unread).catch(() => undefined);
  }, [state]);

  return (
    <div className="flex flex-col gap-6">
      <h1>Notifications</h1>
      <LoadBlock
        state={state}
        reload={reload}
        empty="No notifications yet."
        action={
          <Link href={home} className={buttonVariants({ variant: "secondary" })}>
            Back
          </Link>
        }
      >
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState action={<Link href={home} className={buttonVariants({ variant: "secondary" })}>Back</Link>}>
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

"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { InternShell, StaffShell } from "@/components/desk-shell";
import { EmptyState } from "@/components/empty-state";
import { LoadBlock } from "@/components/load-block";
import { Opening, useHydrated } from "@/components/desk-gate";
import { useSelection } from "@/components/bulk-decide";
import { AppearanceCard } from "@/components/appearance-card";
import { PushToggle } from "@/components/push-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { sessionProfile } from "@/lib/browser-session";
import { loadNotifications, markNotificationsRead } from "@/lib/data";
import { relativeOrDate } from "@/lib/darwin";
import { errorText, type Profile } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";
import { ROLE_HOME, rolesOf } from "@/lib/roles";
import { subscribeNotifications } from "@/lib/unread";
import { useLoad } from "@/lib/use-load";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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
      <InternShell profile={profile} title="Notifications">
        {body}
      </InternShell>
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
  const rows = state.status === "ready" ? state.data : [];
  const selection = useSelection(rows.map((row) => row.id));
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  /** Deleted from the database for good (8 Oct); null deletes all of yours. */
  async function remove(ids: string[] | null) {
    setBusy(true);
    const { data, error } = await createClient().rpc("delete_my_notifications", { ids: ids ?? undefined });
    setBusy(false);
    setConfirmAll(false);
    if (error) {
      toast.error(errorText(error, "Those didn't delete. Try again."));
      return;
    }
    toast.success(`${data ?? 0} deleted.`);
    selection.clear();
    reload();
  }

  // New ones appear without a refresh; the effect below then marks them read.
  useEffect(() => subscribeNotifications(profile.id, { insert: reload }), [profile.id, reload]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const unread = state.data.filter((row) => !row.read_at).map((row) => row.id);
    if (unread.length === 0) return;
    void markNotificationsRead(unread).catch(() => undefined);
  }, [state]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>Notifications</h1>
        {rows.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || selection.selected.length === 0}
              onClick={() => void remove(selection.selected)}
            >
              Delete selected{selection.selected.length > 0 ? ` (${selection.selected.length})` : ""}
            </Button>
            {confirmAll ? (
              <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove(null)}>
                Delete all for good
              </Button>
            ) : (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmAll(true)}>
                Delete all
              </Button>
            )}
          </div>
        ) : null}
      </div>
      {/* Staff turn on phone reminders here; interns also have it on Me. */}
      <PushToggle />
      <AppearanceCard />
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
            <EmptyState
              action={
                <Link href={home} className={buttonVariants({ variant: "secondary" })}>
                  Back
                </Link>
              }
            >
              No notifications yet.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <li key={row.id} className="flex items-start gap-3 rounded-xl bg-card p-4 shadow-card">
                  <input
                    type="checkbox"
                    aria-label={`Select "${row.title}"`}
                    className="mt-1 size-5 shrink-0 accent-primary"
                    checked={selection.has(row.id)}
                    onChange={() => selection.toggle(row.id)}
                  />
                  <div className="flex min-w-0 flex-col">
                    <p className="font-semibold">{row.title}</p>
                    <p className="text-sm text-muted-foreground">{row.body}</p>
                    <p className="caption mt-1 text-muted-foreground">{relativeOrDate(row.created_at, now)}</p>
                    {row.link ? (
                      <Link href={row.link} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary">
                        Open
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </LoadBlock>
    </div>
  );
}

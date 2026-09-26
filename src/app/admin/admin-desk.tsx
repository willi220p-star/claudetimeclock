"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddPersonForm } from "@/app/admin/add-person-form";
import { PersonDialogs, type PersonDialog } from "@/app/admin/person-dialogs";
import { EmptyState } from "@/components/empty-state";
import { FormMessage } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { PunchDayTable } from "@/components/punch-day-table";
import { StatusChip } from "@/components/status-chip";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { clearSessionCache } from "@/lib/browser-session";
import { darwinAt, darwinDateKey } from "@/lib/darwin";
import { errorText, PROFILE_COLUMNS, type Profile } from "@/lib/daymark";
import { addDays } from "@/lib/periods";
import { loadPunches, type PunchCard } from "@/lib/punches";
import { ROLE_LABEL } from "@/lib/roles";
import { createClient } from "@/lib/supabase/client";
import { useLoad, type Loaded } from "@/lib/use-load";

type Access = Pick<Profile, "is_intern" | "is_supervisor" | "is_admin" | "active">;

const ROLE_FLAGS = [
  ["is_intern", ROLE_LABEL.intern],
  ["is_supervisor", ROLE_LABEL.supervisor],
  ["is_admin", ROLE_LABEL.admin],
] as const;

function roleChangeText(name: string, label: string, on: boolean) {
  const role = label.toLowerCase();
  return `${name} ${on ? "is now" : "is no longer"} ${/^[aeiou]/.test(role) ? "an" : "a"} ${role}.`;
}

async function loadPeople() {
  const { data, error } = await createClient().from("daymark_profiles").select(PROFILE_COLUMNS).order("display_name");
  if (error) throw error;
  return data;
}

export function AdminDesk({ profile }: { profile: Profile }) {
  const [people, reloadPeople] = useLoad(loadPeople);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 py-6">
      <PageHeader
        title="People"
        description="Add people, choose their roles, and set temporary passwords. Nobody can see a password."
        actions={
          <Link href="/set-password" className={buttonVariants({ variant: "ghost" })}>
            Change my password
          </Link>
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[360px_1fr]">
        <AddPersonForm people={people.status === "ready" ? people.data : []} onAdded={reloadPeople} />
        <PeopleList me={profile} people={people} reload={reloadPeople} />
      </div>
      <TimeCards people={people.status === "ready" ? people.data : []} />
    </div>
  );
}

function PeopleList({ me, people, reload }: { me: Profile; people: Loaded<Profile[]>; reload: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [dialog, setDialog] = useState<PersonDialog>(null);

  async function setAccess(person: Profile, change: Partial<Access>, done: string) {
    const next = { ...person, ...change };
    setPending(person.id);
    const { error } = await createClient().rpc("set_person_access", {
      target_id: person.id,
      is_intern: next.is_intern,
      is_supervisor: next.is_supervisor,
      is_admin: next.is_admin,
      active: next.active,
    });
    setPending(null);
    if (error) {
      toast.error(errorText(error, "That change didn't save. Try again."));
      return false;
    }
    toast.success(done);
    if (person.id === me.id && (!next.is_admin || !next.active)) {
      // You changed your own access: start again from sign-in, which routes you to the right desk.
      clearSessionCache();
      if (!next.active) await createClient().auth.signOut();
      router.replace("/");
      return true;
    }
    reload();
    return true;
  }

  return (
    <section aria-labelledby="people-title" className="flex flex-col gap-3">
      <h2 id="people-title">Everyone</h2>
      {people.status === "loading" ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">Loading people…</span>
          <Skeleton className="h-36 w-full rounded-lg" />
          <Skeleton className="h-36 w-full rounded-lg" />
        </div>
      ) : people.status === "error" ? (
        <div className="flex flex-col items-start gap-3">
          <FormMessage>{people.message}</FormMessage>
          <Button type="button" variant="secondary" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : people.data.length === 0 ? (
        <EmptyState>No one here yet. Add the first person with the form.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {people.data.map((person) => (
            <li key={person.id} className="flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {person.display_name}
                    {person.id === me.id ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
                  </p>
                  <p className="text-sm break-all text-muted-foreground">{person.contact_email ?? "No email yet"}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <StatusChip tone={person.active ? "ok" : "neutral"} label={person.active ? "Active" : "Deactivated"} />
                  {person.must_change_password ? <StatusChip tone="info" label="Password change due" /> : null}
                </div>
              </div>
              <fieldset disabled={pending === person.id} className="flex flex-wrap gap-x-5">
                <legend className="sr-only">Roles for {person.display_name}</legend>
                {ROLE_FLAGS.map(([flag, label]) => (
                  <label key={flag} className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={person[flag]}
                      onChange={(event) =>
                        void setAccess(
                          person,
                          { [flag]: event.target.checked },
                          roleChangeText(person.display_name, label, event.target.checked),
                        )
                      }
                      className="size-5 accent-primary"
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setDialog({ kind: "password", person })}>
                  Set password
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setDialog({ kind: "email", person })}>
                  Change email
                </Button>
                {person.active ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDialog({ kind: "deactivate", person })}>
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending === person.id}
                    onClick={() => void setAccess(person, { active: true }, `${person.display_name} can sign in again.`)}
                  >
                    Reactivate
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <PersonDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          reload();
        }}
        onDeactivate={async (person) => {
          if (await setAccess(person, { active: false }, `${person.display_name} is deactivated.`)) setDialog(null);
        }}
      />
    </section>
  );
}

function TimeCards({ people }: { people: Profile[] }) {
  const [personId, setPersonId] = useState("all");
  const load = useCallback(() => {
    // A display window only: from midnight Darwin time 30 days ago.
    const since = darwinAt(addDays(darwinDateKey(new Date()), -30), "00:00").toISOString();
    return loadPunches({ userId: personId === "all" ? undefined : personId, since, limit: 400 });
  }, [personId]);
  const [punches, reload] = useLoad(load);
  const names = useMemo(() => new Map(people.map((person) => [person.id, person.display_name])), [people]);
  const byPerson = useMemo(() => {
    if (punches.status !== "ready") return [];
    const groups = new Map<string, PunchCard[]>();
    for (const punch of punches.data) groups.set(punch.user_id, [...(groups.get(punch.user_id) ?? []), punch]);
    return [...groups.entries()];
  }, [punches]);

  return (
    <section aria-labelledby="time-cards-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="time-cards-title">Clock-ins, last 30 days</h2>
          <p className="text-sm text-muted-foreground">Tap a selfie to see it larger. Flags point to things worth a check.</p>
        </div>
        <div className="flex flex-col gap-2 sm:w-64">
          <Label htmlFor="time-card-person">Intern</Label>
          <select
            id="time-card-person"
            value={personId}
            onChange={(event) => setPersonId(event.target.value)}
            className="h-11 rounded-md border border-input bg-card px-3"
          >
            <option value="all">Everyone</option>
            {people
              .filter((person) => person.is_intern)
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.display_name}
                </option>
              ))}
          </select>
        </div>
      </div>
      {punches.status === "loading" ? (
        <div role="status">
          <span className="sr-only">Loading clock-ins…</span>
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      ) : punches.status === "error" ? (
        <div className="flex flex-col items-start gap-3">
          <FormMessage>{punches.message}</FormMessage>
          <Button type="button" variant="secondary" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : byPerson.length === 0 ? (
        <EmptyState action={<Button type="button" variant="secondary" onClick={reload}>Refresh</Button>}>
          No clock-ins in the last 30 days. They show here as soon as an intern clocks in.
        </EmptyState>
      ) : (
        byPerson.map(([userId, cards]) => (
          <section key={userId} aria-label={names.get(userId) ?? "Intern"} className="flex flex-col gap-3">
            <h3 className="text-lg font-semibold">{names.get(userId) ?? "Intern"}</h3>
            <PunchDayTable punches={cards} detail />
          </section>
        ))
      )}
    </section>
  );
}

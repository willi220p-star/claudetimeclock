"use client";

import { use, useCallback, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PrivacyCard } from "@/app/clock/privacy-card";
import { AppearanceCard } from "@/components/appearance-card";
import { InstallCard } from "@/components/install-card";
import { PushToggle } from "@/components/push-toggle";
import { Avatar } from "@/components/avatar";
import { InternShell } from "@/components/desk-shell";
import { DeskGate } from "@/components/desk-gate";
import { EmptyState } from "@/components/empty-state";
import { FormField, FormMessage } from "@/components/form-field";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { PdfDownloads } from "@/components/pdf-downloads";
import { SignOutButton } from "@/components/sign-out-button";
import { WorkLogSheet } from "@/components/work-log-sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadMyPlacement, loadWorkLogs } from "@/lib/data";
import { formatDay } from "@/lib/darwin";
import { clearSessionCache, sessionConsent } from "@/lib/browser-session";
import { errorText, type Profile } from "@/lib/daymark";
import { loadPunches } from "@/lib/punches";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

export function MeScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <InternShell profile={profile} title="Me">
          <MeDesk profile={profile} />
        </InternShell>
      )}
    </DeskGate>
  );
}

async function nameOf(id: string | null) {
  if (!id) return null;
  const { data } = await createClient().from("daymark_profiles").select("display_name").eq("id", id).maybeSingle();
  return data?.display_name ?? null;
}

function MeDesk({ profile }: { profile: Profile }) {
  const [logDate, setLogDate] = useState<string | null>(null);
  const [consent, setConsent] = useState(use(sessionConsent()));
  const load = useCallback(async () => {
    const [placement, punches] = await Promise.all([
      loadMyPlacement(),
      loadPunches({ userId: profile.id, limit: 10 }).catch(() => []),
    ]);
    const photo = punches.find((punch) => punch.photoUrl)?.photoUrl ?? null;
    if (!placement) return { placement: null, logs: [], approver: null as string | null, supervisor: null as string | null, photo };
    const [logs, approver, supervisor] = await Promise.all([
      loadWorkLogs(placement.id),
      nameOf(placement.report_approved_by),
      nameOf(placement.supervisor_id),
    ]);
    return { placement, logs, approver, supervisor, photo };
  }, [profile.id]);
  const [state, reload] = useLoad(load);

  return (
    <>
      <PageHeader title="Me" description="Your profile, work logs and intern report." />
      <LoadBlock state={state} reload={reload}>
        {({ placement, logs, approver, supervisor, photo }) => (
          <div className="flex flex-col gap-6">
            <ProfileCard profile={profile} photo={photo} supervisor={supervisor} />
            <InstallCard />
            <PushToggle />
            <AppearanceCard />
            <PrivacyCard consent={consent} onChange={setConsent} />
            {!placement ? <EmptyState>No placement on this login yet.</EmptyState> : null}
            <section className="flex flex-col gap-2 rounded-xl bg-card p-6 shadow-card">
              <h2>Intern report</h2>
              {placement?.report_approved_at ? (
                <p>
                  Your intern report is <span className="font-semibold">approved</span>
                  {approver ? ` by ${approver}` : ""} on {formatDay(placement.report_approved_at)}.
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Your supervisor approves the intern report when your hours are final. The download will show here.
                </p>
              )}
              {placement ? (
                <PdfDownloads
                  placementId={placement.id}
                  status={placement.status}
                  reportApprovedAt={placement.report_approved_at}
                  report={Boolean(placement.report_approved_at)}
                />
              ) : null}
            </section>
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h2>Work logs</h2>
                <Button type="button" variant="secondary" onClick={() => setLogDate(placement?.start_date ?? "")}>
                  Write log
                </Button>
              </div>
              {logs.length === 0 ? (
                <EmptyState>No work logs yet. Write one after a shift.</EmptyState>
              ) : (
                <ul className="flex flex-col gap-2">
                  {logs.map((log) => (
                    <li key={log.work_date} className="rounded-xl bg-card p-4 shadow-card">
                      <p className="font-semibold">{formatDay(log.work_date)}</p>
                      <p className="text-sm text-muted-foreground">{log.summary}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {placement && (placement.status === "completed" || placement.status === "withdrawn") ? (
              <ExitFeedback />
            ) : null}
            <div className="flex flex-wrap gap-2">
              <SignOutButton />
              <SignOutButton everywhere />
            </div>
          </div>
        )}
      </LoadBlock>
      {logDate !== null ? (
        <WorkLogSheet key={logDate} open onClose={() => setLogDate(null)} workDate={logDate} onSaved={reload} />
      ) : null}
    </>
  );
}

/** Your photo (latest clock-in selfie), name (you can change it), email, supervisor and password. */
function ProfileCard({ profile, photo, supervisor }: { profile: Profile; photo: string | null; supervisor: string | null }) {
  const [name, setName] = useState(profile.display_name);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value: string) {
    setSaving(true);
    setError(null);
    const { data, error: fail } = await createClient().rpc("update_my_name", { display_name: value });
    setSaving(false);
    if (fail) {
      setError(errorText(fail, "Your name didn't save. Try again."));
      return;
    }
    clearSessionCache(); // the header and Home pick the new name up on the next screen
    setName(data ?? value.trim());
    setDraft(null);
    toast.success("Name saved.");
  }

  return (
    <section aria-labelledby="profile-title" className="flex flex-col gap-4 rounded-xl bg-card p-5 shadow-card sm:p-6">
      <div className="flex items-center gap-4">
        <Avatar url={photo} name={name} size={72} />
        <div className="flex min-w-0 flex-col">
          <h2 id="profile-title" className="truncate">
            {name}
          </h2>
          <p className="truncate text-sm text-muted-foreground">{profile.contact_email ?? "No email on file"}</p>
          <p className="text-xs text-muted-foreground">Your photo is your latest clock-in selfie.</p>
        </div>
      </div>
      {draft !== null ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save(draft);
          }}
        >
          <FormField id="my-name" label="Your name" error={error ?? undefined}>
            {(field) => <Input {...field} value={draft} autoComplete="name" onChange={(e) => setDraft(e.target.value)} />}
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save name"}
            </Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Supervisor</dt>
          <dd className="font-semibold">{supervisor ?? "Not assigned yet"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Email</dt>
          <dd>Only the DGK admin can change it, because it&apos;s how you sign in.</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        {draft === null ? (
          <Button type="button" variant="secondary" onClick={() => setDraft(name)}>
            Edit name
          </Button>
        ) : null}
        <Link href="/set-password" className={buttonVariants({ variant: "secondary" })}>
          Change password
        </Link>
      </div>
    </section>
  );
}

function ExitFeedback() {
  const [overall, setOverall] = useState(5);
  const [support, setSupport] = useState(5);
  const [learned, setLearned] = useState("");
  const [change, setChange] = useState("");
  const [recommend, setRecommend] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    const { error: fail } = await createClient().rpc("submit_exit_feedback", {
      answers: { overall, support, learned: learned.trim(), change: change.trim(), recommend },
    });
    setBusy(false);
    if (fail) {
      setError(errorText(fail, "That feedback didn't send. Try again."));
      return;
    }
    toast.success("Thanks for the feedback.");
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-card p-6 shadow-card">
      <h2>Exit feedback</h2>
      <FormField id="overall" label="Overall experience">
        {(input) => (
          <Input {...input} type="number" min={1} max={5} value={overall} onChange={(event) => setOverall(Number(event.target.value))} />
        )}
      </FormField>
      <FormField id="learned" label="What you learned most">
        {(input) => (
          <textarea
            {...input}
            value={learned}
            onChange={(event) => setLearned(event.target.value)}
            rows={3}
            className="min-h-20 rounded-md border border-input bg-card px-3 py-2"
          />
        )}
      </FormField>
      <FormField id="support" label="Supervisor support">
        {(input) => (
          <Input {...input} type="number" min={1} max={5} value={support} onChange={(event) => setSupport(Number(event.target.value))} />
        )}
      </FormField>
      <FormField id="change" label="One thing we should change">
        {(input) => (
          <textarea
            {...input}
            value={change}
            onChange={(event) => setChange(event.target.value)}
            rows={2}
            className="min-h-16 rounded-md border border-input bg-card px-3 py-2"
          />
        )}
      </FormField>
      <FormField id="recommend" label="Would you recommend DGK?">
        {(input) => (
          <select
            {...input}
            value={recommend ? "yes" : "no"}
            onChange={(event) => setRecommend(event.target.value === "yes")}
            className="h-11 rounded-md border border-input bg-card px-3"
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        )}
      </FormField>
      {error ? <FormMessage>{error}</FormMessage> : null}
      <Button type="button" disabled={busy} onClick={() => void submit()}>
        {busy ? "Sending…" : "Send feedback"}
      </Button>
    </section>
  );
}

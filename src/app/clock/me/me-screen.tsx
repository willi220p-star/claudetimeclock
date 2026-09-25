"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { InternFrame } from "@/app/clock/intern-frame";
import { DeskGate } from "@/components/desk-gate";
import { EmptyState } from "@/components/empty-state";
import { FormField, FormMessage } from "@/components/form-field";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { PdfDownloads } from "@/components/pdf-downloads";
import { SignOutButton } from "@/components/sign-out-button";
import { WorkLogSheet } from "@/components/work-log-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadMyPlacement, loadWorkLogs } from "@/lib/data";
import { formatDay } from "@/lib/darwin";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

export function MeScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <InternFrame profile={profile} title="Me">
          <MeDesk />
        </InternFrame>
      )}
    </DeskGate>
  );
}

function MeDesk() {
  const [logDate, setLogDate] = useState<string | null>(null);
  const load = useCallback(async () => {
    const placement = await loadMyPlacement();
    if (!placement) return { placement: null, logs: [], approver: null as string | null };
    const logs = await loadWorkLogs(placement.id);
    let approver: string | null = null;
    if (placement.report_approved_by) {
      const { data } = await createClient()
        .from("daymark_profiles")
        .select("display_name")
        .eq("id", placement.report_approved_by)
        .maybeSingle();
      approver = data?.display_name ?? null;
    }
    return { placement, logs, approver };
  }, []);
  const [state, reload] = useLoad(load);

  return (
    <>
      <PageHeader title="Me" description="Work logs, your uni report, and sign out." />
      <LoadBlock state={state} reload={reload} empty="No placement on this login.">
        {({ placement, logs, approver }) => (
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-2 rounded-xl bg-card p-6 shadow-card">
              <h2>Uni report</h2>
              {placement?.report_approved_at ? (
                <p>
                  Your uni report is <span className="font-semibold">approved</span>
                  {approver ? ` by ${approver}` : ""} on {formatDay(placement.report_approved_at)}.
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Your supervisor approves the uni report when your hours are final. The download will show here.
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
            <SignOutButton />
          </div>
        )}
      </LoadBlock>
      <WorkLogSheet open={logDate !== null} onClose={() => setLogDate(null)} workDate={logDate ?? ""} onSaved={reload} />
    </>
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

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AdminFrame } from "@/app/admin/admin-frame";
import { ConfirmDialog } from "@/app/admin/confirm-dialog";
import { FormField, FormMessage } from "@/components/form-field";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadNotificationSettings } from "@/lib/data";
import { formatDayTime } from "@/lib/darwin";
import { errorText } from "@/lib/daymark";
import { dailyCap, EMAIL_KIND_LABELS, emailErrorText, parseRecipients, type EmailSettings } from "@/lib/email";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

type Loaded = Awaited<ReturnType<typeof loadNotificationSettings>>;
type Intern = Loaded["interns"][number];
type Failure = Loaded["failures"][number];

const card = "flex flex-col gap-4 rounded-xl bg-card p-4 shadow-card sm:p-6";

/** Same list as private.push_kind_options(). */
const KIND_GROUPS = [
  {
    title: "Reminders to interns",
    note: "Unticked reminders aren't sent at all.",
    kinds: [
      ["reminder_shift", "Shift starts in 30 minutes", "30 minutes before a rostered start, if they haven't clocked in."],
      ["reminder_break", "Break is up", "When their break has run its set length (below)."],
      ["reminder_clock_out", "Time to clock out", "At the rostered finish, if they're still clocked in."],
      ["reminder_tomorrow", "Shift tomorrow morning", "8:00 pm the day before, for a shift that starts before noon."],
      ["task", "Tasks", "New tasks and an 8 am reminder of tasks due today."],
    ],
  },
  {
    title: "Updates to interns",
    note: "Unticked updates still show in the app's notifications, just not on phones.",
    kinds: [
      ["announcement", "Announcements", "A new announcement from you or their supervisor, and reminders to read it."],
      ["schedule", "Roster changes", "A day added, removed or marked absent; usual days changed."],
      ["times", "Clock time changes", "A supervisor changed their times or added a break."],
      ["request", "Request decisions", "Their leave or time request was approved or declined."],
    ],
  },
  {
    title: "To supervisors",
    note: "Unticked updates still show in the app's notifications, just not on phones.",
    kinds: [
      ["digest", "Morning summary", "8:00 am: who hasn't clocked in yet and what waits for approval. Admins see everyone."],
      ["attendance", "Times to confirm", "An intern typed in a time or clocked offline."],
      ["work_based", "Work-based days", "A work-based day is waiting for approval."],
      ["escalated", "Escalations", "A request has waited too long."],
      ["signoff", "Weeks to sign", "Monday and Tuesday morning: weeks waiting for your sign-off (due Tuesday 5 pm)."],
    ],
  },
] as const;

export function NotificationSettingsScreen() {
  return (
    <AdminFrame title="Notifications">
      <NotificationDesk />
    </AdminFrame>
  );
}

function NotificationDesk() {
  const [state, reload] = useLoad(loadNotificationSettings);
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Choose what goes to phones and email, and how long each intern's break is. Changes are audited."
      />
      <LoadBlock state={state} reload={reload}>
        {(data) => (
          <>
            <KindsForm key={data.kinds.join()} saved={data.kinds} onSaved={reload} />
            <EmailForm key={JSON.stringify(data.email)} saved={data.email} onSaved={reload} />
            <FailuresSection failures={data.failures} onRetried={reload} />
            <BreaksSection interns={data.interns} onSaved={reload} />
          </>
        )}
      </LoadBlock>
    </>
  );
}

function KindsForm({ saved, onSaved }: { saved: string[]; onSaved: () => void }) {
  const [ticked, setTicked] = useState(() => new Set(saved));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = ticked.size !== saved.length || saved.some((kind) => !ticked.has(kind));

  function toggle(kind: string, on: boolean) {
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(kind);
      else next.delete(kind);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("save_push_kinds", { kinds: [...ticked] });
    setBusy(false);
    if (error) {
      setError(errorText(error, "Notifications didn't save. Try again."));
      return;
    }
    toast.success("Notifications saved.");
    onSaved();
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {KIND_GROUPS.map((group) => (
        <fieldset key={group.title} className="flex flex-col gap-2">
          <legend className="caption mb-2 font-semibold text-muted-foreground">{group.title}</legend>
          <div className={card}>
            <p className="text-sm text-muted-foreground">{group.note}</p>
            {group.kinds.map(([kind, label, hint]) => (
              <label key={kind} className="flex min-h-11 items-start gap-3">
                <input
                  type="checkbox"
                  checked={ticked.has(kind)}
                  onChange={(event) => toggle(kind, event.target.checked)}
                  className="mt-0.5 size-5 shrink-0 accent-primary"
                />
                <span className="flex flex-col">
                  <span className="font-medium">{label}</span>
                  <span className="text-sm text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {error ? <FormMessage>{error}</FormMessage> : null}
      <Button type="submit" disabled={busy || !changed} className="self-start">
        {busy ? "Saving…" : "Save notifications"}
      </Button>
    </form>
  );
}

/** Email copies of notifications (D50), sent through Apps Script and Gmail. */
function EmailForm({ saved, onSaved }: { saved: EmailSettings; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(saved.enabled);
  const [ticked, setTicked] = useState(() => new Set(saved.kinds));
  const [recipients, setRecipients] = useState(saved.testRecipients.join("\n"));
  const [cap, setCap] = useState(String(saved.dailyCap));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedRecipients = saved.testRecipients.join("\n");
  const changed =
    enabled !== saved.enabled ||
    ticked.size !== saved.kinds.length ||
    saved.kinds.some((kind) => !ticked.has(kind)) ||
    recipients.trim() !== savedRecipients ||
    cap.trim() !== String(saved.dailyCap);

  function toggle(kind: string, on: boolean) {
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(kind);
      else next.delete(kind);
      return next;
    });
  }

  async function save() {
    const parsed = parseRecipients(recipients);
    const limit = dailyCap(cap);
    if (parsed.error) return setError(parsed.error);
    if (limit === null) return setError("Set the daily limit between 1 and 95.");
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("save_email_settings", {
      enabled,
      kinds: saved.options.filter((kind) => ticked.has(kind)),
      test_recipients: parsed.emails,
      daily_cap: limit,
    });
    setBusy(false);
    if (error) {
      setError(errorText(error, "Email settings didn't save. Try again."));
      return;
    }
    toast.success("Email settings saved.");
    onSaved();
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2 id="email-title" className="caption font-semibold text-muted-foreground">
        Email
      </h2>
      <div className={card}>
        <p className="text-sm text-muted-foreground">
          {saved.sentToday} of {saved.dailyCap} sent today · {saved.queued} waiting · {saved.failed7d} failed ·{" "}
          {saved.uncertain7d} uncertain (last 7 days)
        </p>
        <label className="flex min-h-11 items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            aria-describedby="email-enabled-hint"
            className="mt-0.5 size-5 shrink-0 accent-primary"
          />
          <span className="flex flex-col">
            <span className="font-medium">Send emails</span>
            <span id="email-enabled-hint" className="text-sm text-muted-foreground">
              Off until you&apos;ve tested it. Uses the Gmail account set up in Apps Script.
            </span>
          </span>
        </label>
        {saved.options.length > 0 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-medium">Emails to send</legend>
            {saved.options.map((kind) => (
              <label key={kind} className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={ticked.has(kind)}
                  onChange={(event) => toggle(kind, event.target.checked)}
                  className="size-5 shrink-0 accent-primary"
                />
                <span>{EMAIL_KIND_LABELS[kind] ?? kind}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <FormField
          id="email-test-recipients"
          label="Test recipients (one per line)"
          hint="While this list has addresses, only they get emails. Clear it to email everyone."
        >
          {(input) => (
            <textarea
              {...input}
              value={recipients}
              onChange={(event) => setRecipients(event.target.value)}
              rows={3}
              autoCapitalize="none"
              spellCheck={false}
              className="min-h-20 rounded-md border border-input bg-card px-3 py-2"
            />
          )}
        </FormField>
        <FormField
          id="email-daily-cap"
          label="Emails a day at most"
          hint="Gmail allows about 100 a day; extra emails wait until tomorrow."
        >
          {(input) => (
            <Input {...input} inputMode="numeric" className="w-24" value={cap} onChange={(e) => setCap(e.target.value)} />
          )}
        </FormField>
      </div>
      {error ? <FormMessage>{error}</FormMessage> : null}
      <Button type="submit" disabled={busy || !changed} className="self-start">
        {busy ? "Saving…" : "Save email settings"}
      </Button>
    </form>
  );
}

function FailuresSection({ failures, onRetried }: { failures: Failure[]; onRetried: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Failure | null>(null);

  async function retry(id: string) {
    const { error } = await createClient().rpc("retry_email", { id });
    if (error) return errorText(error, "The email didn't go back in the queue. Try again.");
    toast.success("Email queued to send again.");
    onRetried();
    return null;
  }

  return (
    <section aria-labelledby="email-failures" className="flex flex-col gap-2">
      <h2 id="email-failures" className="caption font-semibold text-muted-foreground">
        Failed and uncertain emails
      </h2>
      <div className={card}>
        {failures.length === 0 ? (
          <p className="text-muted-foreground">None in the last 30 days.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {failures.map((row) => (
              <li key={row.id} className="flex items-center gap-3 py-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">
                    {row.person_name || "Someone"} · {EMAIL_KIND_LABELS[row.kind] ?? row.kind}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {formatDayTime(row.created_at)} · {row.status === "uncertain" ? "Uncertain" : "Failed"}:{" "}
                    {emailErrorText(row.error_code)}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={async () => {
                    if (row.status === "uncertain") return setConfirming(row);
                    setBusy(row.id);
                    const message = await retry(row.id);
                    setBusy(null);
                    if (message) toast.error(message);
                  }}
                >
                  {busy === row.id ? "Retrying…" : "Retry"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={confirming !== null}
        title="Send this email again?"
        description="It may already have been sent. Send again?"
        confirmLabel="Send again"
        onCancel={() => setConfirming(null)}
        onConfirm={async () => {
          const message = confirming ? await retry(confirming.id) : null;
          if (!message) setConfirming(null);
          return message;
        }}
      />
    </section>
  );
}

/** Minutes typed by an admin: a whole number from 0 to 120, or null. */
export function breakMinutes(text: string) {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(value) && value >= 0 && value <= 120 ? value : null;
}

function BreaksSection({ interns, onSaved }: { interns: Intern[]; onSaved: () => void }) {
  const [all, setAll] = useState("30");
  const [allError, setAllError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <section aria-labelledby="breaks" className="flex flex-col gap-2">
      <h2 id="breaks" className="caption font-semibold text-muted-foreground">
        Break length
      </h2>
      <div className={card}>
        <p className="text-sm text-muted-foreground">
          The break-is-up reminder goes at this length. Changing it re-plans each intern&apos;s hours from today.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="break-all">Same break for everyone (minutes)</Label>
            <Input id="break-all" inputMode="numeric" className="w-32" value={all} onChange={(e) => setAll(e.target.value)} />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={interns.length === 0}
            onClick={() => {
              const minutes = breakMinutes(all);
              setAllError(minutes === null ? "Set the break between 0 and 120 minutes." : null);
              if (minutes !== null) setConfirming(true);
            }}
          >
            Apply to all active interns
          </Button>
        </div>
        {allError ? <FormMessage>{allError}</FormMessage> : null}
        {interns.length === 0 ? (
          <p className="text-muted-foreground">No active interns.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {interns.map((intern) => (
              <BreakRow key={`${intern.id}:${intern.breakMinutes}`} intern={intern} onSaved={onSaved} />
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Same break for everyone?"
        description={`Every active intern (${interns.length}) gets a ${breakMinutes(all) ?? 0}-minute break, from today.`}
        confirmLabel="Apply to all"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          const { data, error } = await createClient().rpc("set_break_for_all", { minutes: breakMinutes(all) ?? 0 });
          if (error) return errorText(error, "Breaks didn't save. Try again.");
          setConfirming(false);
          toast.success(data === 1 ? "1 intern's break changed." : `${data ?? 0} interns' breaks changed.`);
          onSaved();
          return null;
        }}
      />
    </section>
  );
}

function BreakRow({ intern, onSaved }: { intern: Intern; onSaved: () => void }) {
  const [text, setText] = useState(String(intern.breakMinutes ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `break-${intern.id}`;

  async function save() {
    const minutes = breakMinutes(text);
    if (minutes === null) {
      setError("Set the break between 0 and 120 minutes.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("set_break_minutes", { placement: intern.id, minutes });
    setBusy(false);
    if (error) {
      setError(errorText(error, "The break didn't save. Try again."));
      return;
    }
    toast.success(`${intern.name}'s break is ${minutes} minutes.`);
    onSaved();
  }

  return (
    <li className="flex flex-col gap-1 py-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Label htmlFor={id} className="min-w-0 flex-1 truncate">
          {intern.name}
        </Label>
        <Input id={id} inputMode="numeric" className="w-20" value={text} onChange={(e) => setText(e.target.value)} />
        <span className="text-sm text-muted-foreground">min</span>
        <Button type="submit" variant="outline" disabled={busy || text === String(intern.breakMinutes ?? "")}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </form>
      {error ? <FormMessage>{error}</FormMessage> : null}
    </li>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AdminFrame } from "@/app/admin/admin-frame";
import { ConfirmDialog } from "@/app/admin/confirm-dialog";
import { FormMessage } from "@/components/form-field";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadNotificationSettings } from "@/lib/data";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

type Loaded = Awaited<ReturnType<typeof loadNotificationSettings>>;
type Intern = Loaded["interns"][number];

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
    ],
  },
  {
    title: "Updates to interns",
    note: "Unticked updates still show in the app's notifications, just not on phones.",
    kinds: [
      ["schedule", "Roster changes", "A day added, removed or marked absent; usual days changed."],
      ["times", "Clock time changes", "A supervisor changed their times or added a break."],
      ["request", "Request decisions", "Their leave or time request was approved or declined."],
    ],
  },
  {
    title: "To supervisors",
    note: "Unticked updates still show in the app's notifications, just not on phones.",
    kinds: [
      ["attendance", "Times to confirm", "An intern typed in a time or clocked offline."],
      ["work_based", "Work-based days", "A work-based day is waiting for approval."],
      ["escalated", "Escalations", "A request has waited too long."],
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
        description="Choose what goes to phones, and how long each intern's break is. Changes are audited."
      />
      <LoadBlock state={state} reload={reload}>
        {(data) => (
          <>
            <KindsForm key={data.kinds.join()} saved={data.kinds} onSaved={reload} />
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

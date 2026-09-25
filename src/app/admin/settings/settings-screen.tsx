"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AdminFrame } from "@/app/admin/admin-frame";
import { ConfirmDialog } from "@/app/admin/confirm-dialog";
import { FormField, FormMessage } from "@/components/form-field";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JOBS, jsonLines, SETTING_FIELDS, SETTING_GROUPS, settingsDiff, type SettingValues } from "@/lib/admin-config";
import { loadSettings } from "@/lib/data";
import { errorText } from "@/lib/daymark";
import { formatDayTime } from "@/lib/darwin";
import { formatMinutes } from "@/lib/minutes";
import { fieldErrors, noticeSchema, settingsSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

type Loaded = Awaited<ReturnType<typeof loadSettings>>;
type Settings = Loaded["settings"];

const selectClass = "h-12 w-full rounded-md border border-input bg-card px-3";
const card = "flex flex-col gap-4 rounded-xl bg-card p-4 shadow-card sm:p-6";

function valuesOf(settings: Settings): SettingValues {
  return {
    ...(Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, settings[f.key]])) as Omit<SettingValues, "fortnight_anchor">),
    fortnight_anchor: settings.fortnight_anchor,
  };
}

function textOf(values: SettingValues): Record<keyof SettingValues, string> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])) as Record<keyof SettingValues, string>;
}

export function SettingsScreen() {
  return (
    <AdminFrame title="Settings">
      <SettingsDesk />
    </AdminFrame>
  );
}

function SettingsDesk() {
  const [state, reload] = useLoad(loadSettings);
  return (
    <>
      <PageHeader title="Settings" description="Office-wide rules. Changes apply from now on and are audited." />
      <LoadBlock state={state} reload={reload}>
        {(data) => (
          <>
            <SettingsForm key={data.settings.updated_at} settings={data.settings} onSaved={reload} />
            <NoticeSection data={data} onPublished={reload} />
            <JobsSection />
          </>
        )}
      </LoadBlock>
    </>
  );
}

function SettingsForm({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const original = valuesOf(settings);
  const [draft, setDraft] = useState(() => textOf(original));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof SettingValues) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  async function save() {
    setFormError(null);
    const parsed = settingsSchema.safeParse(draft);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    const changes = settingsDiff(original, parsed.data);
    if (Object.keys(changes).length === 0) {
      setFormError("Nothing has changed.");
      return;
    }
    setBusy(true);
    const { error } = await createClient().rpc("update_settings", { changes });
    setBusy(false);
    if (error) {
      setFormError(errorText(error, "Settings didn't save. Try again."));
      return;
    }
    toast.success(`${Object.keys(changes).length === 1 ? "Setting" : "Settings"} saved.`);
    onSaved();
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {SETTING_GROUPS.map((group) => (
        <section key={group.title} aria-labelledby={`settings-${group.title}`} className="flex flex-col gap-2">
          <h2 id={`settings-${group.title}`} className="caption font-semibold text-muted-foreground">
            {group.title}
          </h2>
          <div className={`${card} sm:grid sm:grid-cols-2`}>
            {group.fields.map((f) => (
              <FormField
                key={f.key}
                id={`setting-${f.key}`}
                label={`${f.label} (${f.unit})`}
                hint={`${f.min} to ${f.max}.`}
                error={errors[f.key]}
              >
                {(field) => <Input {...field} inputMode="numeric" value={draft[f.key]} onChange={set(f.key)} />}
              </FormField>
            ))}
          </div>
        </section>
      ))}
      <section aria-labelledby="settings-fortnights" className="flex flex-col gap-2">
        <h2 id="settings-fortnights" className="caption font-semibold text-muted-foreground">
          Fortnights and breaks
        </h2>
        <div className={card}>
          <FormField
            id="setting-fortnight_anchor"
            label="Fortnight anchor"
            hint="A Monday. Every fortnight starts on it or a multiple of 14 days away."
            error={errors.fortnight_anchor}
          >
            {(field) => <Input {...field} type="date" value={draft.fortnight_anchor} onChange={set("fortnight_anchor")} />}
          </FormField>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold">Break rule</p>
            <p className="text-sm text-muted-foreground">
              {formatMinutes(settings.break_minutes)} off days over {formatMinutes(settings.break_threshold_minutes)}. Fixed by the
              schedule rules, so it can&apos;t be changed here.
            </p>
          </div>
        </div>
      </section>
      {formError ? <FormMessage>{formError}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setDraft(textOf(original));
            setErrors({});
            setFormError(null);
          }}
        >
          Undo changes
        </Button>
      </div>
    </form>
  );
}

function NoticeSection({ data, onPublished }: { data: Loaded; onPublished: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="settings-notice" className="flex flex-col gap-2">
      <h2 id="settings-notice" className="caption font-semibold text-muted-foreground">
        Collection notice
      </h2>
      <div className={`${card} sm:flex-row sm:items-center sm:justify-between`}>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-semibold">
            Version {data.settings.notice_version}
            {data.notice ? ` · ${data.notice.title}` : ""}
          </p>
          <p className="text-sm text-muted-foreground">
            {data.notice ? `Published ${formatDayTime(data.notice.published_at)}` : "The current version wasn't found."}
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          Publish new version
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>{open ? <PublishNotice onDone={() => { setOpen(false); onPublished(); }} /> : null}</DialogContent>
      </Dialog>
    </section>
  );
}

function PublishNotice({ onDone }: { onDone: () => void }) {
  const [draft, setDraft] = useState({ version: "", title: "", body: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof draft) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  async function publish() {
    setFormError(null);
    const parsed = noticeSchema.safeParse(draft);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    const { data, error } = await createClient().rpc("publish_notice", parsed.data);
    setBusy(false);
    if (error) {
      setFormError(errorText(error, "The notice wasn't published. Try again."));
      return;
    }
    const notified = Number((data as { notified?: number } | null)?.notified ?? 0);
    toast.success(`Version ${parsed.data.version} published. ${notified} intern${notified === 1 ? "" : "s"} told.`);
    onDone();
  }

  return (
    <>
      <DialogTitle>Publish a new collection notice</DialogTitle>
      <DialogDescription>
        It becomes current straight away. Every intern must read and accept it again before their next clock-in.
      </DialogDescription>
      <form
        noValidate
        className="mt-4 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void publish();
        }}
      >
        <FormField id="notice-version" label="Version" hint="For example 1.1. It can't be reused." error={errors.version}>
          {(field) => <Input {...field} autoComplete="off" value={draft.version} onChange={set("version")} />}
        </FormField>
        <FormField id="notice-title" label="Title" error={errors.title}>
          {(field) => <Input {...field} autoComplete="off" value={draft.title} onChange={set("title")} />}
        </FormField>
        <FormField id="notice-body" label="Notice" hint={`${draft.body.trim().length} characters. At least 50.`} error={errors.body}>
          {(field) => (
            <textarea
              {...field}
              rows={8}
              value={draft.body}
              onChange={set("body")}
              className="min-h-40 rounded-md border border-input bg-card px-3 py-2"
            />
          )}
        </FormField>
        <FormMessage tone="bad">Publishing asks every intern to consent again. You can&apos;t undo it.</FormMessage>
        {formError ? <FormMessage>{formError}</FormMessage> : null}
        <Button type="submit" disabled={busy}>
          {busy ? "Publishing…" : "Publish and ask everyone again"}
        </Button>
      </form>
    </>
  );
}

function JobsSection() {
  const [job, setJob] = useState<string>(JOBS[0].name);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ job: string; lines: { key: string; value: string }[] } | null>(null);
  const label = JOBS.find((j) => j.name === job)?.label ?? job;

  return (
    <section aria-labelledby="settings-jobs" className="flex flex-col gap-2">
      <h2 id="settings-jobs" className="caption font-semibold text-muted-foreground">
        Run a job
      </h2>
      <div className={card}>
        <p className="text-sm text-muted-foreground">
          Jobs run on their own schedule. Run one by hand only to catch up after an outage. Each run is audited.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="job-name">Job</Label>
            <select id="job-name" className={selectClass} value={job} onChange={(event) => setJob(event.target.value)}>
              {JOBS.map((j) => (
                <option key={j.name} value={j.name}>
                  {j.label}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" onClick={() => setConfirming(true)}>
            Run
          </Button>
        </div>
        {result ? (
          <div role="status" className="flex flex-col gap-2 rounded-md bg-muted p-3">
            <p className="text-sm font-semibold">{JOBS.find((j) => j.name === result.job)?.label ?? result.job}: done</p>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
              {result.lines.map((line) => (
                <div key={line.key} className="contents">
                  <dt className="break-all text-muted-foreground">{line.key}</dt>
                  <dd className="text-right break-all tabular-nums">{line.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirming}
        title={`Run “${label}” now?`}
        description="It runs straight away against live data, as it would on its schedule."
        confirmLabel="Run job"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          const { data, error } = await createClient().rpc("run_job", { name: job });
          if (error) return errorText(error, "The job didn't run. Try again.");
          setResult({ job, lines: jsonLines(data) });
          setConfirming(false);
          toast.success("Job finished.");
          return null;
        }}
      />
    </section>
  );
}

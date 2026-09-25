"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EffectPreview } from "@/components/effect-preview";
import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { previewRequest } from "@/lib/data";
import { errorText } from "@/lib/daymark";
import {
  buildRequestPayload,
  previewToEffects,
  REQUEST_LABEL,
  REQUEST_TYPES,
  type RequestPreview,
  type RequestType,
} from "@/lib/placement-ui";
import { createClient } from "@/lib/supabase/client";

const INTERN_TYPES: RequestType[] = ["swap", "shift_change", "extra_day", "leave", "punch_fix", "pattern_change"];

export type RequestDefaults = {
  scheduled_day_id?: string;
  start?: string;
  end?: string;
  date?: string;
  dates?: string[];
  kind?: string;
  clock_in?: string;
  clock_out?: string;
  effective_from?: string;
  pattern?: string;
  new_date?: string;
};

function hhmm(value?: string) {
  return value ? value.slice(0, 5) : "";
}

function fieldsFrom(defaults: RequestDefaults): Record<string, string> {
  return {
    scheduled_day_id: defaults.scheduled_day_id ?? "",
    new_date: defaults.new_date ?? "",
    start: hhmm(defaults.start) || "09:00",
    end: hhmm(defaults.end) || "17:00",
    date: defaults.date ?? "",
    dates: defaults.dates?.join(", ") || defaults.date || "",
    kind: defaults.kind ?? "personal",
    clock_in: hhmm(defaults.clock_in),
    clock_out: hhmm(defaults.clock_out),
    effective_from: defaults.effective_from ?? "",
    pattern: defaults.pattern ?? '[{"weekday":1,"start":"09:00","end":"17:00"}]',
  };
}

export function RequestForm({
  type: lockedType,
  defaults = {},
  initialType,
  initialFields,
  onSubmitted,
}: {
  type?: RequestType;
  defaults?: RequestDefaults;
  initialType?: RequestType;
  initialFields?: Record<string, string>;
  onSubmitted?: () => void;
}) {
  const router = useRouter();
  const [type, setType] = useState<RequestType>(lockedType ?? initialType ?? "extra_day");
  const [fields, setFields] = useState<Record<string, string>>({ ...fieldsFrom(defaults), ...initialFields });
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<RequestPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payload = useMemo(() => buildRequestPayload(type, fields), [type, fields]);

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void previewRequest({ type, payload, reason: reason || undefined }).then(
        (data) => {
          if (live) setPreview(data);
        },
        () => {
          if (live) setPreview(null);
        },
      );
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [type, payload, reason]);

  function setField(name: string, value: string) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  async function submit() {
    setError(null);
    setBusy(true);
    const { error: fail } = await createClient().rpc("create_request", {
      type,
      payload: payload as import("@/lib/database.types").Json,
      reason: reason.trim() || undefined,
    });
    setBusy(false);
    if (fail) {
      setError(errorText(fail, "That request didn't send. Try again."));
      return;
    }
    toast.success(`${REQUEST_LABEL[type]} sent.`);
    onSubmitted?.();
    router.push("/clock/requests");
  }

  const submitLabel = busy ? "Sending…" : "Submit";

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {lockedType ? null : (
        <FormField id="req-type" label="Type">
          {(input) => (
            <select
              {...input}
              value={type}
              onChange={(event) => setType(event.target.value as RequestType)}
              className="h-11 rounded-md border border-input bg-card px-3"
            >
              {INTERN_TYPES.filter((option) => REQUEST_TYPES.includes(option)).map((option) => (
                <option key={option} value={option}>
                  {REQUEST_LABEL[option]}
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}

      {type === "swap" ? (
        <>
          {fields.scheduled_day_id ? null : (
            <TextField id="swap-day" label="Scheduled day" value={fields.scheduled_day_id} onChange={(v) => setField("scheduled_day_id", v)} />
          )}
          <DateField id="swap-date" label="Move to" value={fields.new_date} onChange={(v) => setField("new_date", v)} />
          <TimePair start={fields.start} end={fields.end} onStart={(v) => setField("start", v)} onEnd={(v) => setField("end", v)} />
        </>
      ) : null}
      {type === "shift_change" ? (
        <TimePair start={fields.start} end={fields.end} onStart={(v) => setField("start", v)} onEnd={(v) => setField("end", v)} />
      ) : null}
      {type === "extra_day" ? (
        <>
          <DateField id="extra-date" label="Date" value={fields.date} onChange={(v) => setField("date", v)} />
          <TimePair start={fields.start} end={fields.end} onStart={(v) => setField("start", v)} onEnd={(v) => setField("end", v)} />
        </>
      ) : null}
      {type === "leave" ? (
        <>
          <FormField id="leave-dates" label="Dates" hint="One date, or several separated by commas.">
            {(input) => <Input {...input} value={fields.dates} onChange={(event) => setField("dates", event.target.value)} />}
          </FormField>
          <FormField id="leave-kind" label="Kind">
            {(input) => (
              <select
                {...input}
                value={fields.kind}
                onChange={(event) => setField("kind", event.target.value)}
                className="h-11 rounded-md border border-input bg-card px-3"
              >
                <option value="personal">Personal</option>
                <option value="sick">Sick</option>
              </select>
            )}
          </FormField>
        </>
      ) : null}
      {type === "punch_fix" ? (
        <>
          <DateField id="fix-date" label="Date" value={fields.date} onChange={(v) => setField("date", v)} />
          <TimePair
            startLabel="Clock in"
            endLabel="Clock out"
            start={fields.clock_in}
            end={fields.clock_out}
            onStart={(v) => setField("clock_in", v)}
            onEnd={(v) => setField("clock_out", v)}
          />
        </>
      ) : null}
      {type === "pattern_change" ? (
        <>
          <DateField id="pattern-from" label="From" value={fields.effective_from} onChange={(v) => setField("effective_from", v)} />
          <FormField id="pattern-json" label="Weekly pattern">
            {(input) => (
              <textarea
                {...input}
                value={fields.pattern}
                onChange={(event) => setField("pattern", event.target.value)}
                rows={3}
                className="min-h-20 rounded-md border border-input bg-card px-3 py-2 font-mono text-sm"
              />
            )}
          </FormField>
        </>
      ) : null}

      <FormField id="req-reason" label="Reason" hint={type === "punch_fix" ? "At least 20 characters." : "Say what you need and why."}>
        {(input) => (
          <textarea
            {...input}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            className="min-h-20 rounded-md border border-input bg-card px-3 py-2"
          />
        )}
      </FormField>

      <section aria-label="Preview" className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Preview</h3>
        {preview?.ok ? <EffectPreview effects={previewToEffects(preview)} /> : null}
        {preview && !preview.ok ? <FormMessage>{preview.message}</FormMessage> : null}
        {!preview ? <p className="text-sm text-muted-foreground">The preview updates as you fill this in.</p> : null}
      </section>

      {error ? <FormMessage>{error}</FormMessage> : null}
      <Button type="submit" disabled={busy || !preview?.ok || (type === "punch_fix" && reason.trim().length < 20)}>
        {busy ? "Sending…" : preview && !preview.ok ? preview.message : submitLabel}
      </Button>
    </form>
  );
}

function DateField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField id={id} label={label}>
      {(input) => <Input {...input} type="date" value={value} onChange={(event) => onChange(event.target.value)} />}
    </FormField>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField id={id} label={label}>
      {(input) => <Input {...input} value={value} onChange={(event) => onChange(event.target.value)} />}
    </FormField>
  );
}

function TimePair({
  start,
  end,
  onStart,
  onEnd,
  startLabel = "Start",
  endLabel = "End",
}: {
  start: string;
  end: string;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
  startLabel?: string;
  endLabel?: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField id={`${startLabel}-time`} label={startLabel}>
        {(input) => <Input {...input} type="time" value={start} onChange={(event) => onStart(event.target.value)} />}
      </FormField>
      <FormField id={`${endLabel}-time`} label={endLabel}>
        {(input) => <Input {...input} type="time" value={end} onChange={(event) => onEnd(event.target.value)} />}
      </FormField>
    </div>
  );
}

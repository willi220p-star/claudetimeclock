"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PRIORITY_LABEL, WEEKDAYS, type Priority } from "@/components/tasks/task-helpers";
import type { Database } from "@/lib/database.types";
import { darwinDateKey } from "@/lib/darwin";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

export type TaskDraft = {
  id: string | null;
  title: string;
  description: string | null;
  priority: string;
  due_date: string | null;
  due_time: string | null;
  link: string | null;
  repeat_days: number[] | null;
  repeat_until: string | null;
  assignees: string[];
};

type SaveArgs = Database["public"]["Functions"]["save_task"]["Args"];

async function loadPeople() {
  const { data, error } = await createClient().rpc("task_people");
  if (error) throw error;
  return data ?? [];
}

const field = "flex flex-col gap-1";
const box = "rounded-md border border-input bg-card px-3 py-2";

/**
 * Add or edit a task (D44). Staff pick who it's assigned to; an intern's task is their own, and they can
 * tag teammates they're working with.
 */
export function TaskForm({
  mode,
  initial,
  onSaved,
  onCancel,
}: {
  mode: "intern" | "staff";
  initial?: TaskDraft;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [people] = useLoad(loadPeople);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priority, setPriority] = useState(initial?.priority ?? "medium");
  const [dueDate, setDueDate] = useState(initial?.due_date ?? "");
  const [dueTime, setDueTime] = useState(initial?.due_time?.slice(0, 5) ?? "");
  const [link, setLink] = useState(initial?.link ?? "");
  const [repeat, setRepeat] = useState(Boolean(initial?.repeat_days?.length));
  const [days, setDays] = useState(() => new Set(initial?.repeat_days ?? []));
  const [until, setUntil] = useState(initial?.repeat_until ?? "");
  const [picked, setPicked] = useState(() => new Set(initial?.assignees ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(initial?.id);
  const pickLabel = mode === "staff" ? "Assign to" : "Working with";

  function toggle<T>(set: (update: (current: Set<T>) => Set<T>) => void, value: T, on: boolean) {
    set((current) => {
      const next = new Set(current);
      if (on) next.add(value);
      else next.delete(value);
      return next;
    });
  }

  async function save() {
    setError(null);
    const url = link.trim();
    if (!title.trim()) return setError("Give the task a name.");
    if (url && !url.startsWith("https://")) return setError("The link must start with https://");
    if (repeat && (days.size === 0 || !until)) return setError("Pick the weekdays it repeats on and an end date.");
    if (mode === "staff" && picked.size === 0) return setError("Pick at least one intern.");
    setBusy(true);
    // The generated Args mark every parameter non-null; the function takes nulls for the optional ones.
    const args = {
      id: initial?.id ?? null,
      title: title.trim(),
      description: description.trim() || null,
      priority,
      due_date: repeat ? null : dueDate || null,
      due_time: dueTime || null,
      link: url || null,
      assignees: mode === "staff" ? [...picked] : [],
      collaborators: mode === "intern" ? [...picked] : [],
      repeat_days: repeat ? [...days].sort((a, b) => a - b) : null,
      repeat_until: repeat ? until : null,
    } as unknown as SaveArgs;
    const { error: fail } = await createClient().rpc("save_task", args);
    setBusy(false);
    if (fail) return setError(errorText(fail, "The task didn't save. Try again."));
    toast.success(editing ? "Task saved." : mode === "staff" ? "Task added. Each intern gets a notification." : "Task added.");
    if (!editing) {
      setTitle("");
      setDescription("");
      setDueDate("");
      setDueTime("");
      setLink("");
      setRepeat(false);
      setDays(new Set());
      setUntil("");
      setPicked(new Set());
    }
    onSaved();
  }

  return (
    <form
      aria-label={editing ? `Edit ${initial?.title}` : "New task"}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className={field}>
        <Label htmlFor={`${id}-title`}>Task name</Label>
        <Input id={`${id}-title`} maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className={field}>
        <Label htmlFor={`${id}-description`}>Description</Label>
        <textarea
          id={`${id}-description`}
          maxLength={2000}
          rows={3}
          className={box}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={field}>
          <Label htmlFor={`${id}-priority`}>Priority</Label>
          <select
            id={`${id}-priority`}
            className="h-12 w-full rounded-md border border-input bg-card px-3"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            {(Object.keys(PRIORITY_LABEL) as Priority[]).map((key) => (
              <option key={key} value={key}>
                {PRIORITY_LABEL[key]}
              </option>
            ))}
          </select>
        </div>
        {repeat ? null : (
          <div className={field}>
            <Label htmlFor={`${id}-due-date`}>Due date</Label>
            <Input id={`${id}-due-date`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        )}
        <div className={field}>
          <Label htmlFor={`${id}-due-time`}>Due time</Label>
          <Input id={`${id}-due-time`} type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </div>
      </div>
      <div className={field}>
        <Label htmlFor={`${id}-link`}>Link</Label>
        <Input
          id={`${id}-link`}
          type="url"
          inputMode="url"
          placeholder="https://"
          maxLength={500}
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
      </div>
      <label className="flex min-h-11 items-center gap-3">
        {/* A saved task can't switch between one-off and repeating (the database refuses): archive and add a new one. */}
        <input
          type="checkbox"
          className="size-5 accent-primary"
          checked={repeat}
          disabled={Boolean(initial)}
          onChange={(e) => setRepeat(e.target.checked)}
        />
        Repeats weekly
      </label>
      {repeat ? (
        <div className="flex flex-col gap-3 rounded-lg bg-muted p-3">
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">Repeat on</legend>
            <div className="flex flex-wrap gap-x-4">
              {WEEKDAYS.map((name, index) => (
                <label key={name} className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={days.has(index + 1)}
                    onChange={(e) => toggle(setDays, index + 1, e.target.checked)}
                  />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className={field}>
            <Label htmlFor={`${id}-until`}>Repeat until</Label>
            <Input
              id={`${id}-until`}
              type="date"
              min={darwinDateKey(new Date())}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </div>
        </div>
      ) : null}
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">{pickLabel}</legend>
        {people.status === "loading" ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : people.status === "error" ? (
          <p className="text-sm text-bad">{people.message}</p>
        ) : people.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{mode === "staff" ? "No interns to assign." : "No teammates to add."}</p>
        ) : (
          <div className="flex max-h-56 flex-col overflow-y-auto">
            {people.data.map((person) => (
              <label key={person.person_id} className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={picked.has(person.person_id)}
                  onChange={(e) => toggle(setPicked, person.person_id, e.target.checked)}
                />
                {person.display_name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {error ? <FormMessage>{error}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : editing ? "Save task" : "Add task"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

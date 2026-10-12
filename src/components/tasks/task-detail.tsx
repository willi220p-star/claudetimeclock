"use client";

import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { ArrowUp, ListChecks, MessageSquare, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-field";
import { MoveMenu, PRIORITY_CHIP, STATUS_PILL } from "@/components/tasks/task-parts";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  dueText,
  formatMinutes,
  isOverdue,
  parseDuration,
  repeatSummary,
  taskActions,
  type Priority,
  type TaskItem,
  type TaskStatus,
  type Viewer,
} from "@/components/tasks/task-helpers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDayTime } from "@/lib/darwin";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";

type Subtask = { id: string; title: string; position: number; done_at: string | null; done_by_name: string | null };
type Comment = {
  id: string;
  subtask_id: string | null;
  author_name: string | null;
  body: string;
  kind: "comment" | "changes" | "approved";
  created_at: string;
  mine: boolean;
};
type Thread = { subtasks: Subtask[]; comments: Comment[] };

async function loadThread(item: string) {
  const { data, error } = await createClient().rpc("task_thread", { item });
  if (error) throw error;
  const thread = (data ?? {}) as Partial<Thread>;
  return { subtasks: thread.subtasks ?? [], comments: thread.comments ?? [] };
}

const group = "overflow-hidden rounded-xl bg-card";
const initials = (name: string | null) =>
  (name ?? "?")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const KIND_TEXT: Record<Comment["kind"], string> = { comment: "", changes: " asked for changes", approved: " approved it" };

/**
 * One copy's detail (D48): a bottom sheet on phones, a right-hand panel at 1024px and up with the list still usable
 * beside it (non-modal there).
 */
export function TaskDetail({
  row,
  viewer,
  wide,
  onClose,
  onChanged,
}: {
  row: TaskItem;
  viewer: Viewer;
  wide: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const id = useId();
  const load = useCallback(() => loadThread(row.item_id), [row.item_id]);
  const [thread, reloadThread] = useLoad(load);
  const subtasks = thread.status === "ready" ? thread.data.subtasks : [];
  const comments = thread.status === "ready" ? thread.data.comments : [];
  // The list's counts lag a tick behind; the thread is the truth once it's loaded.
  const counts =
    thread.status === "ready"
      ? { subtasks_total: subtasks.length, subtasks_done: subtasks.filter((item) => item.done_at).length }
      : { subtasks_total: row.subtasks_total, subtasks_done: row.subtasks_done };
  const actions = taskActions({ ...row, ...counts }, viewer);

  const [busy, setBusy] = useState(false);
  // Ticks show at once; a failed save puts the box back.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [showSubtasks, setShowSubtasks] = useState(false);
  const [newSubtask, setNewSubtask] = useState("");
  const [comment, setComment] = useState("");
  const [target, setTarget] = useState<Subtask | null>(null);
  const [panel, setPanel] = useState<"log" | "block" | "done" | null>(null);
  const [note, setNote] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const commentRef = useRef<HTMLInputElement>(null);
  const subtaskRef = useRef<HTMLInputElement>(null);

  const overdue = isOverdue(row, new Date());
  const due = dueText(row);
  const repeat = repeatSummary(row.repeat_days, row.repeat_until ?? null);
  const subtasksOpen = subtasks.length > 0 || showSubtasks;
  const reasonId = `${id}-reason`;

  async function run(call: PromiseLike<{ error: unknown }>, fallback: string, success?: string) {
    setBusy(true);
    const { error } = await call;
    setBusy(false);
    if (error) {
      toast.error(errorText(error, fallback));
      return false;
    }
    if (success) toast.success(success);
    reloadThread();
    onChanged();
    return true;
  }

  const rpc = () => createClient();

  async function setStatus(status: TaskStatus, doneNote?: string) {
    const ok = await run(
      rpc().rpc("set_task_status", { item: row.item_id, status, ...(doneNote ? { note: doneNote } : {}) }),
      "That didn't save. Try again.",
      status === "in_review" ? "Sent for review." : status === "done" ? "Marked done." : undefined,
    );
    if (ok) {
      setPanel(null);
      setNote("");
    }
  }

  async function addSubtask() {
    const title = newSubtask.trim();
    if (!title) return;
    if (await run(rpc().rpc("add_subtask", { item: row.item_id, title }), "The subtask didn't save. Try again.")) {
      setNewSubtask("");
      subtaskRef.current?.focus();
    }
  }

  async function sendComment() {
    const body = comment.trim();
    if (!body) return;
    const ok = await run(
      rpc().rpc("add_task_comment", { item: row.item_id, body, ...(target ? { subtask: target.id } : {}) }),
      "The comment didn't send. Try again.",
    );
    if (ok) {
      setComment("");
      setTarget(null);
    }
  }

  async function review(approve: boolean) {
    const body = comment.trim();
    if (!approve && !body) {
      setFormError("Write what needs changing in the comment box, then tap Needs changes.");
      commentRef.current?.focus();
      return;
    }
    const ok = await run(
      rpc().rpc("review_task", { item: row.item_id, approve, ...(body ? { comment: body } : {}) }),
      "The review didn't save. Try again.",
      approve ? "Approved. It's done." : "Sent back with your comment.",
    );
    if (ok) {
      setComment("");
      setTarget(null);
      setFormError(null);
    }
  }

  async function logTime() {
    const parsed = parseDuration(hours, minutes);
    if ("error" in parsed) return setFormError(parsed.error);
    const total = parsed.minutes ?? 0;
    if (total > 60000) return setFormError("That's more time than a task can log.");
    if (await run(rpc().rpc("log_task_time", { item: row.item_id, minutes: total }), "The time didn't save. Try again.")) {
      setPanel(null);
      setFormError(null);
    }
  }

  async function block() {
    const reason = note.trim();
    if (!reason) return setFormError("Say what's blocking it.");
    if (await run(rpc().rpc("set_task_blocked", { item: row.item_id, reason }), "That didn't save. Try again.", "Marked blocked.")) {
      setPanel(null);
      setNote("");
      setFormError(null);
    }
  }

  function primary() {
    const action = actions.primary;
    if (!action) return;
    if (action.kind === "review") void setStatus("in_review");
    else if (action.kind === "done") {
      setFormError(null);
      setPanel("done");
    } else void setStatus("in_progress");
  }

  function openLog() {
    setHours(String(Math.floor(row.spent_minutes / 60)));
    setMinutes(String(row.spent_minutes % 60));
    setFormError(null);
    setPanel("log");
  }

  return (
    <Dialog open modal={!wide} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 overflow-hidden bg-background p-0 pb-0 sm:pb-0",
          "lg:top-0 lg:right-0 lg:bottom-0 lg:left-auto lg:h-svh lg:max-h-none lg:w-[26rem] lg:translate-x-0 lg:translate-y-0 lg:rounded-none lg:border-l lg:border-border",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-4 [&>*]:shrink-0">
          <span aria-hidden className="h-1.5 w-9 self-center rounded-full bg-input sm:hidden" />
          <div className="flex min-h-11 flex-wrap items-center gap-2 pr-12">
            <span className={cn("rounded-full px-2.5 py-1 text-[13px] font-semibold", STATUS_PILL[row.status] ?? STATUS_PILL.todo)}>
              {STATUS_LABEL[row.status as TaskStatus] ?? row.status}
            </span>
            {row.blocked_reason ? (
              <span className="rounded-full bg-bad-bg px-2.5 py-1 text-[13px] font-semibold text-bad">Blocked</span>
            ) : null}
            <MoveMenu row={{ ...row, ...counts }} viewer={viewer} busy={busy} onMove={(status) => void setStatus(status)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <DialogTitle className="pr-0 text-2xl leading-tight font-bold">{row.title}</DialogTitle>
            {row.description ? (
              <DialogDescription className="mt-0 text-[15px] whitespace-pre-line text-foreground/80">{row.description}</DialogDescription>
            ) : (
              <DialogDescription className="sr-only">Task details, subtasks and comments.</DialogDescription>
            )}
            {row.link ? (
              <a href={row.link} target="_blank" rel="noopener noreferrer" className="w-fit text-sm break-all text-primary underline">
                {row.link}
              </a>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {row.person_name ? `For ${row.person_name} · ` : ""}From {row.created_by_name}
              {row.working_with?.length ? ` · Working with ${row.working_with.join(", ")}` : ""}
            </p>
          </div>

          {row.blocked_reason ? (
            <p className="rounded-xl bg-bad-bg px-3.5 py-2.5 text-[15px] text-bad">
              <span className="font-semibold">Blocked:</span> {row.blocked_reason}
            </p>
          ) : null}

          <dl className={cn(group, "grid grid-cols-2 [&>div]:border-border [&>div]:px-3.5 [&>div]:py-2.5")}>
            <Fact label="Due" className="border-r border-b">
              <span className={overdue ? "text-bad" : undefined}>{due ?? "No date"}</span>
            </Fact>
            <Fact label="Priority" className="border-b">
              <span className={cn("rounded-full px-2 py-0.5 text-sm", PRIORITY_CHIP[row.priority])}>
                {PRIORITY_LABEL[row.priority as Priority] ?? row.priority}
              </span>
            </Fact>
            <Fact label="Reviewer" className="border-r border-b">
              {row.reviewer_name ?? "None"}
            </Fact>
            <Fact label="Estimate" className="border-b">
              {row.estimate_minutes ? formatMinutes(row.estimate_minutes) : "None"}
            </Fact>
            <div className={cn("col-span-2 flex items-center justify-between gap-2", repeat ? "border-b" : null)}>
              <div>
                <dt className="text-xs text-muted-foreground">Time spent</dt>
                <dd className="mt-0.5 text-[15px] font-semibold">{formatMinutes(row.spent_minutes)}</dd>
              </div>
              {actions.logTime ? (
                <Button type="button" size="sm" variant="secondary" aria-expanded={panel === "log"} onClick={openLog}>
                  Log time
                </Button>
              ) : null}
            </div>
            {repeat ? (
              <Fact label="Repeats" className="col-span-2">
                {repeat}
              </Fact>
            ) : null}
          </dl>

          {panel === "log" ? (
            <form
              aria-label="Log time"
              className={cn(group, "flex flex-col gap-2 p-3.5")}
              onSubmit={(event) => {
                event.preventDefault();
                void logTime();
              }}
            >
              <p className="text-sm text-muted-foreground">Total time spent so far.</p>
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label="Hours spent" inputMode="numeric" maxLength={4} className="w-20" value={hours} onChange={(e) => setHours(e.target.value)} />
                <span aria-hidden>h</span>
                <Input aria-label="Minutes spent" inputMode="numeric" maxLength={3} className="w-20" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
                <span aria-hidden>m</span>
              </div>
              {formError ? <FormMessage>{formError}</FormMessage> : null}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy}>
                  Save time
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPanel(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}

          {subtasksOpen ? (
            <section aria-labelledby={`${id}-subtasks`} className={group}>
              <div className="flex min-h-11 items-center justify-between border-b border-border pl-3.5">
                <h2 id={`${id}-subtasks`} className="text-[15px] font-semibold">
                  Subtasks{" "}
                  {subtasks.length ? (
                    <span className="font-normal text-muted-foreground">
                      {counts.subtasks_done} of {subtasks.length}
                    </span>
                  ) : null}
                </h2>
                {actions.editSubtasks ? (
                  <Button type="button" size="icon" variant="ghost" aria-label="Add subtask" onClick={() => subtaskRef.current?.focus()}>
                    <Plus aria-hidden className="size-5" />
                  </Button>
                ) : null}
              </div>
              <ul className="divide-y divide-border">
                {subtasks.map((item) => {
                  const count = comments.filter((entry) => entry.subtask_id === item.id).length;
                  return (
                    <li key={item.id} className="flex min-h-11 items-center gap-1 pl-3.5">
                      <label className={cn("flex min-h-11 flex-1 items-center gap-3 text-[15px]", item.done_at ? "text-muted-foreground line-through" : null)}>
                        <input
                          type="checkbox"
                          className="size-5 shrink-0 accent-primary"
                          checked={ticked[item.id] ?? Boolean(item.done_at)}
                          disabled={!actions.editSubtasks}
                          onChange={(e) => {
                            const done = e.target.checked;
                            setTicked((now) => ({ ...now, [item.id]: done }));
                            void run(rpc().rpc("set_subtask", { id: item.id, done }), "That didn't save. Try again.").then(
                              (ok) => ok || setTicked((now) => ({ ...now, [item.id]: !done })),
                            );
                          }}
                        />
                        {item.title}
                      </label>
                      <button
                        type="button"
                        aria-label={count ? `${count} ${count === 1 ? "comment" : "comments"} on ${item.title}. Comment on it` : `Comment on ${item.title}`}
                        aria-pressed={target?.id === item.id}
                        onClick={() => {
                          setTarget(item);
                          commentRef.current?.focus();
                        }}
                        className={cn(
                          "flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full px-2 text-xs font-semibold",
                          count ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        <MessageSquare aria-hidden className="size-4" />
                        {count ? count : null}
                      </button>
                      {actions.editSubtasks ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="text-muted-foreground"
                          aria-label={`Remove ${item.title}`}
                          disabled={busy}
                          onClick={() => void run(rpc().rpc("remove_subtask", { id: item.id }), "That didn't save. Try again.")}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
                {actions.editSubtasks ? (
                  <li>
                    <form
                      className="flex items-center gap-2 py-1 pr-1 pl-3.5"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void addSubtask();
                      }}
                    >
                      <label htmlFor={`${id}-new-subtask`} className="sr-only">
                        New subtask
                      </label>
                      <input
                        id={`${id}-new-subtask`}
                        ref={subtaskRef}
                        maxLength={140}
                        placeholder="Add a subtask"
                        className="min-h-11 min-w-0 flex-1 bg-transparent text-[15px]"
                        value={newSubtask}
                        onChange={(e) => setNewSubtask(e.target.value)}
                      />
                      <Button type="submit" size="sm" variant="secondary" disabled={busy || !newSubtask.trim()}>
                        Add
                      </Button>
                    </form>
                  </li>
                ) : null}
              </ul>
            </section>
          ) : actions.editSubtasks ? (
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={() => {
                setShowSubtasks(true);
                requestAnimationFrame(() => subtaskRef.current?.focus());
              }}
            >
              <ListChecks aria-hidden />
              Add subtasks
            </Button>
          ) : null}

          <section aria-labelledby={`${id}-comments`} className="flex flex-col gap-2">
            <h2 id={`${id}-comments`} className="mx-1 text-[15px] font-semibold text-muted-foreground">
              Comments
            </h2>
            {thread.status === "error" ? (
              <div className="flex flex-col items-start gap-2">
                <FormMessage>{thread.message}</FormMessage>
                <Button type="button" size="sm" variant="secondary" onClick={reloadThread}>
                  Try again
                </Button>
              </div>
            ) : thread.status === "loading" ? (
              <p className="mx-1 text-sm text-muted-foreground">Loading…</p>
            ) : comments.length === 0 ? (
              <p className="mx-1 text-sm text-muted-foreground">No comments yet.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {comments.map((entry) => {
                  const on = subtasks.find((item) => item.id === entry.subtask_id);
                  return (
                    <li key={entry.id} className={cn(group, "flex gap-2.5 px-3.5 py-3")}>
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-bold",
                          entry.kind === "changes" ? "bg-warn-bg text-warn" : entry.kind === "approved" ? "bg-ok-bg text-ok" : "bg-primary/10 text-primary",
                        )}
                      >
                        {initials(entry.author_name)}
                      </span>
                      <div className="flex min-w-0 flex-col gap-1">
                        <p className="text-[13px] text-muted-foreground">
                          <strong className="text-foreground">{entry.mine ? "You" : (entry.author_name ?? "Someone")}</strong>
                          {KIND_TEXT[entry.kind] ?? ""}
                          {on ? ` · on "${on.title}"` : ""} · {formatDayTime(entry.created_at)}
                        </p>
                        <p className="text-[15px] break-words whitespace-pre-line">{entry.body}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        <div className="flex shrink-0 flex-col gap-2.5 border-t border-border bg-card px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {target ? (
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              On &ldquo;{target.title}&rdquo;
              <button
                type="button"
                aria-label="Comment on the whole task instead"
                className="grid size-11 place-items-center rounded-full"
                onClick={() => setTarget(null)}
              >
                <X aria-hidden className="size-4" />
              </button>
            </p>
          ) : null}
          <form
            className="flex min-h-11 items-center gap-2 rounded-full border border-input bg-background py-1 pr-1 pl-4"
            onSubmit={(event) => {
              event.preventDefault();
              void sendComment();
            }}
          >
            <label htmlFor={`${id}-comment`} className="sr-only">
              Write a comment
            </label>
            <input
              id={`${id}-comment`}
              ref={commentRef}
              maxLength={1000}
              placeholder={actions.review ? "Comment (needed for Needs changes)" : "Write a comment"}
              className="min-w-0 flex-1 bg-transparent text-[15px]"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <Button type="submit" size="icon" aria-label="Send comment" disabled={busy || !comment.trim()}>
              <ArrowUp aria-hidden />
            </Button>
          </form>

          {panel === "block" ? (
            <InlineForm
              label="What's blocking it?"
              value={note}
              setValue={setNote}
              maxLength={300}
              submit="Mark blocked"
              busy={busy}
              error={formError}
              onSubmit={() => void block()}
              onCancel={() => setPanel(null)}
            />
          ) : panel === "done" ? (
            <InlineForm
              label="Note (optional)"
              placeholder="What you did"
              value={note}
              setValue={setNote}
              maxLength={500}
              submit="Mark done"
              busy={busy}
              error={null}
              onSubmit={() => void setStatus("done", note.trim() || undefined)}
              onCancel={() => setPanel(null)}
            />
          ) : (
            <>
              {formError && panel === null ? <FormMessage>{formError}</FormMessage> : null}
              <div className="flex gap-2.5">
                {actions.blocked ? (
                  <Button
                    type="button"
                    variant="outline"
                    className={cn("min-h-12 rounded-xl text-bad", row.blocked_reason ? "border-bad bg-bad-bg" : null)}
                    aria-pressed={Boolean(row.blocked_reason)}
                    disabled={busy}
                    onClick={() => {
                      if (row.blocked_reason)
                        void run(rpc().rpc("set_task_blocked", { item: row.item_id, reason: null as unknown as string }), "That didn't save. Try again.", "Unblocked.");
                      else {
                        setNote("");
                        setFormError(null);
                        setPanel("block");
                      }
                    }}
                  >
                    Blocked
                  </Button>
                ) : null}
                {actions.review ? (
                  <>
                    <Button type="button" variant="outline" className="min-h-12 flex-1 rounded-xl" disabled={busy} onClick={() => void review(false)}>
                      Needs changes
                    </Button>
                    <Button type="button" className="min-h-12 flex-1 rounded-xl" disabled={busy} onClick={() => void review(true)}>
                      Approve
                    </Button>
                  </>
                ) : actions.primary ? (
                  <Button
                    type="button"
                    variant={actions.primary.kind === "withdraw" || actions.primary.kind === "reopen" ? "outline" : "default"}
                    className="min-h-12 flex-1 rounded-xl"
                    disabled={busy || Boolean(actions.primary.blocker)}
                    aria-describedby={actions.primary.blocker ? reasonId : undefined}
                    onClick={primary}
                  >
                    {actions.primary.label}
                  </Button>
                ) : null}
              </div>
              {actions.primary?.blocker ? (
                <p id={reasonId} className="text-center text-[13px] text-muted-foreground">
                  {actions.primary.blocker}
                </p>
              ) : row.status === "in_review" && !actions.review ? (
                <p className="text-center text-[13px] text-muted-foreground">
                  Waiting for {row.reviewer_name ?? "the reviewer"} to review it.
                </p>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold">{children}</dd>
    </div>
  );
}

function InlineForm({
  label,
  placeholder,
  value,
  setValue,
  maxLength,
  submit,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  label: string;
  placeholder?: string;
  value: string;
  setValue: (value: string) => void;
  maxLength: number;
  submit: string;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} autoFocus maxLength={maxLength} placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
      {error ? <FormMessage>{error}</FormMessage> : null}
      <div className="flex gap-2">
        <Button type="submit" className="min-h-12 flex-1 rounded-xl" disabled={busy}>
          {submit}
        </Button>
        <Button type="button" variant="ghost" className="min-h-12 rounded-xl" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

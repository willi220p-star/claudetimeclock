"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  STATUSES,
  boardColumns,
  dueText,
  formatMinutes,
  isOverdue,
  moveBlocker,
  repeatSummary,
  type Priority,
  type TaskItem,
  type TaskStatus,
  type Viewer,
} from "@/components/tasks/task-helpers";
import { cn } from "@/lib/utils";

export const PRIORITY_CHIP: Record<string, string> = {
  high: "bg-bad-bg text-bad",
  medium: "bg-warn-bg text-warn",
  low: "bg-muted text-muted-foreground",
};
export const STATUS_PILL: Record<string, string> = {
  todo: "bg-muted text-muted-foreground",
  in_progress: "bg-primary/10 text-primary",
  in_review: "bg-lavender/30 text-foreground",
  done: "bg-ok-bg text-ok",
};

const WIDE = "(min-width: 1024px)";
function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
/** 1024px and up: the detail is a side panel beside the list rather than a bottom sheet. */
export function useWide() {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
}

export type View = "list" | "board";

/** List | Board (D48). Calendar comes later. */
export function ViewSwitch({ view, setView }: { view: View; setView: (view: View) => void }) {
  return (
    <div role="group" aria-label="View" className="grid w-full max-w-60 grid-cols-2 rounded-[10px] bg-muted p-0.5">
      {(["list", "board"] as const).map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={view === item}
          onClick={() => setView(item)}
          className={cn(
            "min-h-11 rounded-lg text-sm",
            view === item ? "bg-card font-semibold shadow-card" : "text-foreground hover:bg-card/60",
          )}
        >
          {item === "list" ? "List" : "Board"}
        </button>
      ))}
    </div>
  );
}

function PriorityChip({ priority }: { priority: string }) {
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", PRIORITY_CHIP[priority] ?? PRIORITY_CHIP.low)}>
      {PRIORITY_LABEL[priority as Priority] ?? priority}
      <span className="sr-only"> priority</span>
    </span>
  );
}

/** The list row's status ring: hollow to do, half in progress, filled in review, ticked done; red when overdue. */
function StatusRing({ status, overdue }: { status: string; overdue: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-px grid size-[22px] shrink-0 place-items-center rounded-full border-2",
        status === "done"
          ? "border-ok bg-ok text-card"
          : overdue
            ? "border-bad"
            : status === "in_progress"
              ? "border-primary bg-[linear-gradient(90deg,var(--primary)_50%,transparent_50%)]"
              : status === "in_review"
                ? "border-primary bg-lavender"
                : "border-muted-foreground",
      )}
    >
      {status === "done" ? <Check className="size-3.5" strokeWidth={3} /> : null}
    </span>
  );
}

/** The meta line shared by rows and board cards: due (red when overdue), repeat, subtasks, Blocked, In review. */
function MetaLine({ row, time = false }: { row: TaskItem; time?: boolean }) {
  const due = dueText(row);
  const overdue = isOverdue(row, new Date());
  const repeat = repeatSummary(row.repeat_days, row.repeat_until ?? null);
  const parts = [
    due ? (
      <span key="due" className={overdue ? "font-semibold text-bad" : undefined}>
        {overdue ? `Overdue · ${due}` : due}
      </span>
    ) : null,
    repeat ? <span key="repeat">{repeat}</span> : null,
    row.subtasks_total > 0 ? (
      <span key="subtasks">
        {row.subtasks_done} of {row.subtasks_total} subtasks
      </span>
    ) : null,
    time && (row.spent_minutes > 0 || row.estimate_minutes) ? (
      <span key="time">
        {formatMinutes(row.spent_minutes)}
        {row.estimate_minutes ? ` of ${formatMinutes(row.estimate_minutes)}` : ""}
      </span>
    ) : null,
    row.blocked_reason && row.status !== "done" ? (
      <span key="blocked" className="font-semibold text-bad">
        Blocked
      </span>
    ) : null,
    row.status === "in_review" ? (
      <span key="review" className="font-semibold text-primary">
        In review{row.reviewer_name ? ` · ${row.reviewer_name}` : ""}
      </span>
    ) : null,
    row.comments > 0 ? <span key="comments">{row.comments === 1 ? "1 comment" : `${row.comments} comments`}</span> : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <span className="flex flex-wrap gap-x-2.5 gap-y-1 text-[13px] text-muted-foreground">{parts}</span>;
}

/** One copy as a row (D48 Main mockup); tapping it opens the detail. `name` replaces the title (staff: the person). */
export function TaskRow({ row, name, onOpen }: { row: TaskItem; name?: string; onOpen: () => void }) {
  const overdue = isOverdue(row, new Date());
  return (
    <li>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={onOpen}
        className="flex min-h-14 w-full gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/50"
      >
        <StatusRing status={row.status} overdue={overdue} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn("text-base font-semibold", row.status === "done" ? "text-muted-foreground line-through" : null)}>
            <span className="sr-only">{STATUS_LABEL[row.status as TaskStatus] ?? row.status}: </span>
            {name ?? row.title}
          </span>
          <MetaLine row={row} />
        </span>
        <span className="self-center">
          <PriorityChip priority={row.priority} />
        </span>
      </button>
    </li>
  );
}

/** "Move to…" (D48): the accessible way to move a card, with the same rules as set_task_status. */
export function MoveMenu({
  row,
  viewer,
  busy,
  onMove,
}: {
  row: TaskItem;
  viewer: Viewer;
  busy: boolean;
  onMove: (status: TaskStatus) => void;
}) {
  const targets = STATUSES.filter((status) => status !== row.status).map((status) => ({
    status,
    blocker: moveBlocker(row, viewer, status),
  }));
  if (targets.every((target) => target.blocker)) return null;
  return (
    <select
      aria-label={`Move ${row.title} to`}
      className="ml-auto h-11 max-w-40 rounded-lg border border-input bg-card px-2 text-sm"
      value=""
      disabled={busy}
      onChange={(e) => {
        if (e.target.value) onMove(e.target.value as TaskStatus);
      }}
    >
      <option value="">Move to…</option>
      {targets.map((target) => (
        <option key={target.status} value={target.status} disabled={Boolean(target.blocker)}>
          {STATUS_LABEL[target.status]}
        </option>
      ))}
    </select>
  );
}

/**
 * Board (D48): four columns on wide screens; on phones the columns swipe with scroll-snap and a dot per column.
 * Moving is through each card's "Move to…" menu, never drag only.
 */
export function TaskBoard({
  rows,
  viewerOf,
  busy,
  onOpen,
  onMove,
  showPerson = false,
}: {
  rows: TaskItem[];
  viewerOf: (row: TaskItem) => Viewer;
  busy: boolean;
  onOpen: (row: TaskItem) => void;
  onMove: (row: TaskItem, status: TaskStatus) => void;
  showPerson?: boolean;
}) {
  const columns = boardColumns(rows);
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  function onScroll() {
    const el = track.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!el || !first) return;
    setActive(Math.min(columns.length - 1, Math.round(el.scrollLeft / (first.offsetWidth + 12))));
  }

  function show(index: number) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    (track.current?.children[index] as HTMLElement | undefined)?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      inline: "start",
      block: "nearest",
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-center gap-1 lg:hidden" role="group" aria-label="Board columns">
        {columns.map((column, index) => (
          <button
            key={column.status}
            type="button"
            aria-label={`Show ${column.label}`}
            aria-current={active === index ? "true" : undefined}
            onClick={() => show(index)}
            className="grid size-11 place-items-center"
          >
            <span aria-hidden className={cn("size-2 rounded-full", active === index ? "bg-primary" : "bg-input")} />
          </button>
        ))}
      </div>
      <div
        ref={track}
        onScroll={onScroll}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0"
      >
        {columns.map((column) => (
          <section
            key={column.status}
            aria-labelledby={`col-${column.status}`}
            className="flex w-[85%] shrink-0 snap-start flex-col gap-2 rounded-xl bg-muted/60 p-2.5 lg:w-auto"
          >
            <h2 id={`col-${column.status}`} className="mx-1 flex items-center gap-2 text-[15px] font-semibold">
              {column.label}
              <span className="font-normal text-muted-foreground">{column.rows.length}</span>
            </h2>
            {column.rows.length === 0 ? <p className="mx-1 text-sm text-muted-foreground">Nothing here.</p> : null}
            <ul className="flex flex-col gap-2">
              {column.rows.map((row) => (
                <li key={row.item_id} className="flex flex-col gap-2 rounded-xl bg-card p-3 shadow-card">
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => onOpen(row)}
                    className="flex flex-col gap-1.5 rounded-md text-left"
                  >
                    <span className="font-semibold">{row.title}</span>
                    {showPerson && row.person_name ? <span className="text-sm text-muted-foreground">{row.person_name}</span> : null}
                    <MetaLine row={row} time />
                  </button>
                  <div className="flex items-center gap-2">
                    <PriorityChip priority={row.priority} />
                    <MoveMenu row={row} viewer={viewerOf(row)} busy={busy} onMove={(status) => onMove(row, status)} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

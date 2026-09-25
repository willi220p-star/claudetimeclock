"use client";

import { useCallback, useState } from "react";
import { AdminFrame } from "@/app/admin/admin-frame";
import { FormField, FormMessage } from "@/components/form-field";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AUDIT_TABLES } from "@/lib/admin-config";
import { searchAudit, type AuditEntry } from "@/lib/data";
import { errorText } from "@/lib/daymark";
import { darwinAt, formatDayTime } from "@/lib/darwin";
import { addDays } from "@/lib/periods";
import { useLoad } from "@/lib/use-load";

const PAGE_SIZE = 50;
const selectClass = "h-12 w-full rounded-md border border-input bg-card px-3";
type Filters = { action: string; table: string; from: string; to: string };
const NO_FILTERS: Filters = { action: "", table: "", from: "", to: "" };

/** Filters as audit_search arguments. Dates are Darwin days; `to` is inclusive, so it ends at the next midnight. */
function argsOf(filters: Filters, beforeId?: number) {
  return {
    action: filters.action.trim() || undefined,
    table_name: filters.table || undefined,
    from_ts: filters.from ? darwinAt(filters.from, "00:00").toISOString() : undefined,
    to_ts: filters.to ? darwinAt(addDays(filters.to, 1), "00:00").toISOString() : undefined,
    before_id: beforeId,
    page_size: PAGE_SIZE,
  };
}

export function AuditScreen() {
  return (
    <AdminFrame title="Audit">
      <AuditDesk />
    </AdminFrame>
  );
}

function AuditDesk() {
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [more, setMore] = useState<{ rows: AuditEntry[]; next: number | null } | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const load = useCallback(() => searchAudit(argsOf(applied)), [applied]);
  const [first, reload] = useLoad(load);
  const set = (key: keyof Filters) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  function apply(filters: Filters) {
    if (filters.from && filters.to && filters.from > filters.to) {
      setFilterError("The start date must be on or before the end date.");
      return;
    }
    setFilterError(null);
    setMore(null);
    setMoreError(null);
    setApplied(filters);
  }

  async function loadMore(beforeId: number, soFar: AuditEntry[]) {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await searchAudit(argsOf(applied, beforeId));
      setMore({ rows: [...soFar, ...page.rows], next: page.next_before_id });
    } catch (error) {
      setMoreError(errorText(error, "More entries didn't load. Try again."));
    }
    setLoadingMore(false);
  }

  return (
    <>
      <PageHeader title="Audit" description="Every admin change and system job, newest first. Times are Darwin time." />
      <form
        noValidate
        className="grid gap-4 rounded-xl bg-card p-4 shadow-card sm:grid-cols-2 sm:p-6 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          apply(draft);
        }}
      >
        <FormField id="audit-action" label="Action" hint="Exact name, e.g. update_site.">
          {(field) => (
            <Input {...field} autoComplete="off" autoCapitalize="none" spellCheck={false} value={draft.action} onChange={set("action")} />
          )}
        </FormField>
        <FormField id="audit-table" label="Table">
          {(field) => (
            <select {...field} className={selectClass} value={draft.table} onChange={set("table")}>
              <option value="">All tables</option>
              {AUDIT_TABLES.map((table) => (
                <option key={table} value={table}>
                  {table}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField id="audit-from" label="From">
          {(field) => <Input {...field} type="date" value={draft.from} onChange={set("from")} />}
        </FormField>
        <FormField id="audit-to" label="To">
          {(field) => <Input {...field} type="date" value={draft.to} onChange={set("to")} />}
        </FormField>
        {filterError ? (
          <div className="sm:col-span-2 lg:col-span-4">
            <FormMessage>{filterError}</FormMessage>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit">Search</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDraft(NO_FILTERS);
              apply(NO_FILTERS);
            }}
          >
            Clear
          </Button>
        </div>
      </form>
      <LoadBlock state={first} reload={reload}>
        {(page) => {
          const rows = more?.rows ?? page.rows;
          const next = more ? more.next : page.next_before_id;
          if (rows.length === 0) {
            return <p className="text-sm text-muted-foreground">No audit entries match.</p>;
          }
          return (
            <div className="flex flex-col gap-3">
              <ul className="flex flex-col gap-2">
                {rows.map((row) => (
                  <AuditRow key={row.id} row={row} />
                ))}
              </ul>
              {moreError ? <FormMessage>{moreError}</FormMessage> : null}
              {next ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="self-start"
                  disabled={loadingMore}
                  onClick={() => void loadMore(next, rows)}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">That&apos;s everything.</p>
              )}
            </div>
          );
        }}
      </LoadBlock>
    </>
  );
}

function AuditRow({ row }: { row: AuditEntry }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-semibold break-all">{row.action}</p>
        <p className="text-sm text-muted-foreground tabular-nums">{formatDayTime(row.at)}</p>
      </div>
      <p className="text-sm break-all text-muted-foreground">
        {row.actor_name ?? (row.actor_id ? "Unknown person" : "System")} · {row.table_name}
        {row.row_id ? ` · ${row.row_id}` : ""}
      </p>
      {row.before !== null || row.after !== null ? (
        <details className="group">
          <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-primary">
            Before and after
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <JsonBlock label="Before" value={row.before} />
            <JsonBlock label="After" value={row.after} />
          </div>
        </details>
      ) : null}
    </li>
  );
}

/** JSON as plain text: React escapes it, never raw HTML. */
function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="caption font-semibold text-muted-foreground">{label}</p>
      <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs break-all whitespace-pre-wrap">
        {value === null || value === undefined ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

"use client";

import { useCallback, useState } from "react";
import { InternFrame } from "@/app/clock/intern-frame";
import { DeskGate } from "@/components/desk-gate";
import { EmptyState } from "@/components/empty-state";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { RequestForm } from "@/components/request-form";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { loadMyPlacement, loadRequestsForPlacement } from "@/lib/data";
import { formatDay } from "@/lib/darwin";
import { REQUEST_STATUS_LABEL, isPending, requestLabel, requestTimeline } from "@/lib/placement-ui";
import { useLoad } from "@/lib/use-load";

export function RequestsScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <InternFrame profile={profile} title="Requests">
          <RequestsDesk />
        </InternFrame>
      )}
    </DeskGate>
  );
}

function RequestsDesk() {
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const [compose, setCompose] = useState(false);
  const load = useCallback(async () => {
    const placement = await loadMyPlacement();
    if (!placement) return [];
    return loadRequestsForPlacement(placement.id);
  }, []);
  const [state, reload] = useLoad(load);

  return (
    <>
      <PageHeader
        title="Requests"
        description="Pending first. Decided keeps the outcome."
        actions={
          <Button type="button" onClick={() => setCompose((open) => !open)}>
            New request
          </Button>
        }
      />
      {compose ? (
        <section className="rounded-xl bg-card p-6 shadow-card">
          <RequestForm
            onSubmitted={() => {
              setCompose(false);
              setTab("pending");
              reload();
            }}
          />
        </section>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" variant={tab === "pending" ? "default" : "secondary"} onClick={() => setTab("pending")}>
          Pending
        </Button>
        <Button type="button" variant={tab === "decided" ? "default" : "secondary"} onClick={() => setTab("decided")}>
          Decided
        </Button>
      </div>
      <LoadBlock
        state={state}
        reload={reload}
        empty="No requests yet. Need to change a day? New request."
        action={
          <Button type="button" onClick={() => setCompose(true)}>
            New request
          </Button>
        }
      >
        {(rows) => {
          const visible = rows.filter((row) => (tab === "pending" ? isPending(row.status) : !isPending(row.status)));
          if (visible.length === 0) {
            return (
              <EmptyState
                action={
                  tab === "pending" ? (
                    <Button type="button" onClick={() => setCompose(true)}>
                      New request
                    </Button>
                  ) : undefined
                }
              >
                {tab === "pending" ? "Nothing pending." : "No decided requests yet."}
              </EmptyState>
            );
          }
          return (
            <ul className="flex flex-col gap-2">
              {visible.map((row) => {
                const timeline = requestTimeline(row.status, row.needs_extra_spot);
                return (
                  <li key={row.id} className="flex flex-col gap-2 rounded-xl bg-card p-4 shadow-card">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">{requestLabel(row.type)}</p>
                      <StatusChip
                        tone={row.status === "approved" ? "ok" : row.status === "declined" ? "bad" : "info"}
                        label={REQUEST_STATUS_LABEL[row.status] ?? row.status}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {(row.dates ?? []).map((d) => formatDay(d)).join(", ") || "Dates set on send"}
                    </p>
                    <ol className="flex flex-wrap gap-2 text-sm">
                      {timeline.steps.map((step) => (
                        <li
                          key={step}
                          aria-current={step === timeline.current ? "step" : undefined}
                          className={step === timeline.current ? "font-semibold" : "text-muted-foreground"}
                        >
                          {step}
                        </li>
                      ))}
                    </ol>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </LoadBlock>
    </>
  );
}

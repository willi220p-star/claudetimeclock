"use client";

import { useCallback } from "react";
import { InboxPanel } from "@/app/supervisor/inbox-panel";
import { loadSupervisorInbox } from "@/app/supervisor/supervisor";
import { DeskGate } from "@/components/desk-gate";
import { StaffShell } from "@/components/desk-shell";
import { LoadBlock } from "@/components/load-block";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useLoad } from "@/lib/use-load";

export function ApprovalsScreen() {
  return (
    <DeskGate role="supervisor">
      {(profile) => (
        <StaffShell profile={profile} role="supervisor" title="Approvals">
          <ApprovalsDesk />
        </StaffShell>
      )}
    </DeskGate>
  );
}

function ApprovalsDesk() {
  const load = useCallback(() => loadSupervisorInbox(), []);
  const [state, reload] = useLoad(load);

  return (
    <>
      <PageHeader title="Approvals" description="Oldest first. Escalated requests stay here and also go to the admin." />
      <LoadBlock
        state={state}
        reload={reload}
        empty="No approvals waiting. New requests from your interns will show up here."
        skeleton={
          <div className="flex flex-col gap-2">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
        }
      >
        {(items) => <InboxPanel items={items} onDone={reload} />}
      </LoadBlock>
    </>
  );
}

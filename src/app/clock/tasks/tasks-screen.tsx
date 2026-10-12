"use client";

import { InternShell } from "@/components/desk-shell";
import { DeskGate } from "@/components/desk-gate";
import { PageHeader } from "@/components/page-header";
import { TasksCard } from "@/components/tasks/tasks";

/** My work (D46): the intern's tasks. Board and calendar views come with tasks v2. */
export function TasksScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <InternShell profile={profile} title="My work">
          <div className="flex flex-col gap-6">
            <PageHeader title="My work" description="Your tasks and the ones you're working on with others." />
            <TasksCard filters />
          </div>
        </InternShell>
      )}
    </DeskGate>
  );
}

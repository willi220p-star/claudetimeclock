"use client";

import { InternShell } from "@/components/desk-shell";
import { DeskGate } from "@/components/desk-gate";
import { PageHeader } from "@/components/page-header";
import { TasksCard } from "@/components/tasks/tasks";

/** My work (D46, D48): the intern's tasks as a list or a board. The calendar view comes with PR E. */
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

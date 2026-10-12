"use client";

import { DeskGate } from "@/components/desk-gate";
import { StaffShell } from "@/components/desk-shell";
import { TasksDesk } from "@/components/tasks/tasks";

export function SupervisorTasks() {
  return (
    <DeskGate role="supervisor">
      {(profile) => (
        <StaffShell profile={profile} role="supervisor" title="Tasks">
          <TasksDesk isAdmin={false} />
        </StaffShell>
      )}
    </DeskGate>
  );
}

"use client";

import { DeskGate } from "@/components/desk-gate";
import { StaffShell } from "@/components/desk-shell";
import { ProjectPage, ProjectsList } from "@/components/projects/projects";

export function SupervisorProjects() {
  return (
    <DeskGate role="supervisor">
      {(profile) => (
        <StaffShell profile={profile} role="supervisor" title="Projects">
          <ProjectsList base="/supervisor/projects" staff />
        </StaffShell>
      )}
    </DeskGate>
  );
}

export function SupervisorProject() {
  return (
    <DeskGate role="supervisor">
      {(profile) => (
        <StaffShell profile={profile} role="supervisor" title="Project">
          <ProjectPage base="/supervisor/projects" staff />
        </StaffShell>
      )}
    </DeskGate>
  );
}

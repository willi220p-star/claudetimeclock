"use client";

import { InternShell } from "@/components/desk-shell";
import { DeskGate } from "@/components/desk-gate";
import { ProjectPage, ProjectsList } from "@/components/projects/projects";

/** Projects tab (D46, D49): the intern's visible projects and "+ Project". */
export function ProjectsScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <InternShell profile={profile} title="Projects">
          <ProjectsList base="/clock/projects" staff={false} />
        </InternShell>
      )}
    </DeskGate>
  );
}

/** `/clock/projects/view?id=…` (D49). */
export function ProjectScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <InternShell profile={profile} title="Project" wide>
          <ProjectPage base="/clock/projects" staff={false} />
        </InternShell>
      )}
    </DeskGate>
  );
}

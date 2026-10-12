"use client";

import { InternShell } from "@/components/desk-shell";
import { DeskGate } from "@/components/desk-gate";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

/** Projects tab (D46): an empty state until client projects ship. */
export function ProjectsScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <InternShell profile={profile} title="Projects">
          <div className="flex flex-col gap-6">
            <PageHeader title="Projects" />
            <EmptyState>Client projects will show here. You&apos;ll be able to add one and file tasks under it.</EmptyState>
          </div>
        </InternShell>
      )}
    </DeskGate>
  );
}

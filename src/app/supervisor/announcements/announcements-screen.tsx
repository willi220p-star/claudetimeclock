"use client";

import { AnnouncementsDesk } from "@/components/announcements";
import { DeskGate } from "@/components/desk-gate";
import { StaffShell } from "@/components/desk-shell";

export function SupervisorAnnouncements() {
  return (
    <DeskGate role="supervisor">
      {(profile) => (
        <StaffShell profile={profile} role="supervisor" title="Announcements">
          <AnnouncementsDesk isAdmin={false} />
        </StaffShell>
      )}
    </DeskGate>
  );
}

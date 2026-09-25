"use client";

import { AdminDesk } from "@/app/admin/admin-desk";
import { DeskGate } from "@/components/desk-gate";
import { AppHeader } from "@/components/app-header";

export function AdminScreen() {
  return (
    <DeskGate role="admin">
      {(profile) => (
        <>
          <AppHeader profile={profile} eyebrow="Admin desk" />
          <main>
            <AdminDesk profile={profile} />
          </main>
        </>
      )}
    </DeskGate>
  );
}

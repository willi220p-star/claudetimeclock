"use client";

import { AdminDesk } from "@/app/admin/admin-desk";
import { AppHeader } from "@/components/app-header";
import { DeskGate } from "@/components/desk-gate";

export function AdminScreen() {
  return (
    <DeskGate role="admin">
      {(profile) => (
        <>
          <AppHeader profile={profile} role="admin" title="Admin" />
          <main>
            <AdminDesk profile={profile} />
          </main>
        </>
      )}
    </DeskGate>
  );
}

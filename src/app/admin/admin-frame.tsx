"use client";

import type { ReactNode } from "react";
import { DeskGate } from "@/components/desk-gate";
import { StaffShell } from "@/components/desk-shell";
import type { Profile } from "@/lib/daymark";

export function AdminFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode | ((profile: Profile) => ReactNode);
}) {
  return (
    <DeskGate role="admin">
      {(profile) => (
        <StaffShell profile={profile} role="admin" title={title}>
          {typeof children === "function" ? children(profile) : children}
        </StaffShell>
      )}
    </DeskGate>
  );
}

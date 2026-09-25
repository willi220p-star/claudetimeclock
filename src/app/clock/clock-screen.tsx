"use client";

import { ClockDesk } from "@/app/clock/clock-desk";
import { AppHeader } from "@/components/app-header";
import { DeskGate } from "@/components/desk-gate";

export function ClockScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <>
          <AppHeader profile={profile} role="intern" title="Clock" />
          <main>
            <ClockDesk profile={profile} />
          </main>
        </>
      )}
    </DeskGate>
  );
}

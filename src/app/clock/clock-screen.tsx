"use client";

import { ClockDesk } from "@/app/clock/clock-desk";
import { InternShell } from "@/components/desk-shell";
import { DeskGate } from "@/components/desk-gate";

export function ClockScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <InternShell profile={profile} title="Today">
          <ClockDesk profile={profile} />
        </InternShell>
      )}
    </DeskGate>
  );
}

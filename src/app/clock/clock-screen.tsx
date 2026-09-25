"use client";

import { ClockDesk } from "@/app/clock/clock-desk";
import { InternFrame } from "@/app/clock/intern-frame";
import { DeskGate } from "@/components/desk-gate";

export function ClockScreen() {
  return (
    <DeskGate role="intern">
      {(profile) => (
        <InternFrame profile={profile} title="Today">
          <ClockDesk profile={profile} />
        </InternFrame>
      )}
    </DeskGate>
  );
}

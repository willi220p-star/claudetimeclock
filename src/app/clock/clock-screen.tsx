"use client";

import { use } from "react";
import { ClockDesk } from "@/app/clock/clock-desk";
import { DeskGate } from "@/components/desk-gate";
import { AppHeader } from "@/components/app-header";
import type { Profile } from "@/lib/daymark";
import { ownPunches } from "@/lib/punches";

export function ClockScreen() {
  return <DeskGate role="staff">{(profile) => <ClockReady profile={profile} />}</DeskGate>;
}

function ClockReady({ profile }: { profile: Profile }) {
  const punches = use(ownPunches(profile.id));

  return (
    <>
      <AppHeader profile={profile} eyebrow="Your shift" />
      <main>
        <ClockDesk profile={profile} initialPunches={punches} />
      </main>
    </>
  );
}

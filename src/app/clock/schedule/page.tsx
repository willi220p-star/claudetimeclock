import type { Metadata } from "next";
import { Suspense } from "react";
import { ScheduleScreen } from "@/app/clock/schedule/schedule-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = { title: "Schedule" };

export default function SchedulePage() {
  return (
    <Suspense fallback={<Opening label="Opening your schedule…" />}>
      <ScheduleScreen />
    </Suspense>
  );
}

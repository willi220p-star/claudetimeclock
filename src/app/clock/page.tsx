import type { Metadata } from "next";
import { Suspense } from "react";
import { ClockScreen } from "@/app/clock/clock-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Clock",
};

export default function ClockPage() {
  return (
    <Suspense fallback={<Opening label="Opening your shift…" />}>
      <ClockScreen />
    </Suspense>
  );
}

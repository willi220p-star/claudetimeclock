import type { Metadata } from "next";
import { Suspense } from "react";
import { ProgressScreen } from "@/app/clock/progress/progress-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = { title: "Progress" };

export default function ProgressPage() {
  return (
    <Suspense fallback={<Opening label="Opening your progress…" />}>
      <ProgressScreen />
    </Suspense>
  );
}

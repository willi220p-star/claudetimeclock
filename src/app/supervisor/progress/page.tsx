import type { Metadata } from "next";
import { Suspense } from "react";
import { SupervisorProgressScreen } from "@/app/supervisor/progress/progress-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Progress",
};

export default function SupervisorProgressPage() {
  return (
    <Suspense fallback={<Opening label="Opening progress…" />}>
      <SupervisorProgressScreen />
    </Suspense>
  );
}

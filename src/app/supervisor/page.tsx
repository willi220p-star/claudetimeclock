import type { Metadata } from "next";
import { Suspense } from "react";
import { SupervisorScreen } from "@/app/supervisor/supervisor-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Supervisor",
};

export default function SupervisorPage() {
  return (
    <Suspense fallback={<Opening label="Opening the supervisor desk…" />}>
      <SupervisorScreen />
    </Suspense>
  );
}

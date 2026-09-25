import type { Metadata } from "next";
import { Suspense } from "react";
import { RequestsScreen } from "@/app/clock/requests/requests-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = { title: "Requests" };

export default function RequestsPage() {
  return (
    <Suspense fallback={<Opening label="Opening your requests…" />}>
      <RequestsScreen />
    </Suspense>
  );
}

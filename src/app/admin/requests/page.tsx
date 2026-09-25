import type { Metadata } from "next";
import { Suspense } from "react";
import { RequestsScreen } from "@/app/admin/requests/requests-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Requests",
};

export default function RequestsPage() {
  return (
    <Suspense fallback={<Opening label="Opening requests…" />}>
      <RequestsScreen />
    </Suspense>
  );
}

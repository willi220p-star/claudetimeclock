import type { Metadata } from "next";
import { Suspense } from "react";
import { ApprovalsScreen } from "@/app/supervisor/approvals/approvals-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Approvals",
};

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<Opening label="Opening approvals…" />}>
      <ApprovalsScreen />
    </Suspense>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPlaceholderScreen } from "@/app/admin/placeholder-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Reports",
};

export default function ReportsPage() {
  return (
    <Suspense fallback={<Opening label="Opening reports…" />}>
      <AdminPlaceholderScreen title="Reports" rpc="uni_report" />
    </Suspense>
  );
}

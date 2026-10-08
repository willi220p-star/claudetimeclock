import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminProgressScreen } from "@/app/admin/progress/progress-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Progress",
};

export default function AdminProgressPage() {
  return (
    <Suspense fallback={<Opening label="Opening progress…" />}>
      <AdminProgressScreen />
    </Suspense>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPlaceholderScreen } from "@/app/admin/placeholder-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Audit",
};

export default function AuditPage() {
  return (
    <Suspense fallback={<Opening label="Opening the audit log…" />}>
      <AdminPlaceholderScreen title="Audit" rpc="audit_search" />
    </Suspense>
  );
}

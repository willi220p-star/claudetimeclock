import type { Metadata } from "next";
import { Suspense } from "react";
import { AuditScreen } from "@/app/admin/audit/audit-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Audit",
};

export default function AuditPage() {
  return (
    <Suspense fallback={<Opening label="Opening the audit log…" />}>
      <AuditScreen />
    </Suspense>
  );
}

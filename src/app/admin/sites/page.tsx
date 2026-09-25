import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPlaceholderScreen } from "@/app/admin/placeholder-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Sites",
};

export default function SitesPage() {
  return (
    <Suspense fallback={<Opening label="Opening sites…" />}>
      <AdminPlaceholderScreen title="Sites" rpc="save_site" />
    </Suspense>
  );
}

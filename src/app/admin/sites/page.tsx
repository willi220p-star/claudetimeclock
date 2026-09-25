import type { Metadata } from "next";
import { Suspense } from "react";
import { SitesScreen } from "@/app/admin/sites/sites-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Sites",
};

export default function SitesPage() {
  return (
    <Suspense fallback={<Opening label="Opening sites…" />}>
      <SitesScreen />
    </Suspense>
  );
}

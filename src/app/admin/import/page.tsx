import type { Metadata } from "next";
import { Suspense } from "react";
import { ImportScreen } from "@/app/admin/import/import-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Import",
};

export default function ImportPage() {
  return (
    <Suspense fallback={<Opening label="Opening import…" />}>
      <ImportScreen />
    </Suspense>
  );
}

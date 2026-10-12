import type { Metadata } from "next";
import { Suspense } from "react";
import { LabelsScreen } from "@/app/admin/labels/labels-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = { title: "Task labels" };

export default function LabelsPage() {
  return (
    <Suspense fallback={<Opening label="Opening task labels…" />}>
      <LabelsScreen />
    </Suspense>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { SummaryScreen } from "@/app/supervisor/summary/summary-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Monday summary",
};

export default function SummaryPage() {
  return (
    <Suspense fallback={<Opening label="Opening the Monday summary…" />}>
      <SummaryScreen />
    </Suspense>
  );
}

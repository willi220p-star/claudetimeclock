import type { Metadata } from "next";
import { Suspense } from "react";
import { HistoryScreen } from "@/app/clock/schedule/history/history-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = { title: "Shift history" };

export default function HistoryPage() {
  return (
    <Suspense fallback={<Opening label="Opening your shift history…" />}>
      <HistoryScreen />
    </Suspense>
  );
}

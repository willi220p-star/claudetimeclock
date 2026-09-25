import type { Metadata } from "next";
import { Suspense } from "react";
import { CohortsScreen } from "@/app/admin/cohorts/cohorts-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Cohorts",
};

export default function CohortsPage() {
  return (
    <Suspense fallback={<Opening label="Opening cohorts…" />}>
      <CohortsScreen />
    </Suspense>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { PlacementsScreen } from "@/app/admin/placements/placements-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Placements",
};

export default function PlacementsPage() {
  return (
    <Suspense fallback={<Opening label="Opening placements…" />}>
      <PlacementsScreen />
    </Suspense>
  );
}

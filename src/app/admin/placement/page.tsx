import type { Metadata } from "next";
import { Suspense } from "react";
import { PlacementScreen } from "@/app/admin/placement/placement-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Placement",
};

export default function PlacementPage() {
  return (
    <Suspense fallback={<Opening label="Opening the placement…" />}>
      <PlacementScreen />
    </Suspense>
  );
}

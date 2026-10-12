import type { Metadata } from "next";
import { Suspense } from "react";
import { KioskScreen } from "@/app/kiosk/kiosk-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Kiosk",
};

export default function KioskPage() {
  return (
    <Suspense fallback={<Opening label="Opening the kiosk…" />}>
      <KioskScreen />
    </Suspense>
  );
}

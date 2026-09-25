import type { Metadata } from "next";
import { Suspense } from "react";
import { MeScreen } from "@/app/clock/me/me-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = { title: "Me" };

export default function MePage() {
  return (
    <Suspense fallback={<Opening label="Opening your profile…" />}>
      <MeScreen />
    </Suspense>
  );
}

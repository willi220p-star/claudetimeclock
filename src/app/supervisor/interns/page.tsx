import type { Metadata } from "next";
import { Suspense } from "react";
import { InternsScreen } from "@/app/supervisor/interns/interns-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Interns",
};

export default function InternsPage() {
  return (
    <Suspense fallback={<Opening label="Opening intern list…" />}>
      <InternsScreen />
    </Suspense>
  );
}

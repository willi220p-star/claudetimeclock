import type { Metadata } from "next";
import { Suspense } from "react";
import { ConsentScreen } from "@/app/consent/consent-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Collection notice",
};

export default function ConsentPage() {
  return (
    <Suspense fallback={<Opening label="Opening the collection notice…" />}>
      <ConsentScreen />
    </Suspense>
  );
}

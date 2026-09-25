import { Suspense } from "react";
import { HomeGate, Opening } from "@/components/desk-gate";

export default function HomePage() {
  return (
    <Suspense fallback={<Opening label="Opening your desk…" />}>
      <HomeGate />
    </Suspense>
  );
}

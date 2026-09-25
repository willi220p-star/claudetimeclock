import type { Metadata } from "next";
import { Suspense } from "react";
import { ClosuresScreen } from "@/app/admin/closures/closures-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Closures",
};

export default function ClosuresPage() {
  return (
    <Suspense fallback={<Opening label="Opening closures…" />}>
      <ClosuresScreen />
    </Suspense>
  );
}

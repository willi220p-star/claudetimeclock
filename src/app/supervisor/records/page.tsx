import type { Metadata } from "next";
import { Suspense } from "react";
import { Opening } from "@/components/desk-gate";
import { RecordsScreen } from "@/components/records";

export const metadata: Metadata = {
  title: "Records",
};

export default function RecordsPage() {
  return (
    <Suspense fallback={<Opening label="Opening records…" />}>
      <RecordsScreen role="supervisor" />
    </Suspense>
  );
}

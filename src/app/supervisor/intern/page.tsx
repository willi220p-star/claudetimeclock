import type { Metadata } from "next";
import { Suspense } from "react";
import { InternScreen } from "@/app/supervisor/intern/intern-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Intern",
};

export default function InternPage() {
  return (
    <Suspense fallback={<Opening label="Opening intern…" />}>
      <InternScreen />
    </Suspense>
  );
}

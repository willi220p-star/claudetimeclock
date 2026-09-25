import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPlaceholderScreen } from "@/app/admin/placeholder-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Closures",
};

export default function ClosuresPage() {
  return (
    <Suspense fallback={<Opening label="Opening closures…" />}>
      <AdminPlaceholderScreen title="Closures" rpc="save_closure_day" />
    </Suspense>
  );
}

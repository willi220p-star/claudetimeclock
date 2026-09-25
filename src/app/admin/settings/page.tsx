import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPlaceholderScreen } from "@/app/admin/placeholder-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <Suspense fallback={<Opening label="Opening settings…" />}>
      <AdminPlaceholderScreen title="Settings" rpc="update_settings" />
    </Suspense>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsScreen } from "@/app/admin/settings/settings-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <Suspense fallback={<Opening label="Opening settings…" />}>
      <SettingsScreen />
    </Suspense>
  );
}

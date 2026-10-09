import type { Metadata } from "next";
import { Suspense } from "react";
import { NotificationSettingsScreen } from "@/app/admin/notifications/notification-settings";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Notifications",
};

export default function NotificationSettingsPage() {
  return (
    <Suspense fallback={<Opening label="Opening notifications…" />}>
      <NotificationSettingsScreen />
    </Suspense>
  );
}

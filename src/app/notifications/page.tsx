import type { Metadata } from "next";
import { Suspense } from "react";
import { NotificationsScreen } from "@/app/notifications/notifications-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <Suspense fallback={<Opening label="Opening notifications…" />}>
      <NotificationsScreen />
    </Suspense>
  );
}

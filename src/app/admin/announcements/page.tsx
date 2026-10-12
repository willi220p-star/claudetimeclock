import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminAnnouncements } from "@/app/admin/announcements/announcements-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Announcements",
};

export default function AnnouncementsPage() {
  return (
    <Suspense fallback={<Opening label="Opening announcements…" />}>
      <AdminAnnouncements />
    </Suspense>
  );
}

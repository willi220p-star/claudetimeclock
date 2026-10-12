"use client";

import { AdminFrame } from "@/app/admin/admin-frame";
import { AnnouncementsDesk } from "@/components/announcements";

export function AdminAnnouncements() {
  return (
    <AdminFrame title="Announcements">
      <AnnouncementsDesk isAdmin />
    </AdminFrame>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminScreen } from "@/app/admin/admin-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Admin",
};

export default function AdminPage() {
  return (
    <Suspense fallback={<Opening label="Opening the admin desk…" />}>
      <AdminScreen />
    </Suspense>
  );
}

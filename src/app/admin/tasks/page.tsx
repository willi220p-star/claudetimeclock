import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminTasks } from "@/app/admin/tasks/tasks-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Tasks",
};

export default function TasksPage() {
  return (
    <Suspense fallback={<Opening label="Opening tasks…" />}>
      <AdminTasks />
    </Suspense>
  );
}

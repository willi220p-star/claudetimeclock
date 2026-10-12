"use client";

import { AdminFrame } from "@/app/admin/admin-frame";
import { TasksDesk } from "@/components/tasks/tasks";

export function AdminTasks() {
  return (
    <AdminFrame title="Tasks">
      <TasksDesk isAdmin />
    </AdminFrame>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { SupervisorTasks } from "@/app/supervisor/tasks/tasks-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Tasks",
};

export default function TasksPage() {
  return (
    <Suspense fallback={<Opening label="Opening tasks…" />}>
      <SupervisorTasks />
    </Suspense>
  );
}

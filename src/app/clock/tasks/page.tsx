import type { Metadata } from "next";
import { Suspense } from "react";
import { TasksScreen } from "@/app/clock/tasks/tasks-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = { title: "My work" };

export default function TasksPage() {
  return (
    <Suspense fallback={<Opening label="Opening your tasks…" />}>
      <TasksScreen />
    </Suspense>
  );
}

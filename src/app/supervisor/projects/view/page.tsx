import type { Metadata } from "next";
import { Suspense } from "react";
import { SupervisorProject } from "@/app/supervisor/projects/projects-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = { title: "Project" };

export default function ProjectViewPage() {
  return (
    <Suspense fallback={<Opening label="Opening the project…" />}>
      <SupervisorProject />
    </Suspense>
  );
}

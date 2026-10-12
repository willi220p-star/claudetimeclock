import type { Metadata } from "next";
import { Suspense } from "react";
import { ProjectScreen } from "@/app/clock/projects/projects-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = { title: "Project" };

export default function ProjectViewPage() {
  return (
    <Suspense fallback={<Opening label="Opening the project…" />}>
      <ProjectScreen />
    </Suspense>
  );
}

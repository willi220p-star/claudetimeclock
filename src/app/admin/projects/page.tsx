import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminProjects } from "@/app/admin/projects/projects-screen";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <Suspense fallback={<Opening label="Opening projects…" />}>
      <AdminProjects />
    </Suspense>
  );
}

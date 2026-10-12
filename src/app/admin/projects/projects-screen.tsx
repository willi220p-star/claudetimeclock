"use client";

import { AdminFrame } from "@/app/admin/admin-frame";
import { ProjectPage, ProjectsList } from "@/components/projects/projects";

export function AdminProjects() {
  return (
    <AdminFrame title="Projects">
      <ProjectsList base="/admin/projects" staff />
    </AdminFrame>
  );
}

export function AdminProject() {
  return (
    <AdminFrame title="Project">
      <ProjectPage base="/admin/projects" staff />
    </AdminFrame>
  );
}

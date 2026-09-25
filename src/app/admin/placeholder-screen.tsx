"use client";

import { AdminFrame } from "@/app/admin/admin-frame";
import { StudioPlaceholder } from "@/components/studio-placeholder";

export function AdminPlaceholderScreen({ title, rpc }: { title: string; rpc: string }) {
  return (
    <AdminFrame title={title}>
      <StudioPlaceholder title={title} rpc={rpc} />
    </AdminFrame>
  );
}

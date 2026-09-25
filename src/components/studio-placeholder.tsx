import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

/** D15: these admin screens stay in Supabase Studio until Dilip asks for them. */
export function StudioPlaceholder({ title, rpc }: { title: string; rpc: string }) {
  return (
    <>
      <PageHeader title={title} description="This screen is coming in a later update." />
      <EmptyState>
        Use Supabase Studio for {title.toLowerCase()} for now. The database function {rpc} is ready.
      </EmptyState>
    </>
  );
}

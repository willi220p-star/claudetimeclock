import type { ReactNode } from "react";
import { EmptyState } from "@/components/empty-state";
import { FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Loaded } from "@/lib/use-load";

export function LoadBlock<T>({
  state,
  reload,
  empty,
  action,
  skeleton,
  children,
}: {
  state: Loaded<T>;
  reload: () => void;
  empty?: string;
  action?: ReactNode;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.status === "loading") {
    return (
      <div role="status">
        <span className="sr-only">Loading…</span>
        {skeleton ?? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        )}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <FormMessage>{state.message}</FormMessage>
        <Button type="button" variant="secondary" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }
  if (empty && (Array.isArray(state.data) ? state.data.length === 0 : !state.data)) {
    return <EmptyState action={action}>{empty}</EmptyState>;
  }
  return children(state.data);
}

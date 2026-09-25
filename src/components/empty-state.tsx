import type { ReactNode } from "react";

/** §11.4: one sentence and, when there is one, the next action. No illustration. */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-border bg-card px-6 py-8">
      <p className="text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}

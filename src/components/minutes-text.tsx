import { formatMinutes } from "@/lib/minutes";
import { cn } from "@/lib/utils";

/** Integer minutes as "7h 30m"; negative balances read "1h 30m ahead" in teal. */
export function MinutesText({ minutes, className }: { minutes: number; className?: string }) {
  return (
    <span className={cn("tabular-nums", minutes < 0 && "text-teal-ink", className)}>{formatMinutes(minutes)}</span>
  );
}

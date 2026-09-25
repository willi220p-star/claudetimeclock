import { CircleHelp } from "lucide-react";
import { StatusChip, type Tone } from "@/components/status-chip";

const days = (count: number) => (count === 1 ? "1 day" : `${count} days`);

/**
 * Pace from the forecast's days late (negative = ahead, null = no forecast).
 * Green ≤ 0, amber 1–5, red > 5 or no forecast (CONTEXT.md "Pace").
 */
export function paceOf(daysLate: number | null): { tone: Tone; label: string } {
  if (daysLate === null) return { tone: "bad", label: "Can't forecast" };
  if (daysLate < 0) return { tone: "ahead", label: `${days(-daysLate)} ahead` };
  if (daysLate === 0) return { tone: "ok", label: "On pace" };
  return { tone: daysLate <= 5 ? "warn" : "bad", label: `${days(daysLate)} behind` };
}

export function PaceChip({ daysLate }: { daysLate: number | null }) {
  const pace = paceOf(daysLate);
  return <StatusChip tone={pace.tone} label={pace.label} icon={daysLate === null ? CircleHelp : undefined} />;
}

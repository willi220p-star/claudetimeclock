import type { LucideIcon } from "lucide-react";
import { ArrowRightLeft, Ban, CalendarCheck, CalendarClock, CalendarX, CircleCheck, CircleX, Plane } from "lucide-react";
import { StatusChip, type Tone } from "@/components/status-chip";

export type DayStatus = "scheduled" | "leave" | "moved" | "closure" | "worked" | "no_show" | "today" | "cancelled";

export const DAY_STATUS: Record<DayStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  scheduled: { label: "Scheduled", tone: "neutral", icon: CalendarClock },
  today: { label: "Today", tone: "info", icon: CalendarCheck },
  worked: { label: "Worked", tone: "ok", icon: CircleCheck },
  leave: { label: "Leave", tone: "info", icon: Plane },
  moved: { label: "Moved", tone: "info", icon: ArrowRightLeft },
  closure: { label: "Office closed", tone: "neutral", icon: Ban },
  no_show: { label: "No-show", tone: "bad", icon: CircleX },
  cancelled: { label: "Cancelled", tone: "neutral", icon: CalendarX },
};

export function DayStatusBadge({ status }: { status: DayStatus }) {
  const day = DAY_STATUS[status];
  return <StatusChip tone={day.tone} label={day.label} icon={day.icon} />;
}

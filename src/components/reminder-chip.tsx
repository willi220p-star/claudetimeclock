import { BellOff, BellRing } from "lucide-react";
import { StatusChip } from "@/components/status-chip";
import type { loadReminderStatus } from "@/lib/data";

type Reminders = Awaited<ReturnType<typeof loadReminderStatus>>;

/** "Reminders on · iPhone" or "Reminders off" (D40). `reminders` is null while loading or if it can't load. */
export function ReminderChip({ reminders, personId }: { reminders: Reminders | null; personId: string }) {
  if (!reminders) return null;
  const phone = reminders.get(personId);
  return phone ? (
    <StatusChip tone="ok" icon={BellRing} label={`Reminders on · ${phone.device}`} />
  ) : (
    <StatusChip tone="warn" icon={BellOff} label="Reminders off" />
  );
}

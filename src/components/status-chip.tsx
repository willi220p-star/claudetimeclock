import type { LucideIcon } from "lucide-react";
import { Circle, CircleCheck, CircleX, Info, TrendingUp, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "ahead";

// Colour is never the only signal (§11.1): every chip has an icon and a label.
const TONES: Record<Tone, { className: string; icon: LucideIcon; iconClassName?: string }> = {
  ok: { className: "bg-ok-bg text-ok", icon: CircleCheck },
  warn: { className: "bg-warn-bg text-warn", icon: TriangleAlert },
  bad: { className: "bg-bad-bg text-bad", icon: CircleX },
  info: { className: "border border-border bg-card text-primary", icon: Info },
  neutral: { className: "bg-muted text-muted-foreground", icon: Circle },
  ahead: { className: "border border-border bg-card text-teal-ink", icon: TrendingUp, iconClassName: "text-teal" },
};

export function StatusChip({
  tone,
  label,
  icon,
  className,
}: {
  tone: Tone;
  label: string;
  icon?: LucideIcon;
  className?: string;
}) {
  const style = TONES[tone];
  const Icon = icon ?? style.icon;
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-[2.75px] px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        style.className,
        className,
      )}
    >
      <Icon aria-hidden className={cn("size-3.5 shrink-0", style.iconClassName)} />
      {label}
    </span>
  );
}

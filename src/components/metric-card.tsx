import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Tone } from "@/components/status-chip";
import { cn } from "@/lib/utils";

const SUB_TONE: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  info: "text-primary",
  neutral: "text-muted-foreground",
  ahead: "text-teal-ink",
};

/** Polyline points for a sparkline in a width × height box; a flat series sits in the middle. */
export function sparklinePoints(values: number[], width: number, height: number) {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const span = Math.max(...values) - min;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      const y = span === 0 ? height / 2 : height - ((value - min) / span) * height;
      return `${+(index * step).toFixed(2)},${+y.toFixed(2)}`;
    })
    .join(" ");
}

export function MetricCard({
  label,
  value,
  sub,
  tone = "neutral",
  sparkline,
  className,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  sparkline?: number[];
  className?: string;
  /** Makes the whole card a link to the list behind the number; its text is the accessible name. */
  href?: string;
}) {
  const body = (
    <>
      <h3 className="caption flex items-center justify-between gap-2 font-semibold text-muted-foreground">
        {label}
        {href ? <ChevronRight aria-hidden className="size-4 shrink-0" /> : null}
      </h3>
      <div className="flex items-end justify-between gap-3">
        <p className="font-heading text-[30px] leading-tight font-bold tracking-[-0.02em] tabular-nums">{value}</p>
        {sparkline && sparkline.length > 1 ? (
          <svg aria-hidden viewBox="0 0 80 24" className="h-6 w-20 shrink-0 overflow-visible text-teal">
            <polyline
              points={sparklinePoints(sparkline, 80, 24)}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </div>
      {sub ? <p className={cn("text-sm", SUB_TONE[tone])}>{sub}</p> : null}
    </>
  );
  const card = "flex flex-col gap-1 rounded-xl bg-card p-5 shadow-card";
  return href ? (
    <Link href={href} className={cn(card, "min-h-11 transition-colors hover:bg-muted", className)}>
      {body}
    </Link>
  ) : (
    <section className={cn(card, className)}>{body}</section>
  );
}

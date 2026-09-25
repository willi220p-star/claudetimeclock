import type { ReactNode } from "react";

/** Whole percent of the target reached, clamped to 0–100. A missing target reads as 0. */
export function ringPercent(counted: number, target: number) {
  if (!(target > 0)) return 0;
  return Math.round(Math.min(100, Math.max(0, (counted / target) * 100)));
}

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ProgressRing({
  counted,
  target,
  size = 160,
  label,
  children,
}: {
  counted: number;
  target: number;
  size?: number;
  /** Accessible description, e.g. "120h of 400h counted". */
  label?: string;
  children?: ReactNode;
}) {
  const percent = ringPercent(counted, target);
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg role="img" aria-label={label ?? `${percent}% of target`} viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={RADIUS} fill="none" strokeWidth="8" className="stroke-muted" />
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
          className="stroke-teal motion-safe:transition-[stroke-dashoffset] motion-safe:duration-200 motion-safe:ease-out"
        />
      </svg>
      {children ? <div className="absolute inset-0 grid place-items-center text-center">{children}</div> : null}
    </div>
  );
}

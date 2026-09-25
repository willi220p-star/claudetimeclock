import { ArrowRight } from "lucide-react";

export type Effect = { label?: string; before: string; after: string };

/** §11.1 "Show the effect before commit": e.g. "Owed 2h 30m → 0h". */
export function EffectPreview({ effects, title = "What changes" }: { effects: Effect[]; title?: string }) {
  return (
    <section aria-label={title} className="rounded-xl border border-border bg-card p-4">
      <h3 className="caption mb-2 font-semibold text-muted-foreground">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {effects.map((effect, index) => (
          <li key={index} className="flex flex-wrap items-center gap-x-2 text-sm">
            {effect.label ? <span className="font-semibold">{effect.label}</span> : null}
            <span>{effect.before}</span>
            <ArrowRight aria-hidden className="size-4 text-muted-foreground" />
            <span className="sr-only">becomes</span>
            <span className="font-semibold">{effect.after}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

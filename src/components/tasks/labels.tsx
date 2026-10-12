import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type TaskLabel = Database["public"]["Functions"]["labels"]["Returns"][number];

/** The 8 label colours (D49), each a theme token so dark mode follows. */
export const LABEL_COLOURS = {
  blue: { name: "Blue", dot: "bg-primary" },
  teal: { name: "Teal", dot: "bg-teal" },
  green: { name: "Green", dot: "bg-ok" },
  orange: { name: "Orange", dot: "bg-brand-orange" },
  red: { name: "Red", dot: "bg-bad" },
  purple: { name: "Purple", dot: "bg-lavender" },
  pink: { name: "Pink", dot: "bg-pink" },
  grey: { name: "Grey", dot: "bg-ash" },
} as const;
export type LabelColour = keyof typeof LABEL_COLOURS;
export const LABEL_COLOUR_KEYS = Object.keys(LABEL_COLOURS) as LabelColour[];
const dotOf = (colour: string | undefined) => LABEL_COLOURS[colour as LabelColour]?.dot ?? LABEL_COLOURS.grey.dot;

export async function loadLabels() {
  const { data, error } = await createClient().rpc("labels");
  if (error) throw error;
  return data ?? [];
}

/** A label as a small chip: a colour dot and the name (colour is never the only signal). */
export function LabelChip({ name, colour, className }: { name: string; colour?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground", className)}>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dotOf(colour))} />
      {name}
    </span>
  );
}

export function LabelDot({ colour, className }: { colour: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-3 shrink-0 rounded-full", dotOf(colour), className)} />;
}

import { cn } from "@/lib/utils";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

/**
 * A round profile picture: the person's latest clock-in selfie (a 60-second signed URL), or their
 * initials when there isn't one. Decorative next to the name, so the image has no alt text.
 */
export function Avatar({ url, name, size = 56, className }: { url: string | null; name: string; size?: number; className?: string }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-full bg-primary/10 font-semibold text-primary ring-2 ring-card",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed Supabase URL, static export
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

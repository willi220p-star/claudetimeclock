import Link from "next/link";
import { Bell } from "lucide-react";

export function bellLabel(count: number) {
  if (count <= 0) return "Notifications, none unread";
  return `Notifications, ${count} unread`;
}

export function bellBadge(count: number) {
  return count > 99 ? "99+" : String(count);
}

/** The header bell. Without `href` (no notifications page yet) it is a status icon, not a control. */
export function NotificationBell({ count, href }: { count: number; href?: string }) {
  const body = (
    <>
      <Bell aria-hidden className="size-5" />
      {count > 0 ? (
        <span
          aria-hidden
          className="absolute top-1 right-0.5 min-w-5 rounded-[1584px] bg-bad px-1 text-center text-[11px] leading-5 font-semibold text-primary-foreground tabular-nums"
        >
          {bellBadge(count)}
        </span>
      ) : null}
    </>
  );
  const className = "relative grid size-11 place-items-center rounded-[1584px] text-muted-foreground";
  if (href) {
    return (
      <Link href={href} aria-label={bellLabel(count)} className={`${className} hover:bg-muted`}>
        {body}
      </Link>
    );
  }
  return (
    <span role="img" aria-label={bellLabel(count)} className={className}>
      {body}
    </span>
  );
}

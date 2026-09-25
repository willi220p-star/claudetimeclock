import Link from "next/link";
import type { Profile } from "@/lib/daymark";
import { ROLE_HOME, ROLE_LABEL, rolesOf, type Role } from "@/lib/roles";
import { cn } from "@/lib/utils";

/** Links to each desk the person holds. Hidden when they hold only one. */
export function RoleSwitcher({ profile, current }: { profile: Profile; current: Role }) {
  const roles = rolesOf(profile);
  if (roles.length < 2) return null;
  return (
    <nav aria-label="Switch desk">
      <ul className="flex items-center gap-1">
        {roles.map((role) => (
          <li key={role}>
            <Link
              href={ROLE_HOME[role]}
              aria-current={role === current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold",
                role === current ? "bg-muted text-foreground" : "text-primary hover:bg-muted",
              )}
            >
              {ROLE_LABEL[role]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

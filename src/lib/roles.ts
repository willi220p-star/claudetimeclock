import type { Profile } from "@/lib/daymark";

export type Role = "intern" | "supervisor" | "admin";

type Flags = Pick<Profile, "is_intern" | "is_supervisor" | "is_admin">;

export const ROLE_HOME: Record<Role, string> = {
  admin: "/admin",
  supervisor: "/supervisor",
  intern: "/clock",
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  intern: "Intern",
};

/** The roles a person holds, highest first. */
export function rolesOf(profile: Flags): Role[] {
  const roles: Role[] = [];
  if (profile.is_admin) roles.push("admin");
  if (profile.is_supervisor) roles.push("supervisor");
  if (profile.is_intern) roles.push("intern");
  return roles;
}

/** Where a signed-in person lands: the password change first, then their highest role's home. */
export function homeFor(profile: Flags & Pick<Profile, "must_change_password">): string | null {
  if (profile.must_change_password) return "/set-password";
  const [top] = rolesOf(profile);
  return top ? ROLE_HOME[top] : null;
}

/**
 * Where a desk for `role` sends this visitor instead, or null when they may stay.
 * "none" means they are signed in but hold no role at all.
 */
export function deskRedirect(profile: Profile | null, role: Role): string | "none" | null {
  if (!profile) return "/";
  if (profile.must_change_password) return "/set-password";
  if (rolesOf(profile).includes(role)) return null;
  return homeFor(profile) ?? "none";
}

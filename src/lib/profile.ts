import { redirect } from "next/navigation";
import type { Profile, Role } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/server";

export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from("daymark_profiles")
    .select("id, login_id, display_name, role, active, created_at")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return null;
  if (profile.role !== "admin" && profile.role !== "staff") return null;
  return profile as Profile;
}

export async function requireRole(role: Role) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== role) {
    redirect(profile.role === "admin" ? "/admin" : "/clock");
  }
  return profile;
}

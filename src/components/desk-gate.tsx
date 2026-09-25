"use client";

import { use, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Profile, Role } from "@/lib/daymark";
import { sessionProfile } from "@/lib/browser-session";

export function Opening({ label }: { label: string }) {
  return (
    <main className="grid min-h-svh place-items-center px-6">
      <p className="font-heading text-2xl tracking-tight">{label}</p>
    </main>
  );
}

export function DeskGate({
  role,
  children,
}: {
  role: Role;
  children: (profile: Profile) => ReactNode;
}) {
  const router = useRouter();
  const profile = use(sessionProfile());

  useEffect(() => {
    if (!profile) router.replace("/login");
    else if (profile.role !== role) {
      router.replace(profile.role === "admin" ? "/admin" : "/clock");
    }
  }, [profile, role, router]);

  if (!profile || profile.role !== role) {
    return <Opening label={profile ? "Opening the right desk…" : "Sending you to sign in…"} />;
  }

  return children(profile);
}

export function HomeGate() {
  const router = useRouter();
  const profile = use(sessionProfile());

  useEffect(() => {
    if (!profile) router.replace("/login");
    else router.replace(profile.role === "admin" ? "/admin" : "/clock");
  }, [profile, router]);

  return <Opening label="Opening your desk…" />;
}

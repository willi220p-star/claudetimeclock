"use client";

import { use, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { SignOutButton } from "@/components/sign-out-button";
import { Skeleton } from "@/components/ui/skeleton";
import { sessionConsent, sessionProfile } from "@/lib/browser-session";
import { needsConsentScreen } from "@/lib/consent";
import type { Profile } from "@/lib/daymark";
import { deskRedirect, type Role } from "@/lib/roles";

/** Skeleton of a desk page while the session loads (§11.1: skeletons, not spinners). */
export function Opening({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="h-14 border-b border-border bg-card" />
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-6">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
  );
}

const noop = () => () => {};

/** False while prerendering and hydrating, so the static HTML never depends on a session. */
export function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}

/**
 * Shows `children` only to a signed-in person holding `role`. A person may hold several roles
 * and use each desk. Intern desks also wait for the collection notice and consent choices.
 * RLS enforces access; this only routes people to the right screen.
 */
export function DeskGate({
  role,
  consent = role === "intern",
  children,
}: {
  role: Role;
  consent?: boolean;
  children: (profile: Profile) => ReactNode;
}) {
  if (!useHydrated()) return <Opening label="Opening your desk…" />;
  return (
    <SessionGate role={role} consent={consent}>
      {children}
    </SessionGate>
  );
}

function SessionGate({
  role,
  consent,
  children,
}: {
  role: Role;
  consent: boolean;
  children: (profile: Profile) => ReactNode;
}) {
  const router = useRouter();
  const profile = use(sessionProfile());
  const target = deskRedirect(profile, role);

  useEffect(() => {
    if (target && target !== "none") router.replace(target);
  }, [target, router]);

  if (target === "none") {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-16">
        <EmptyState action={<SignOutButton />}>
          Your login doesn&apos;t have a role yet. Ask the DGK admin to set one up, then sign in again.
        </EmptyState>
      </main>
    );
  }
  if (target || !profile) return <Opening label={profile ? "Opening the right desk…" : "Sending you to sign in…"} />;
  if (consent) return <ConsentGate>{children(profile)}</ConsentGate>;
  return children(profile);
}

function ConsentGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const needed = needsConsentScreen(use(sessionConsent()));

  useEffect(() => {
    if (needed) router.replace("/consent");
  }, [needed, router]);

  return needed ? <Opening label="Opening the collection notice…" /> : children;
}

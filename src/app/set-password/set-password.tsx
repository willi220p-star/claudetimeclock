"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth-shell";
import { Opening, useHydrated } from "@/components/desk-gate";
import { NewPasswordForm } from "@/components/new-password-form";
import { clearSessionCache, sessionProfile } from "@/lib/browser-session";
import { homeFor } from "@/lib/roles";

/** First sign-in with a temporary password (must_change_password), or a voluntary change. */
export function SetPassword() {
  if (!useHydrated()) return <Opening label="Opening…" />;
  return <SetPasswordForm />;
}

function SetPasswordForm() {
  const router = useRouter();
  const profile = use(sessionProfile());

  useEffect(() => {
    if (!profile) router.replace("/");
  }, [profile, router]);

  if (!profile) return <Opening label="Sending you to sign in…" />;

  const home = homeFor({ ...profile, must_change_password: false });
  return (
    <AuthShell
      title={profile.must_change_password ? "Choose your own password" : "Change your password"}
      intro={
        profile.must_change_password
          ? "You signed in with a temporary password. Choose your own to keep going."
          : "Choose a new password for DGK Clock."
      }
    >
      <NewPasswordForm
        onDone={async () => {
          clearSessionCache();
          const fresh = await sessionProfile().catch(() => null);
          toast.success("Password saved.");
          router.replace((fresh && homeFor(fresh)) || home || "/");
        }}
      />
      {!profile.must_change_password && home ? (
        <Link href={home} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-primary">
          Keep my current password
        </Link>
      ) : null}
    </AuthShell>
  );
}

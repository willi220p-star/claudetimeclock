"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rememberProfile } from "@/lib/browser-session";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        setReady(true);
        setChecking(false);
      }
    });
    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (sessionData.session) setReady(true);
      setChecking(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use a password of at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Type the new password the same way in both fields.");
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();
      const { data, error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError || !data.user) throw updateError ?? new Error("Could not update the password.");
      const { error: saveError } = await supabase.rpc("save_own_password", { password });
      if (saveError) throw saveError;

      const { data: profile } = await supabase
        .from("daymark_profiles")
        .select("id, login_id, display_name, role, active, created_at")
        .eq("id", data.user.id)
        .maybeSingle();

      if (!profile || (profile.role !== "admin" && profile.role !== "staff") || !profile.active) {
        setError("Password updated. Sign in with your login ID and the new password.");
        return;
      }

      rememberProfile(profile);
      router.push(profile.role === "admin" ? "/admin" : "/clock");
    } catch (caught) {
      setError(errorText(caught, "Could not update the password."));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-svh place-items-center px-5 py-12">
      <div className="w-full max-w-sm">
        <p className="text-xs font-medium tracking-[0.22em] text-muted-foreground uppercase">DGK Clock</p>
        <h1 className="mt-3 font-heading text-3xl tracking-tight">Choose a new password</h1>
        {checking ? <p className="mt-6 text-sm text-muted-foreground">Opening the reset link…</p> : null}
        {!checking && !ready ? (
          <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
            Open the reset link from your email on this device. Then you can choose a new password and sign in.
          </p>
        ) : null}
        {ready ? (
          <form method="post" action="." onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-11 rounded-xl bg-card px-3"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                className="h-11 rounded-xl bg-card px-3"
              />
            </div>
            {error ? (
              <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="h-11 rounded-xl text-base" disabled={pending}>
              {pending ? "Updating…" : "Update password"}
            </Button>
          </form>
        ) : null}
      </div>
    </main>
  );
}

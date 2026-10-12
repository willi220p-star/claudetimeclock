"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadSites } from "@/lib/data";
import { errorText } from "@/lib/daymark";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/use-load";

/**
 * Admin → People (D42): a sign-in for an office tablet. Sign the tablet in with it once; it opens the kiosk
 * and nothing else.
 */
export function AddKioskForm({ onAdded }: { onAdded: () => void }) {
  const [sites] = useLoad(loadSites);
  const [name, setName] = useState("Front desk tablet");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [site, setSite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const siteList = sites.status === "ready" ? sites.data.filter((s) => s.active) : [];
  const chosen = site || siteList[0]?.id || "";

  async function add() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("create_kiosk", { display_name: name, email, password, site: chosen });
    setBusy(false);
    if (error) {
      setError(errorText(error, "The kiosk wasn't added. Try again."));
      return;
    }
    toast.success("Kiosk added. Sign the office tablet in with that email and password.");
    setEmail("");
    setPassword("");
    onAdded();
  }

  return (
    <details className="rounded-xl bg-card p-4 shadow-card">
      <summary className="min-h-11 cursor-pointer font-semibold">Add a kiosk (office tablet)</summary>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="kiosk-name">Tablet name</Label>
          <Input id="kiosk-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="kiosk-email">Sign-in email for the tablet</Label>
          <Input id="kiosk-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="kiosk-password">Tablet password (12 or more characters)</Label>
          <Input
            id="kiosk-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {siteList.length > 1 ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="kiosk-site">Tablet office</Label>
            <select
              id="kiosk-site"
              className="h-12 w-full rounded-md border border-input bg-card px-3"
              value={chosen}
              onChange={(e) => setSite(e.target.value)}
            >
              {siteList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {error ? <FormMessage>{error}</FormMessage> : null}
        <Button type="submit" className="w-fit" disabled={busy || !email || !password || !chosen}>
          {busy ? "Adding…" : "Add kiosk"}
        </Button>
      </form>
    </details>
  );
}

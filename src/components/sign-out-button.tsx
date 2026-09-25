"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, MonitorSmartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { clearSessionCache } from "@/lib/browser-session";
import { createClient } from "@/lib/supabase/client";

export const SIGN_OUT_EVERYWHERE_CONFIRM = "This signs you out on every phone and computer.";

/** Signs out this device only; `everywhere` ends every session of this login, after a confirm. */
export function SignOutButton({ compact = false, everywhere = false }: { compact?: boolean; everywhere?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const label = everywhere ? "Sign out all devices" : "Sign out";
  const Icon = everywhere ? MonitorSmartphone : LogOut;

  return (
    <Button
      type="button"
      variant={everywhere ? "secondary" : "ghost"}
      size={compact ? "icon" : "sm"}
      className={compact ? "sm:w-auto sm:px-4" : undefined}
      disabled={pending}
      aria-label={compact ? label : undefined}
      onClick={async () => {
        if (everywhere && !window.confirm(SIGN_OUT_EVERYWHERE_CONFIRM)) return;
        setPending(true);
        const { error } = await createClient().auth.signOut({ scope: everywhere ? "global" : "local" });
        // A failed global sign-out still ends this device's session; say the others may not be.
        if (error && everywhere) toast.error("Other devices may still be signed in. Try again once you're back online.");
        clearSessionCache();
        router.replace("/");
      }}
    >
      <Icon aria-hidden />
      <span className={compact ? "hidden sm:inline" : undefined}>{label}</span>
    </Button>
  );
}

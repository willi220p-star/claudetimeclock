"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearSessionCache } from "@/lib/browser-session";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? "icon" : "sm"}
      className={compact ? "sm:w-auto sm:px-4" : undefined}
      disabled={pending}
      aria-label={compact ? "Sign out" : undefined}
      onClick={async () => {
        setPending(true);
        await createClient().auth.signOut();
        clearSessionCache();
        router.replace("/");
      }}
    >
      <LogOut aria-hidden />
      <span className={compact ? "hidden sm:inline" : undefined}>Sign out</span>
    </Button>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { clearSessionCache } from "@/lib/browser-session";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      className="h-10 bg-card"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const supabase = createClient();
        clearSessionCache();
        await supabase.auth.signOut();
        router.push("/login");
      }}
    >
      {children}
    </Button>
  );
}

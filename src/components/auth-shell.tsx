import type { ReactNode } from "react";
import { DgkLogo } from "@/components/dgk-logo";

/** The signed-out pages: sign in, reset password, set password. */
export function AuthShell({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <main className="grid min-h-svh place-items-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-3">
          <DgkLogo size={48} />
          <p className="font-semibold">DGK Clock</p>
        </div>
        <div className="flex flex-col gap-2">
          <h1>{title}</h1>
          {intro ? <p className="text-muted-foreground">{intro}</p> : null}
        </div>
        <div className="rounded-xl bg-card p-6 shadow-card">{children}</div>
      </div>
    </main>
  );
}

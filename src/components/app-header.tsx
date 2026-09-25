import { LogOut } from "lucide-react";
import type { Profile } from "@/lib/daymark";
import { SignOutButton } from "@/components/sign-out-button";

export function AppHeader({
  profile,
  eyebrow,
}: {
  profile: Profile;
  eyebrow: string;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-primary font-heading text-sm tracking-tight text-primary-foreground">
            DG
          </div>
          <div>
            <p className="font-heading text-lg leading-none tracking-tight">DGK Clock</p>
            <p className="mt-1 text-xs text-muted-foreground">{eyebrow}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium">{profile.display_name}</p>
            <p className="text-xs text-muted-foreground">{profile.login_id}</p>
          </div>
          <SignOutButton>
            <LogOut />
            Sign out
          </SignOutButton>
        </div>
      </div>
    </header>
  );
}

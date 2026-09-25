"use client";

import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { DeskGate } from "@/components/desk-gate";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { ROLE_HOME, ROLE_LABEL, rolesOf } from "@/lib/roles";

// ponytail: placeholder until Phase 6 builds the supervisor desk.
export function SupervisorScreen() {
  return (
    <DeskGate role="supervisor">
      {(profile) => {
        const other = rolesOf(profile).find((role) => role !== "supervisor");
        return (
          <>
            <AppHeader profile={profile} role="supervisor" title="Supervisor" />
            <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-6">
              <PageHeader title="Supervisor" />
              <EmptyState
                action={
                  other ? (
                    <Link href={ROLE_HOME[other]} className={buttonVariants({ variant: "secondary" })}>
                      Open the {ROLE_LABEL[other].toLowerCase()} desk
                    </Link>
                  ) : undefined
                }
              >
                Supervisor tools arrive in a later update.
              </EmptyState>
            </main>
          </>
        );
      }}
    </DeskGate>
  );
}

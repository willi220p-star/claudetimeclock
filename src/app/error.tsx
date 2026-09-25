"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center gap-3 px-4">
      <h1>That page didn&apos;t load</h1>
      <p className="text-muted-foreground">
        DGK Clock couldn&apos;t reach the server. Check your connection, then try again.
      </p>
      <Button type="button" className="mt-3 w-fit" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}

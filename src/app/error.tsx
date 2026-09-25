"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center px-6">
      <h1 className="font-heading text-4xl tracking-tight">That page did not load</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        The request failed before DGK Clock could show the desk. Try it once more.
      </p>
      <Button type="button" className="mt-6 h-11 w-fit rounded-xl" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}

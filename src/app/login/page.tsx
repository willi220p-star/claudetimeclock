import type { Metadata } from "next";
import { LoginForm } from "@/app/login/login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <main className="grid min-h-svh lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(520px 240px at 12% 8%, oklch(0.72 0.12 75 / 0.35), transparent 60%), radial-gradient(480px 280px at 90% 100%, oklch(0.45 0.08 255 / 0.55), transparent 55%)",
          }}
        />
        <p className="relative text-sm font-medium tracking-[0.22em] uppercase">DGK Clock</p>
        <div className="relative max-w-lg">
          <h1 className="font-heading text-6xl leading-[0.95] tracking-tight">
            On site.
            <br />
            On the clock.
          </h1>
          <p className="mt-6 max-w-sm text-base leading-relaxed text-primary-foreground/75">
            Shift and break punches for the Regus office on the first floor, 1 Palmerston Circuit, Palmerston.
          </p>
        </div>
        <p className="relative text-sm text-primary-foreground/60">Palmerston · Darwin</p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <p className="text-xs font-medium tracking-[0.22em] text-muted-foreground uppercase">DGK Clock</p>
            <p className="mt-3 font-heading text-4xl tracking-tight">On site. On the clock.</p>
          </div>
          <h2 className="font-heading text-3xl tracking-tight">Sign in</h2>
          <div className="mt-8">
            <LoginForm />
          </div>
        </div>
      </section>
    </main>
  );
}

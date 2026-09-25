import type { Metadata } from "next";
import { LoginForm } from "@/app/login/login-form";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = {
  title: "Sign in",
};

/** Sign in by email. Served at both `/` and `/login`. */
export default function LoginPage() {
  return (
    <AuthShell title="Sign in" intro="Use the email and password the DGK admin set up for you.">
      <LoginForm />
    </AuthShell>
  );
}

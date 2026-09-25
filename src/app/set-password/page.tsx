import type { Metadata } from "next";
import { Suspense } from "react";
import { SetPassword } from "@/app/set-password/set-password";
import { Opening } from "@/components/desk-gate";

export const metadata: Metadata = {
  title: "Choose a password",
};

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<Opening label="Opening…" />}>
      <SetPassword />
    </Suspense>
  );
}

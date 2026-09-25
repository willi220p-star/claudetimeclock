import type { Metadata } from "next";
import { ResetPassword } from "@/app/reset-password/reset-password";

export const metadata: Metadata = {
  title: "Reset password",
};

export default function ResetPasswordPage() {
  return <ResetPassword />;
}

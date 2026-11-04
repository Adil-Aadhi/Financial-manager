import { Metadata } from "next";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Reset Password | FinanceTracker",
  description: "Reset your FinanceTracker password securely with a one-time email code.",
};

export default function ForgotPasswordPage() {
  // The form renders its own per-step heading and progress, so no layout title.
  return (
    <AuthLayout>
      <ForgotPasswordForm />
    </AuthLayout>
  );
}

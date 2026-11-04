import { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { LoginForm } from "@/components/auth/LoginForm";

export const instant = false;

export const metadata: Metadata = {
  title: "Sign In | FinanceTracker",
  description: "Sign in to your Finance Tracker account to monitor your cash flow and financial goals.",
};

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/home");
  }

  return (
    <AuthLayout
      title="Welcome back"
      alternateLink={{
        text: "No account?",
        label: "Sign up",
        href: "/register",
      }}
    >
      <LoginForm />
    </AuthLayout>
  );
}

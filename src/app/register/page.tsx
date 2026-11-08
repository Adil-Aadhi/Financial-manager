import { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { RegisterForm } from "@/components/auth/RegisterForm";

export const instant = false;

export const metadata: Metadata = {
  title: "Sign Up | AccountTracker",
  description: "Create your AccountTracker account.",
};

export default async function RegisterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/home");
  }

  return (
    <AuthLayout
      alternateLink={{
        text: "Have an account?",
        label: "Sign in",
        href: "/login",
      }}
    >
      <RegisterForm />
    </AuthLayout>
  );
}

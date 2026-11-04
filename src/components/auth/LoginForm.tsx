"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const validate = () => {
    const next: { email?: string; password?: string } = {};
    if (!email) next.email = "Email address is required";
    else if (!EMAIL_RE.test(email.trim())) next.email = "Please enter a valid email address";
    if (!password) next.password = "Password is required";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!validate()) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("invalid login credentials")) {
          setErrorMessage("Incorrect email or password.");
        } else if (msg.includes("email not confirmed")) {
          setErrorMessage("Email not verified yet.");
        } else {
          setErrorMessage(error.message);
        }
        return;
      }

      if (data?.user) {
        setSuccessMessage("Redirecting…");
        router.push("/home");
        router.refresh();
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "Something went wrong while signing in. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {errorMessage && (
        <Alert variant="error" onClose={() => setErrorMessage(null)}>
          {errorMessage}
        </Alert>
      )}

      {successMessage && (
        <Alert variant="success">
          {successMessage}
        </Alert>
      )}

      <Input
        label="Email"
        id="login-email"
        type="email"
        name="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
        }}
        error={errors.email}
        leftIcon={<Mail className="h-4 w-4" />}
        disabled={isLoading}
        autoFocus
      />

      <PasswordInput
        label="Password"
        id="login-password"
        name="password"
        autoComplete="current-password"
        placeholder="••••••••"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
        }}
        error={errors.password}
        disabled={isLoading}
        labelAction={
          <Link
            href="/forgot-password"
            className="text-xs font-semibold text-accent underline-offset-4 transition-colors hover:text-accent-strong hover:underline"
          >
            Forgot password?
          </Link>
        }
      />

      <Button
        type="submit"
        size="lg"
        className="w-full"
        isLoading={isLoading}
        rightIcon={<ArrowRight className="h-4 w-4" />}
      >
        {isLoading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

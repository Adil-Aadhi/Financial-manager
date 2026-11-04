"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Mail, MailCheck, RotateCcw, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PasswordStrength } from "@/components/ui/PasswordStrength";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { OtpInput } from "@/components/ui/OtpInput";
import { AuthStepHeader } from "./AuthStepHeader";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = {
  fullName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
};

export function RegisterForm() {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState<"form" | "otp">("form");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [otp, setOtp] = useState("");
  const [cooldown, setCooldown] = useState(60);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpInfo, setOtpInfo] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  // 60-second cooldown for resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((p) => Math.max(p - 1, 0)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const clearError = (field: keyof FieldErrors) => {
    if (errors[field]) setErrors((p) => ({ ...p, [field]: undefined }));
  };

  const validateForm = () => {
    const next: FieldErrors = {};
    if (!fullName.trim()) next.fullName = "Name is required";
    if (!email) next.email = "Email is required";
    else if (!EMAIL_RE.test(email.trim())) next.email = "Enter a valid email";
    if (!password) next.password = "Password is required";
    else if (password.length < 8) next.password = "At least 8 characters";
    if (!confirmPassword) next.confirmPassword = "Confirm your password";
    else if (password !== confirmPassword) next.confirmPassword = "Passwords do not match";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  // Step 1: sign up
  const handleRegisterSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!validateForm()) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: fullName.trim() } },
      });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      // Supabase returns no identities when the email is already registered
      if (data?.user && data.user.identities && data.user.identities.length === 0) {
        setErrorMessage("This email is already registered. Sign in instead.");
        return;
      }

      // Email confirmation disabled: session exists immediately
      if (data?.session) {
        setSuccessMessage("Account created. Redirecting…");
        router.push("/home");
        router.refresh();
        return;
      }

      setStep("otp");
      setCooldown(60);
      setOtp("");
      setOtpError(null);
      setOtpInfo(null);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: verify email code
  const handleVerifyOtp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setOtpError(null);
    setOtpInfo(null);
    if (otp.length < 6) {
      setOtpError("Enter all 6 digits.");
      return;
    }

    setIsVerifying(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otp,
        type: "signup",
      });

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("expired")) setOtpError("Code expired. Request a new one.");
        else if (msg.includes("invalid") || msg.includes("token")) setOtpError("Invalid code.");
        else setOtpError(error.message);
        return;
      }

      if (data?.session || data?.user) {
        setSuccessMessage("Verified. Redirecting…");
        router.push("/home");
        router.refresh();
      }
    } catch (err: unknown) {
      setOtpError(err instanceof Error ? err.message : "Verification failed. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResendOtp = async () => {
    if (cooldown > 0 || isResending) return;
    setIsResending(true);
    setOtpError(null);
    setOtpInfo(null);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: email.trim() });
      if (error) setOtpError(error.message);
      else {
        setCooldown(60);
        setOtpInfo("New code sent.");
      }
    } catch (err: unknown) {
      setOtpError(err instanceof Error ? err.message : "Could not resend the code.");
    } finally {
      setIsResending(false);
    }
  };

  const passwordsMatch =
    password.length >= 8 && confirmPassword.length > 0 && password === confirmPassword;

  // ------------------------------------------------------------------ OTP
  if (step === "otp") {
    return (
      <div className="animate-rise">
        <AuthStepHeader
          icon={<MailCheck className="h-5 w-5" />}
          title="Verify your email"
          description={
            <>
              Code sent to <span className="font-semibold text-fg">{email.trim()}</span>
            </>
          }
        />

        <div className="space-y-3">
          {otpError && (
            <Alert variant="error" onClose={() => setOtpError(null)}>
              {otpError}
            </Alert>
          )}
          {otpInfo && (
            <Alert variant="success" onClose={() => setOtpInfo(null)}>
              {otpInfo}
            </Alert>
          )}
          {successMessage && <Alert variant="success">{successMessage}</Alert>}
        </div>

        <form onSubmit={handleVerifyOtp} className="mt-5 space-y-6">
          <OtpInput
            value={otp}
            onChange={(val) => {
              setOtp(val);
              if (otpError) setOtpError(null);
            }}
            disabled={isVerifying}
            hasError={Boolean(otpError)}
            autoFocus
          />

          <Button
            type="submit"
            size="lg"
            className="w-full"
            isLoading={isVerifying}
            disabled={otp.length < 6}
            rightIcon={<ArrowRight className="h-4 w-4" />}
          >
            {isVerifying ? "Verifying…" : "Verify"}
          </Button>

          <div className="flex items-center justify-between text-xs">
            {cooldown > 0 ? (
              <span className="text-fg-subtle">
                Resend in <span className="font-mono font-semibold text-fg">{cooldown}s</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={isResending}
                className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-accent transition-colors hover:text-accent-strong disabled:opacity-50"
              >
                <RotateCcw className={isResending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                {isResending ? "Sending…" : "Resend code"}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setStep("form");
                setOtp("");
                setOtpError(null);
                setOtpInfo(null);
              }}
              className="cursor-pointer font-medium text-fg-muted transition-colors hover:text-fg"
            >
              Change email
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ----------------------------------------------------------------- form
  return (
    <div className="animate-rise">
      <h1 className="mb-6 text-[26px] font-semibold leading-tight tracking-tight text-fg">
        Create account
      </h1>

      <form onSubmit={handleRegisterSubmit} noValidate className="space-y-5">
        {errorMessage && (
          <Alert variant="error" onClose={() => setErrorMessage(null)}>
            {errorMessage}
          </Alert>
        )}
        {successMessage && <Alert variant="success">{successMessage}</Alert>}

        <Input
          label="Name"
          id="register-fullname"
          name="fullName"
          autoComplete="name"
          placeholder="Your name"
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value);
            clearError("fullName");
          }}
          error={errors.fullName}
          leftIcon={<User className="h-4 w-4" />}
          disabled={isLoading}
          autoFocus
        />

        <Input
          label="Email"
          id="register-email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearError("email");
          }}
          error={errors.email}
          leftIcon={<Mail className="h-4 w-4" />}
          disabled={isLoading}
        />

        <div className="space-y-2.5">
          <PasswordInput
            label="Password"
            id="register-password"
            name="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError("password");
            }}
            error={errors.password}
            disabled={isLoading}
          />
          <PasswordStrength password={password} />
        </div>

        <div className="space-y-1.5">
          <PasswordInput
            label="Confirm password"
            id="register-confirm-password"
            name="confirmPassword"
            autoComplete="new-password"
            placeholder="Re-enter password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              clearError("confirmPassword");
            }}
            error={errors.confirmPassword}
            disabled={isLoading}
          />
          {passwordsMatch && (
            <p className="flex animate-fade items-center gap-1.5 text-xs font-medium text-accent">
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
              Passwords match
            </p>
          )}
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          isLoading={isLoading}
          rightIcon={<ArrowRight className="h-4 w-4" />}
        >
          {isLoading ? "Creating…" : "Create account"}
        </Button>
      </form>
    </div>
  );
}

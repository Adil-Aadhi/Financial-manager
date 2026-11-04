"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  KeyRound,
  Mail,
  MailCheck,
  PartyPopper,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PasswordStrength } from "@/components/ui/PasswordStrength";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { OtpInput } from "@/components/ui/OtpInput";
import { AuthStepHeader, StepIndicator } from "./AuthStepHeader";

type Step = "email" | "otp" | "new-password" | "success";
const STEPS = ["Email", "Verify", "New password"];
const STEP_INDEX: Record<Step, number> = { email: 0, otp: 1, "new-password": 2, success: 3 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function BackToSignIn() {
  return (
    <div className="mt-7 border-t border-line pt-6 text-center">
      <Link
        href="/login"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to sign in
      </Link>
    </div>
  );
}

export function ForgotPasswordForm() {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [cooldown, setCooldown] = useState(60);

  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<{
    email?: string;
    newPassword?: string;
    confirmNewPassword?: string;
  }>({});

  // 60-second countdown for OTP resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((p) => Math.max(p - 1, 0)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const clearMessages = () => {
    setErrorMessage(null);
    setInfoMessage(null);
  };

  const validateEmail = () => {
    let msg: string | undefined;
    if (!email) msg = "Email address is required";
    else if (!EMAIL_RE.test(email.trim())) msg = "Please enter a valid email address";
    setErrors((p) => ({ ...p, email: msg }));
    return !msg;
  };

  const validatePasswords = () => {
    const next: { newPassword?: string; confirmNewPassword?: string } = {};
    if (!newPassword) next.newPassword = "New password is required";
    else if (newPassword.length < 8) next.newPassword = "Password must be at least 8 characters";
    if (!confirmNewPassword) next.confirmNewPassword = "Confirm your new password";
    else if (newPassword !== confirmNewPassword) next.confirmNewPassword = "Passwords do not match";
    setErrors((p) => ({ ...p, ...next }));
    return Object.keys(next).length === 0;
  };

  // STEP 1: request recovery code
  const handleRequestOtp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearMessages();
    if (!validateEmail()) return;

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      setStep("otp");
      setCooldown(60);
      setOtp("");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to send reset code. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // STEP 2: verify recovery code
  const handleVerifyOtp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearMessages();
    if (otp.length < 6) {
      setErrorMessage("Enter all 6 digits.");
      return;
    }

    setIsVerifying(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otp,
        type: "recovery",
      });

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("expired")) {
          setErrorMessage("Code expired. Request a new one.");
        } else if (msg.includes("invalid") || msg.includes("token")) {
          setErrorMessage("Invalid code.");
        } else {
          setErrorMessage(error.message);
        }
        return;
      }
      setStep("new-password");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Verification failed. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResendOtp = async () => {
    if (cooldown > 0 || isResending) return;
    setIsResending(true);
    clearMessages();
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) setErrorMessage(error.message);
      else {
        setCooldown(60);
        setInfoMessage("New code sent.");
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Could not resend the code. Please try again.");
    } finally {
      setIsResending(false);
    }
  };

  // STEP 3: set new password
  const handleUpdatePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearMessages();
    if (!validatePasswords()) return;

    setIsUpdating(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      setStep("success");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to update password. Please try again.");
    } finally {
      setIsUpdating(false);
    }
  };

  const passwordsMatch =
    newPassword.length >= 8 && confirmNewPassword.length > 0 && newPassword === confirmNewPassword;

  // ---------------------------------------------------------------- success
  if (step === "success") {
    return (
      <div className="animate-rise py-2 text-center">
        <span className="relative mx-auto mb-6 flex h-16 w-16 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-accent/20 [animation-iteration-count:2]" />
          <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-brand text-accent-fg shadow-glow">
            <PartyPopper className="h-7 w-7" />
          </span>
        </span>
        <h2 className="text-[26px] font-semibold tracking-tight text-fg">Password updated</h2>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-fg-muted">
          Sign in with your new password.
        </p>
        <Button
          type="button"
          size="lg"
          className="mt-8 w-full"
          onClick={() => {
            router.push("/login");
            router.refresh();
          }}
          rightIcon={<ArrowRight className="h-4 w-4" />}
        >
          Sign in
        </Button>
      </div>
    );
  }

  return (
    <div key={step} className="animate-rise">
      <StepIndicator steps={STEPS} current={STEP_INDEX[step]} />

      {/* ------------------------------------------------------- new password */}
      {step === "new-password" && (
        <>
          <AuthStepHeader
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Create a new password"
            description="At least 8 characters."
          />

          {errorMessage && (
            <Alert variant="error" className="mb-5" onClose={() => setErrorMessage(null)}>
              {errorMessage}
            </Alert>
          )}

          <form onSubmit={handleUpdatePassword} noValidate className="space-y-5">
            <div className="space-y-2.5">
              <PasswordInput
                label="New password"
                id="recovery-new-password"
                name="newPassword"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (errors.newPassword) setErrors((p) => ({ ...p, newPassword: undefined }));
                }}
                error={errors.newPassword}
                disabled={isUpdating}
                autoFocus
              />
              <PasswordStrength password={newPassword} />
            </div>

            <div className="space-y-1.5">
              <PasswordInput
                label="Confirm new password"
                id="recovery-confirm-password"
                name="confirmNewPassword"
                autoComplete="new-password"
                placeholder="Re-enter password"
                value={confirmNewPassword}
                onChange={(e) => {
                  setConfirmNewPassword(e.target.value);
                  if (errors.confirmNewPassword)
                    setErrors((p) => ({ ...p, confirmNewPassword: undefined }));
                }}
                error={errors.confirmNewPassword}
                disabled={isUpdating}
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
              isLoading={isUpdating}
              rightIcon={<ArrowRight className="h-4 w-4" />}
            >
              {isUpdating ? "Updating…" : "Update password"}
            </Button>
          </form>
        </>
      )}

      {/* ---------------------------------------------------------------- otp */}
      {step === "otp" && (
        <>
          <AuthStepHeader
            icon={<MailCheck className="h-5 w-5" />}
            title="Enter code"
            description={
              <>
                Code sent to <span className="font-semibold text-fg">{email.trim()}</span>
              </>
            }
          />

          {errorMessage && (
            <Alert variant="error" className="mb-5" onClose={() => setErrorMessage(null)}>
              {errorMessage}
            </Alert>
          )}
          {infoMessage && (
            <Alert variant="success" className="mb-5" onClose={() => setInfoMessage(null)}>
              {infoMessage}
            </Alert>
          )}

          <form onSubmit={handleVerifyOtp} className="space-y-6">
            <OtpInput
              value={otp}
              onChange={(val) => {
                setOtp(val);
                if (errorMessage) setErrorMessage(null);
              }}
              disabled={isVerifying}
              hasError={Boolean(errorMessage)}
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
                  setStep("email");
                  setOtp("");
                  clearMessages();
                }}
                className="cursor-pointer font-medium text-fg-muted transition-colors hover:text-fg"
              >
                Change email
              </button>
            </div>
          </form>
        </>
      )}

      {/* -------------------------------------------------------------- email */}
      {step === "email" && (
        <>
          <AuthStepHeader
            icon={<KeyRound className="h-5 w-5" />}
            title="Reset password"
            description="We'll email you a 6-digit code."
          />

          {errorMessage && (
            <Alert
              variant="error"
              className="mb-5"
              onClose={() => setErrorMessage(null)}
            >
              {errorMessage}
            </Alert>
          )}

          <form onSubmit={handleRequestOtp} noValidate className="space-y-5">
            <Input
              label="Email"
              id="forgot-email"
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

            <Button
              type="submit"
              size="lg"
              className="w-full"
              isLoading={isLoading}
              rightIcon={<ArrowRight className="h-4 w-4" />}
            >
              {isLoading ? "Sending…" : "Send code"}
            </Button>
          </form>
        </>
      )}

      <BackToSignIn />
    </div>
  );
}

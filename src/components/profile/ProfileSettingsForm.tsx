"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock, Mail, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { UserAvatar } from "@/components/layout/UserAvatar";
import { SupportedCurrency, Profile } from "@/lib/supabase/profile";
import { updateProfile } from "@/app/actions/profile";

interface ProfileSettingsFormProps {
  initialProfile: Profile;
  userEmail: string;
}

const CURRENCIES: { code: SupportedCurrency; symbol: string; label: string }[] = [
  { code: "INR", symbol: "₹", label: "Indian Rupee" },
  { code: "USD", symbol: "$", label: "US Dollar" },
  { code: "AED", symbol: "د.إ", label: "UAE Dirham" },
];

export function ProfileSettingsForm({ initialProfile, userEmail }: ProfileSettingsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [fullName, setFullName] = useState(initialProfile.full_name || "");
  const [defaultCurrency, setDefaultCurrency] = useState<SupportedCurrency>(
    initialProfile.default_currency || "USD"
  );

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ fullName?: string }>({});

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setFieldErrors({});

    if (!fullName.trim()) {
      setFieldErrors({ fullName: "Name is required" });
      return;
    }

    startTransition(async () => {
      const res = await updateProfile({ fullName: fullName.trim(), defaultCurrency });
      if (!res.success) {
        setErrorMessage(res.error || "Failed to update profile.");
      } else {
        setSuccessMessage("Saved.");
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {errorMessage && (
        <Alert variant="error" onClose={() => setErrorMessage(null)}>
          {errorMessage}
        </Alert>
      )}
      {successMessage && (
        <Alert variant="success" onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <UserAvatar name={fullName.trim() || userEmail} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg">{fullName.trim() || "Your name"}</p>
          <p className="truncate text-xs text-fg-subtle">{userEmail}</p>
        </div>
      </div>

      <Input
        label="Name"
        id="profile-fullname"
        name="fullName"
        placeholder="Your name"
        value={fullName}
        onChange={(e) => {
          setFullName(e.target.value);
          if (fieldErrors.fullName) setFieldErrors({});
        }}
        error={fieldErrors.fullName}
        leftIcon={<User className="h-4 w-4" />}
        disabled={isPending}
      />

      <Input
        label="Email"
        id="profile-email"
        name="email"
        type="email"
        value={userEmail}
        readOnly
        disabled
        leftIcon={<Mail className="h-4 w-4" />}
        rightElement={<Lock className="mr-1 h-3.5 w-3.5 text-fg-subtle" aria-label="Locked" />}
      />

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-[13px] font-medium text-fg-muted">Default currency</legend>
        <div className="grid grid-cols-3 gap-2">
          {CURRENCIES.map((c) => {
            const selected = defaultCurrency === c.code;
            return (
              <button
                key={c.code}
                type="button"
                aria-pressed={selected}
                onClick={() => setDefaultCurrency(c.code)}
                disabled={isPending}
                title={c.label}
                className={cn(
                  "relative flex h-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border transition-all disabled:cursor-not-allowed",
                  selected
                    ? "border-accent/60 bg-accent/10 text-fg ring-4 ring-accent/10"
                    : "border-line bg-glass-input text-fg-muted hover:border-line-strong hover:text-fg"
                )}
              >
                {selected && (
                  <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-accent" strokeWidth={3} />
                )}
                <span className="text-base font-semibold">{c.symbol}</span>
                <span className="font-mono text-[11px] font-semibold">{c.code}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <Button type="submit" size="lg" isLoading={isPending} className="w-full sm:w-auto">
        {isPending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

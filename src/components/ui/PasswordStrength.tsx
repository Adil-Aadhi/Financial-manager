import React from "react";
import { cn } from "@/lib/cn";

const LEVELS = [
  { label: "Too short", bar: "bg-danger", text: "text-danger" },
  { label: "Weak", bar: "bg-danger", text: "text-danger" },
  { label: "Fair", bar: "bg-warning", text: "text-warning" },
  { label: "Good", bar: "bg-accent-2", text: "text-accent-2" },
  { label: "Strong", bar: "bg-accent", text: "text-accent" },
];

export function scorePassword(pw: string): number {
  if (pw.length < 8) return 0;
  let score = 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 14) score++;
  return Math.min(score, 4);
}

/** Four-segment strength meter shown under new-password fields. */
export function PasswordStrength({ password, className }: { password: string; className?: string }) {
  if (!password) return null;
  const score = scorePassword(password);
  const level = LEVELS[score];

  return (
    <div className={cn("animate-fade space-y-1.5", className)} aria-live="polite">
      <div className="flex gap-1.5">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-all duration-300",
              i <= Math.max(score, 1) ? level.bar : "bg-line-strong"
            )}
          />
        ))}
      </div>
      <p className="text-[11px] text-fg-subtle">
        Strength: <span className={cn("font-semibold", level.text)}>{level.label}</span>
        {score < 4 && " · mix upper & lower case, numbers and symbols"}
      </p>
    </div>
  );
}

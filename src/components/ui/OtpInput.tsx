"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  hasError?: boolean;
  autoFocus?: boolean;
}

export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled = false,
  hasError = false,
  autoFocus = true,
}: OtpInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] || "");

  // Focus the next empty box once on mount (not on every keystroke).
  useEffect(() => {
    if (autoFocus && !disabled) {
      inputRefs.current[Math.min(value.length, length - 1)]?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  const focusAt = (i: number) =>
    inputRefs.current[Math.max(0, Math.min(i, length - 1))]?.focus();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const digit = e.target.value.replace(/\D/g, "").slice(-1);
    if (!digit) return;
    // Codes fill left to right: write at this slot, or the first empty one before it.
    const target = Math.min(index, value.length);
    const next = (value.slice(0, target) + digit + value.slice(target + 1)).slice(0, length);
    onChange(next);
    focusAt(target + 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[index]) {
        onChange(value.slice(0, index) + value.slice(index + 1));
      } else if (index > 0) {
        onChange(value.slice(0, index - 1) + value.slice(index));
        focusAt(index - 1);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusAt(index - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusAt(index + 1);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    onChange(pasted);
    focusAt(pasted.length);
  };

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-1.5 py-1 sm:gap-2.5",
        hasError && "animate-shake"
      )}
    >
      {digits.map((digit, idx) => (
        <React.Fragment key={idx}>
          {idx === Math.floor(length / 2) && (
            <span className="h-px w-2 shrink-0 rounded bg-line-strong sm:w-3" aria-hidden="true" />
          )}
          <input
            ref={(el) => {
              inputRefs.current[idx] = el;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            autoComplete={idx === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${idx + 1} of ${length}`}
            value={digit}
            disabled={disabled}
            onChange={(e) => handleChange(e, idx)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
            className={cn(
              "h-12 w-10 rounded-xl border bg-glass-input text-center font-mono text-xl font-semibold text-fg transition-all duration-200 sm:h-14 sm:w-12 sm:text-2xl",
              "caret-accent focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60",
              hasError
                ? "border-danger/60 focus:border-danger focus:ring-danger/15"
                : digit
                  ? "border-accent/60 bg-accent/8 focus:ring-accent/15"
                  : "border-line hover:border-line-strong focus:border-accent/70 focus:ring-accent/15"
            )}
          />
        </React.Fragment>
      ))}
    </div>
  );
}

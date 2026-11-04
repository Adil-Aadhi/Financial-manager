import React from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightElement?: React.ReactNode;
  /** Element rendered on the right of the label row (e.g. "Forgot password?"). */
  labelAction?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      leftIcon,
      rightElement,
      labelAction,
      id,
      className,
      disabled,
      required,
      ...props
    },
    ref
  ) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    return (
      <div className="w-full space-y-1.5">
        {(label || labelAction) && (
          <div className="flex items-center justify-between gap-2">
            {label && (
              <label htmlFor={inputId} className="block text-[13px] font-medium text-fg-muted">
                {label}
                {required && (
                  <span className="ml-0.5 text-accent" aria-hidden="true">
                    *
                  </span>
                )}
              </label>
            )}
            {labelAction}
          </div>
        )}

        <div className="group/input relative">
          {leftIcon && (
            <div
              className={cn(
                "pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 transition-colors",
                error ? "text-danger" : "text-fg-subtle group-focus-within/input:text-accent"
              )}
            >
              {leftIcon}
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            required={required}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : helperText ? helperId : undefined}
            className={cn(
              "block h-12 w-full rounded-xl border bg-glass-input text-sm text-fg transition-all duration-200 placeholder:text-fg-subtle/80",
              "focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60",
              leftIcon ? "pl-10" : "pl-4",
              rightElement ? "pr-11" : "pr-4",
              error
                ? "border-danger/60 focus:border-danger focus:ring-danger/15"
                : "border-line hover:border-line-strong focus:border-accent/70 focus:bg-glass-hover focus:ring-accent/15",
              className
            )}
            {...props}
          />

          {rightElement && (
            <div className="absolute inset-y-0 right-0 flex items-center pr-2.5">{rightElement}</div>
          )}
        </div>

        {error ? (
          <p id={errorId} className="flex animate-fade items-center gap-1.5 text-xs font-medium text-danger">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : helperText ? (
          <p id={helperId} className="text-xs text-fg-subtle">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }
);

Input.displayName = "Input";

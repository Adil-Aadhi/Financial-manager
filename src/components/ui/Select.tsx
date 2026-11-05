import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, helperText, id, className, required, children, ...props }, ref) => {
    const generatedId = React.useId();
    const selectId = id || generatedId;
    const errorId = `${selectId}-error`;
    const helperId = `${selectId}-helper`;

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label htmlFor={selectId} className="block text-[13px] font-medium text-fg-muted">
            {label}
            {required && (
              <span className="ml-0.5 text-accent" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}

        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            required={required}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : helperText ? helperId : undefined}
            className={cn(
              "block h-12 w-full appearance-none rounded-xl border bg-glass-input px-4 pr-10 text-sm text-fg transition-all duration-200",
              "focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60",
              error
                ? "border-danger/60 focus:border-danger focus:ring-danger/15"
                : "border-line hover:border-line-strong focus:border-accent/70 focus:bg-glass-hover focus:ring-accent/15",
              className
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
          />
        </div>

        {error ? (
          <p id={errorId} className="animate-fade text-xs font-medium text-danger">
            {error}
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

Select.displayName = "Select";

import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: React.ReactNode;
  description?: string;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, description, id, className, disabled, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;

    return (
      <div className={cn("relative flex items-start gap-2.5", className)}>
        <span className="relative mt-px flex h-[18px] w-[18px] shrink-0">
          <input
            ref={ref}
            id={inputId}
            type="checkbox"
            disabled={disabled}
            className="peer h-full w-full cursor-pointer appearance-none rounded-[6px] border border-line-strong bg-glass-input transition-all checked:border-transparent checked:bg-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            {...props}
          />
          <Check
            className="pointer-events-none absolute inset-0 m-auto h-3 w-3 scale-50 text-accent-fg opacity-0 transition-all peer-checked:scale-100 peer-checked:opacity-100"
            strokeWidth={3.5}
            aria-hidden="true"
          />
        </span>
        {(label || description) && (
          <div className="text-sm leading-tight">
            {label && (
              <label
                htmlFor={inputId}
                className={cn(
                  "select-none font-medium",
                  disabled ? "cursor-not-allowed text-fg-subtle" : "cursor-pointer text-fg-muted hover:text-fg"
                )}
              >
                {label}
              </label>
            )}
            {description && <p className="mt-0.5 text-xs text-fg-subtle">{description}</p>}
          </div>
        )}
      </div>
    );
  }
);

Checkbox.displayName = "Checkbox";

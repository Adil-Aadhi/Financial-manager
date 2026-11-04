import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const base =
  "group/btn relative inline-flex items-center justify-center font-semibold rounded-xl select-none cursor-pointer transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-55 active:scale-[0.985]";

/** Exported so links can look like buttons: cn(buttonVariants.secondary, buttonSizes.md, ...) */
export const buttonBase = base;

export const buttonVariants = {
  primary:
    "bg-brand text-accent-fg shadow-glow hover:brightness-110 hover:-translate-y-px disabled:hover:translate-y-0 disabled:hover:brightness-100 before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-gradient-to-b before:from-white/25 before:to-transparent before:opacity-70",
  secondary: "glass text-fg hover:bg-glass-hover hover:border-line-strong",
  outline: "border border-line-strong bg-transparent text-fg hover:bg-glass-hover",
  ghost: "text-fg-muted hover:text-fg hover:bg-glass-hover",
  danger: "bg-danger text-white hover:brightness-110 shadow-[0_10px_30px_-12px_var(--danger)]",
} as const;

export const buttonSizes = {
  sm: "h-9 px-3.5 text-xs gap-1.5",
  md: "h-11 px-5 text-sm gap-2",
  lg: "h-12 px-6 text-[15px] gap-2.5",
} as const;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className,
      variant = "primary",
      size = "md",
      isLoading = false,
      disabled,
      leftIcon,
      rightIcon,
      type = "button",
      ...props
    },
    ref
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(base, buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="relative h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        leftIcon && <span className="relative inline-flex">{leftIcon}</span>
      )}
      <span className="relative">{children}</span>
      {!isLoading && rightIcon && (
        <span className="relative inline-flex transition-transform duration-200 group-hover/btn:translate-x-0.5">
          {rightIcon}
        </span>
      )}
    </button>
  )
);

Button.displayName = "Button";

import React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type AlertVariant = "error" | "success" | "warning" | "info";

export interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

const styles: Record<AlertVariant, { box: string; chip: string; icon: React.ReactNode }> = {
  error: {
    box: "border-danger/25 bg-danger/8",
    chip: "bg-danger/15 text-danger",
    icon: <AlertCircle className="h-4 w-4" />,
  },
  success: {
    box: "border-accent/25 bg-accent/8",
    chip: "bg-accent/15 text-accent",
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
  warning: {
    box: "border-warning/25 bg-warning/8",
    chip: "bg-warning/15 text-warning",
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  info: {
    box: "border-info/25 bg-info/8",
    chip: "bg-info/15 text-info",
    icon: <Info className="h-4 w-4" />,
  },
};

export function Alert({ variant = "info", title, children, onClose, className }: AlertProps) {
  const s = styles[variant];

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "relative flex animate-rise items-start gap-3 rounded-xl border p-3.5 text-sm",
        s.box,
        className
      )}
    >
      <span className={cn("mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-lg", s.chip)}>
        {s.icon}
      </span>
      <div className="flex-1 space-y-0.5 pt-0.5">
        {title && <p className="text-[13px] font-semibold text-fg">{title}</p>}
        <div className="text-xs leading-relaxed text-fg-muted">{children}</div>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 -mt-1 cursor-pointer rounded-lg p-1 text-fg-subtle transition-colors hover:bg-glass-hover hover:text-fg"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

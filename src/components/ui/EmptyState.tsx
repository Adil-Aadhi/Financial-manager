import React from "react";
import { cn } from "@/lib/cn";

/** Centered icon + message for sections with no data yet. Keep copy to one short line. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-8 text-center", className)}>
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-glass-hover text-fg-subtle">
        {icon}
      </span>
      <p className="mt-3 text-sm font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-[240px] text-xs text-fg-subtle">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

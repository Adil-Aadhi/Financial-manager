"use client";

import { Loader2 } from "lucide-react";
import {
  useRefreshFeedback,
  type RefreshScope,
} from "@/lib/offline/refreshFeedback";
import { cn } from "@/lib/cn";

export function SectionRefreshIndicator({
  scope,
  label = "Updating…",
  className,
}: {
  scope: RefreshScope | readonly RefreshScope[];
  label?: string;
  className?: string;
}) {
  const refreshing = useRefreshFeedback(scope);
  if (!refreshing) return null;

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-accent", className)}
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      {label}
    </span>
  );
}

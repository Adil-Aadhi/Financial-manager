import React from "react";
import { cn } from "@/lib/cn";
import { initialsOf } from "@/lib/format";

export function UserAvatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand font-semibold text-accent-fg ring-2 ring-[var(--glass-edge)]",
        size === "sm" ? "h-8 w-8 text-[11px]" : "h-10 w-10 text-sm",
        className
      )}
      aria-hidden="true"
    >
      <span className="absolute inset-0 bg-gradient-to-b from-white/25 to-transparent" />
      <span className="relative">{initialsOf(name)}</span>
    </span>
  );
}

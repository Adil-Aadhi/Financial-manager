"use client";

import React, { useTransition } from "react";
import { Loader2, LogOut } from "lucide-react";
import { cn } from "@/lib/cn";
import { logoutAction } from "@/app/actions/auth";

interface SignOutButtonProps {
  className?: string;
  /** "icon" = square icon button, "row" = full-width list row. */
  variant?: "icon" | "row";
}

export function SignOutButton({ className, variant = "row" }: SignOutButtonProps) {
  const [isPending, startTransition] = useTransition();
  const onClick = () => startTransition(async () => logoutAction());
  const Icon = isPending ? Loader2 : LogOut;

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        aria-label="Sign out"
        title="Sign out"
        className={cn(
          "flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-fg-subtle transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50",
          className
        )}
      >
        <Icon className={cn("h-4 w-4", isPending && "animate-spin")} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className={cn(
        "flex h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50",
        className
      )}
    >
      <Icon className={cn("h-[18px] w-[18px]", isPending && "animate-spin")} />
      {isPending ? "Signing out…" : "Sign out"}
    </button>
  );
}

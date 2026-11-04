"use client";

import React from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFAB } from "@/components/layout/FABContext";

export interface FloatingActionButtonProps {
  className?: string;
  onClick?: () => void;
  label?: string;
  showOnMobile?: boolean;
}

/**
 * Reusable Floating Action Button (FAB).
 * Adapts its action and label dynamically to the current page / context:
 * - On /transactions -> opens Add Account modal
 * - On /accounts/[id] -> opens Quick Transaction Entry modal with account selected
 */
export function FloatingActionButton({
  className,
  onClick,
  label,
  showOnMobile = true,
}: FloatingActionButtonProps) {
  const { triggerAction, fabLabel, fabTooltip } = useFAB();

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      triggerAction();
    }
  };

  const displayLabel = label || fabLabel;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={fabTooltip}
      title={fabTooltip}
      className={cn(
        "group fixed z-40 cursor-pointer overflow-hidden rounded-full bg-brand text-sm font-semibold text-accent-fg shadow-glow ring-1 ring-inset ring-white/25 transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 active:scale-95",
        // Desktop: bottom-right pill
        "bottom-8 right-8 hidden h-14 items-center gap-2 pl-4 pr-5 lg:flex",
        // Mobile (if enabled): floating above bottom navigation
        showOnMobile && "bottom-24 right-4 flex h-13 w-13 items-center justify-center p-0 lg:hidden",
        className
      )}
    >
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/30 to-transparent" />
      <Plus
        className="relative h-5 w-5 shrink-0 transition-transform duration-300 group-hover:rotate-90"
        strokeWidth={2.6}
      />
      <span className="relative hidden lg:inline">{displayLabel}</span>
    </button>
  );
}

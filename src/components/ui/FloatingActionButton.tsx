"use client";

import React from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFAB } from "@/components/layout/FABContext";

export interface FloatingActionButtonProps {
  className?: string;
  onClick?: () => void;
  label?: string;
}

/**
 * Reusable Floating Action Button (FAB).
 * Adapts its action and label dynamically to the current page / context:
 * - On /transactions -> opens Add Transaction modal
 * - On /categories -> opens Add Category modal
 * - On /accounts/[id] -> opens Add Transaction with the account selected
 *
 * Desktop only (lg+). On mobile the same action is the raised + in BottomNav.
 */
export function FloatingActionButton({
  className,
  onClick,
  label,
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
        // Desktop-only bottom-right pill
        "bottom-8 right-8 hidden h-14 items-center gap-2 pl-4 pr-5 lg:flex",
        className
      )}
    >
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/30 to-transparent" />
      <Plus
        className="relative h-5 w-5 shrink-0 transition-transform duration-300 group-hover:rotate-90"
        strokeWidth={2.6}
      />
      <span className="relative">{displayLabel}</span>
    </button>
  );
}

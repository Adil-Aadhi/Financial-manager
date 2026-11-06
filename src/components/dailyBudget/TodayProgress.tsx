"use client";

import React from "react";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { formatPercent, getBudgetStatus, type BudgetLevel } from "@/lib/budget";
import { cn } from "@/lib/cn";

// Same bar colours and icons as the Monthly Budget card.
const LEVEL_STYLES: Record<BudgetLevel, { bar: string; text: string; message: string; icon: React.ReactNode }> = {
  within: {
    bar: "bg-positive",
    text: "text-positive",
    message: "Within today's allowance.",
    icon: <CircleCheck className="h-4 w-4" />,
  },
  approaching: {
    bar: "bg-warning",
    text: "text-warning",
    message: "Approaching today's allowance.",
    icon: <TriangleAlert className="h-4 w-4" />,
  },
  most: {
    bar: "bg-gradient-to-r from-warning to-danger",
    text: "text-warning",
    message: "Most of today's allowance is used.",
    icon: <TriangleAlert className="h-4 w-4" />,
  },
  exceeded: {
    bar: "bg-danger",
    text: "text-danger",
    message: "Today's allowance is used up.",
    icon: <CircleAlert className="h-4 w-4" />,
  },
};

/** Today's expenses against today's allowance, styled like the Monthly Budget card's bar. */
export function TodayProgress({ allowance, spent }: { allowance: number; spent: number }) {
  // The bar always stays visible. With a ₹0 allowance any spending is already over, so the
  // bar is full and red; with nothing spent it is empty.
  const zeroAllowance = allowance <= 0;
  const status = zeroAllowance
    ? {
        percentUsed: spent > 0 ? 100 : 0,
        exceededBy: Math.max(0, spent),
        level: (spent > 0 ? "exceeded" : "within") as BudgetLevel,
      }
    : getBudgetStatus(spent, allowance);
  const style = LEVEL_STYLES[status.level];
  const percentLabel = zeroAllowance && spent > 0 ? "100%" : formatPercent(status.percentUsed);
  const over = status.exceededBy > 0;
  return (
    <div className="relative mt-4">
      <div
        role="progressbar"
        aria-label="Today's allowance used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(status.percentUsed))}
        aria-valuetext={`${percentLabel} of today's allowance used`}
        className="h-2.5 overflow-hidden rounded-full bg-line"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500 ease-out", style.bar)}
          style={{ width: `${Math.min(100, status.percentUsed)}%` }}
        />
      </div>
      <div className="mt-2 flex items-start justify-between gap-3 text-xs">
        <p className={cn("flex min-w-0 items-start gap-1.5 font-medium", style.text)}>
          <span className="mt-px shrink-0" aria-hidden="true">{style.icon}</span>
          <span className="text-fg-muted">{over ? "Over today's allowance." : style.message}</span>
        </p>
        <span className={cn("shrink-0 font-money font-bold", style.text)}>{percentLabel} used today</span>
      </div>
    </div>
  );
}

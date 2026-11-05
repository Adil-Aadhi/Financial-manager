"use client";

import React, { useState } from "react";
import { CircleAlert, CircleCheck, Pencil, Target, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { formatPercent, getBudgetStatus, type BudgetLevel } from "@/lib/budget";
import { formatMoney } from "@/lib/format";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { MonthlyBudgetModal } from "./MonthlyBudgetModal";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";

const LEVEL_STYLES: Record<BudgetLevel, { bar: string; text: string; icon: React.ReactNode }> = {
  within: {
    bar: "bg-positive",
    text: "text-positive",
    icon: <CircleCheck className="h-4 w-4" />,
  },
  approaching: {
    bar: "bg-warning",
    text: "text-warning",
    icon: <TriangleAlert className="h-4 w-4" />,
  },
  most: {
    bar: "bg-gradient-to-r from-warning to-danger",
    text: "text-warning",
    icon: <TriangleAlert className="h-4 w-4" />,
  },
  exceeded: {
    bar: "bg-danger",
    text: "text-danger",
    icon: <CircleAlert className="h-4 w-4" />,
  },
};

export interface MonthlyBudgetCardProps {
  available: boolean;
  limit: number | null;
  spent: number;
  otherCurrencyCount: number;
  currency: SupportedCurrency;
  monthLabel: string;
}

/** Home dashboard card: one overall monthly limit vs this month's expenses. */
export function MonthlyBudgetCard({
  available,
  limit,
  spent,
  otherCurrencyCount,
  currency,
  monthLabel,
}: MonthlyBudgetCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const isOnline = useOnlineStatus();

  const header = (
    <div className="relative flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
        <Target className="h-4 w-4 text-accent" />
        Monthly budget
      </span>
      <div className="flex items-center gap-1.5">
        <span className="rounded-full border border-line bg-glass-hover px-2.5 py-0.5 text-[11px] font-semibold text-fg-muted">
          {monthLabel}
        </span>
        {available && limit !== null && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2.5"
            onClick={() => setIsModalOpen(true)}
            disabled={!isOnline}
            title={isOnline ? undefined : "Connect to the internet to edit the budget"}
            aria-label="Edit budget"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Edit budget</span>
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <section
        aria-label="Monthly budget"
        className="glass-strong glass-edge animate-rise overflow-hidden rounded-3xl p-4 sm:p-7"
      >
        <div className="pointer-events-none absolute -left-16 -bottom-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,var(--aurora-2),transparent_70%)]" />
        {header}

        {!available ? (
          <p className="relative mt-4 text-sm text-fg-muted">
            Budgets need a database update. Run the monthly-budget migration to turn them on.
          </p>
        ) : limit === null ? (
          <EmptyBudget onSet={() => setIsModalOpen(true)} enabled={isOnline} />
        ) : (
          <BudgetDetails
            limit={limit}
            spent={spent}
            currency={currency}
            otherCurrencyCount={otherCurrencyCount}
          />
        )}
        {available && !isOnline && (
          <p className="relative mt-3 text-[11px] text-fg-subtle">
            Budget figures are saved locally. Connect to the internet to change the limit.
          </p>
        )}
      </section>

      {isModalOpen && (
        <MonthlyBudgetModal
          isOpen
          onClose={() => setIsModalOpen(false)}
          currency={currency}
          currentAmount={limit}
        />
      )}
    </>
  );
}

function EmptyBudget({ onSet, enabled }: { onSet: () => void; enabled: boolean }) {
  return (
    <div className="relative mt-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-brand text-accent-fg shadow-glow">
          <span className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent" />
          <Target className="relative h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-fg">Set Your Monthly Budget</h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            Set a spending limit and track this month&apos;s expenses across all your accounts.
          </p>
        </div>
      </div>
      <Button
        onClick={onSet}
        disabled={!enabled}
        title={enabled ? undefined : "Connect to the internet to set a budget"}
        className="w-full shrink-0 sm:w-auto"
        leftIcon={<Target className="h-4 w-4" />}
      >
        Set Budget
      </Button>
    </div>
  );
}

function BudgetDetails({
  limit,
  spent,
  currency,
  otherCurrencyCount,
}: {
  limit: number;
  spent: number;
  currency: SupportedCurrency;
  otherCurrencyCount: number;
}) {
  const status = getBudgetStatus(spent, limit);
  const style = LEVEL_STYLES[status.level];
  // Exactly at the limit counts as "exceeded" for the message, but there is
  // nothing over yet, so the hero still shows "Left to spend ₹0".
  const exceeded = status.exceededBy > 0;
  const percentLabel = formatPercent(status.percentUsed);

  return (
    <div className="relative">
      {/* Hero figure: what's left, or how far over */}
      <p className="mt-3 text-[11px] font-medium text-fg-subtle">
        {exceeded ? "Over budget by" : "Left to spend"}
      </p>
      <p
        className={cn(
          "mt-1 font-money text-[30px] font-bold leading-none tracking-tight sm:text-4xl",
          exceeded ? "text-danger" : "text-fg"
        )}
      >
        {formatMoney(exceeded ? status.exceededBy : status.remaining, currency)}
      </p>

      {/* Progress */}
      <div className="mt-4">
        <div
          role="progressbar"
          aria-label="Budget used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.round(status.percentUsed))}
          aria-valuetext={`${percentLabel} of budget used`}
          className="h-2.5 overflow-hidden rounded-full bg-line"
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-500 ease-out", style.bar)}
            style={{ width: `${Math.min(100, status.percentUsed)}%` }}
          />
        </div>
        <div className="mt-2 flex items-start justify-between gap-3 text-xs">
          <p className={cn("flex min-w-0 items-start gap-1.5 font-medium", style.text)}>
            <span className="mt-px shrink-0">{style.icon}</span>
            <span className="text-fg-muted">{status.message}</span>
          </p>
          <span className={cn("shrink-0 font-money font-bold", style.text)}>{percentLabel} used</span>
        </div>
      </div>

      {/* Spent / Limit */}
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:gap-3">
        <div className="min-w-0 rounded-2xl border border-line bg-glass-hover p-3">
          <dt className="text-[11px] font-medium text-fg-subtle">Spent</dt>
          <dd className="mt-0.5 truncate font-money text-sm font-bold text-fg sm:text-base">
            {formatMoney(spent, currency)}
          </dd>
        </div>
        <div className="min-w-0 rounded-2xl border border-line bg-glass-hover p-3">
          <dt className="text-[11px] font-medium text-fg-subtle">Budget limit</dt>
          <dd className="mt-0.5 truncate font-money text-sm font-bold text-fg sm:text-base">
            {formatMoney(limit, currency)}
          </dd>
        </div>
      </dl>

      {otherCurrencyCount > 0 && (
        <p className="mt-3 text-[11px] text-fg-subtle">
          {otherCurrencyCount} expense{otherCurrencyCount === 1 ? "" : "s"} in another currency{" "}
          {otherCurrencyCount === 1 ? "isn't" : "aren't"} counted.
        </p>
      )}
    </div>
  );
}

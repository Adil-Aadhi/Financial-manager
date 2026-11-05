import React from "react";
import { ArrowDownLeft, ArrowUpRight, PiggyBank, Scale } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/budget";
import { formatMoney } from "@/lib/format";
import type { SupportedCurrency } from "@/lib/supabase/profile";

function signed(value: number, currency: SupportedCurrency) {
  const prefix = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${prefix}${formatMoney(Math.abs(value), currency)}`;
}

/** Four headline tiles: Income, Expenses, Savings, Net cash flow. */
export function ReportOverview({
  income,
  expense,
  net,
  savingsRate,
  count,
  currency,
}: {
  income: number;
  expense: number;
  net: number;
  savingsRate: number | null;
  count: number;
  currency: SupportedCurrency;
}) {
  const saved = Math.max(0, net);
  const savingsNote =
    savingsRate === null
      ? "No income in this period"
      : net < 0
        ? `Overspent by ${formatMoney(Math.abs(net), currency)}`
        : `${formatPercent(savingsRate)} of income`;

  return (
    <section aria-label="Overview" className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      <StatTile
        label="Income"
        value={formatMoney(income, currency)}
        tone="positive"
        icon={<ArrowDownLeft className="h-3.5 w-3.5" />}
        note={`${count} transaction${count === 1 ? "" : "s"}`}
      />
      <StatTile
        label="Expenses"
        value={formatMoney(expense, currency)}
        tone="negative"
        icon={<ArrowUpRight className="h-3.5 w-3.5" />}
        note={income > 0 ? `${formatPercent((expense / income) * 100)} of income` : "This period"}
      />
      <StatTile
        label="Savings"
        value={formatMoney(saved, currency)}
        tone="accent"
        icon={<PiggyBank className="h-3.5 w-3.5" />}
        note={savingsNote}
      />
      <StatTile
        label="Net cash flow"
        value={signed(net, currency)}
        tone={net > 0 ? "positive" : net < 0 ? "negative" : "neutral"}
        icon={<Scale className="h-3.5 w-3.5" />}
        note="Income − expenses"
      />
    </section>
  );
}

const TONES = {
  positive: { icon: "bg-positive/12 text-positive", value: "text-positive" },
  negative: { icon: "bg-danger/12 text-danger", value: "text-danger" },
  accent: { icon: "bg-accent-soft text-accent", value: "text-fg" },
  neutral: { icon: "bg-glass-hover text-fg-muted", value: "text-fg" },
} as const;

function StatTile({
  label,
  value,
  note,
  icon,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  tone: keyof typeof TONES;
}) {
  return (
    <div className="glass glass-edge min-w-0 rounded-2xl p-3.5 sm:p-5">
      <p className="flex items-center gap-2 text-[11px] font-medium text-fg-subtle sm:text-xs">
        <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-lg", TONES[tone].icon)}>
          {icon}
        </span>
        {label}
      </p>
      <p
        className={cn(
          "mt-2.5 truncate font-money text-lg font-bold tracking-tight sm:text-2xl",
          TONES[tone].value
        )}
        title={value}
      >
        {value}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-fg-subtle">{note}</p>
    </div>
  );
}

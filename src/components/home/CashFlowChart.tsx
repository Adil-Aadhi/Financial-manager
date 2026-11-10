"use client";

import React, { useState } from "react";
import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import type { MonthTotal } from "@/lib/reports";
import type { SupportedCurrency } from "@/lib/supabase/profile";

const PLOT_HEIGHT = 132;

/** Round up to 1, 2, 2.5 or 5 × 10ⁿ so the grid lines land on friendly numbers. */
export function niceMax(value: number) {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function signed(value: number, currency: SupportedCurrency) {
  const prefix = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${prefix}${formatMoney(Math.abs(value), currency)}`;
}

export interface CashFlowChartProps {
  months: MonthTotal[];
  currency: SupportedCurrency;
}

export function CashFlowChart({ months, currency }: CashFlowChartProps) {
  const hasData = months.some((month) => month.income > 0 || month.expense > 0);

  const lastWithData = [...months].reverse().findIndex((month) => month.income > 0 || month.expense > 0);
  const defaultIndex = lastWithData === -1 ? months.length - 1 : months.length - 1 - lastWithData;
  const [selected, setSelected] = useState(defaultIndex);

  if (!hasData) {
    return (
      <EmptyState
        icon={<BarChart3 className="h-5 w-5" />}
        title="No cash flow data yet"
        description="Record income and expenses to view your 6-month trend."
        className="py-8"
      />
    );
  }

  const activeIndex = Math.min(Math.max(selected, 0), months.length - 1);
  const current = months[activeIndex];
  const top = niceMax(Math.max(...months.map((month) => Math.max(month.income, month.expense))));

  return (
    <div>
      {/* Selected month details & legend banner */}
      <div
        className="mb-3.5 grid grid-cols-3 gap-2 rounded-xl border border-line bg-glass-hover p-2.5 sm:p-3"
        aria-live="polite"
      >
        <div className="col-span-3 flex items-center justify-between text-xs">
          <span className="font-semibold text-fg">{current.label}</span>
          <div className="flex items-center gap-2.5 text-[10px] font-medium text-fg-subtle">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-[2px] bg-positive" /> Income
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-[2px] bg-danger" /> Expenses
            </span>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] text-fg-subtle">Income</p>
          <p
            className="truncate font-money text-xs font-semibold text-positive sm:text-sm"
            title={formatMoney(current.income, currency)}
          >
            {formatMoney(current.income, currency)}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] text-fg-subtle">Expenses</p>
          <p
            className="truncate font-money text-xs font-semibold text-danger sm:text-sm"
            title={formatMoney(current.expense, currency)}
          >
            {formatMoney(current.expense, currency)}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] text-fg-subtle">Net cash flow</p>
          <p
            className={cn(
              "truncate font-money text-xs font-semibold sm:text-sm",
              current.net > 0 ? "text-positive" : current.net < 0 ? "text-danger" : "text-fg"
            )}
            title={signed(current.net, currency)}
          >
            {signed(current.net, currency)}
          </p>
        </div>
      </div>

      {/* Plot with Y-axis scale and X-axis labels */}
      <div className="flex gap-2">
        <div
          className="relative shrink-0 text-right font-money text-[10px] text-fg-subtle"
          style={{ height: PLOT_HEIGHT, width: 36 }}
          aria-hidden="true"
        >
          {[1, 0.5, 0].map((fraction) => (
            <span
              key={fraction}
              className="absolute right-0 -translate-y-1/2"
              style={{ top: (1 - fraction) * PLOT_HEIGHT }}
            >
              {formatMoney(top * fraction, currency, { compact: true })}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height: PLOT_HEIGHT }}>
            {[0, 0.5, 1].map((fraction) => (
              <span
                key={fraction}
                className={cn("absolute inset-x-0 h-px", fraction === 0 ? "bg-line-strong" : "bg-line")}
                style={{ top: (1 - fraction) * PLOT_HEIGHT }}
                aria-hidden="true"
              />
            ))}
            <div className="absolute inset-0 flex">
              {months.map((month, index) => {
                const active = index === activeIndex;
                return (
                  <button
                    key={month.key}
                    type="button"
                    onClick={() => setSelected(index)}
                    onPointerEnter={(event) => event.pointerType === "mouse" && setSelected(index)}
                    onFocus={() => setSelected(index)}
                    aria-pressed={active}
                    aria-label={`${month.label}: income ${formatMoney(month.income, currency)}, expenses ${formatMoney(month.expense, currency)}, net ${signed(month.net, currency)}`}
                    className={cn(
                      "relative flex flex-1 cursor-pointer items-end justify-center gap-1 rounded-t-lg transition-colors focus-visible:outline-none",
                      active ? "bg-glass-hover" : "hover:bg-glass-hover/50"
                    )}
                  >
                    <Bar
                      value={month.income}
                      max={top}
                      height={PLOT_HEIGHT}
                      className="bg-positive"
                      dimmed={!active}
                    />
                    <Bar
                      value={month.expense}
                      max={top}
                      height={PLOT_HEIGHT}
                      className="bg-danger"
                      dimmed={!active}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Month labels */}
          <div className="mt-1.5 flex" aria-hidden="true">
            {months.map((month, index) => (
              <span
                key={month.key}
                className={cn(
                  "flex-1 truncate text-center text-[10px] transition-colors",
                  index === activeIndex ? "font-semibold text-fg" : "text-fg-subtle"
                )}
              >
                {month.shortLabel}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Bar({
  value,
  max,
  height: plotHeight,
  className,
  dimmed,
}: {
  value: number;
  max: number;
  height: number;
  className: string;
  dimmed: boolean;
}) {
  const barHeight = max > 0 ? (value / max) * plotHeight : 0;
  return (
    <span
      className={cn(
        "w-2 max-w-3 rounded-t-[3px] transition-[height,opacity] duration-200 sm:w-3",
        className,
        dimmed && "opacity-60"
      )}
      style={{ height: value > 0 ? Math.max(2, barHeight) : 0 }}
    />
  );
}

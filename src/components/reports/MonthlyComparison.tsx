"use client";

import React, { useState } from "react";
import { BarChart3, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import type { MonthTotal } from "@/lib/reports";
import type { SupportedCurrency } from "@/lib/supabase/profile";

const PLOT_HEIGHT = 168;
const SAVINGS_HEIGHT = 44;

/** Round up to 1, 2, 2.5 or 5 × 10ⁿ so the grid lines land on friendly numbers. */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function signed(value: number, currency: SupportedCurrency) {
  const prefix = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${prefix}${formatMoney(Math.abs(value), currency)}`;
}

/**
 * Income vs expenses per month (grouped columns, one axis), with a savings
 * strip below on the same month positions. Tap or hover a month for its
 * figures; a table view lists every month.
 */
export function MonthlyComparison({
  months,
  currency,
}: {
  months: MonthTotal[];
  currency: SupportedCurrency;
}) {
  const lastWithData = [...months].reverse().findIndex((month) => month.income || month.expense);
  const defaultIndex = lastWithData === -1 ? months.length - 1 : months.length - 1 - lastWithData;
  const [selected, setSelected] = useState(defaultIndex);
  const [showTable, setShowTable] = useState(false);

  const hasData = months.some((month) => month.income || month.expense);
  if (!hasData) {
    return (
      <Card title="Monthly comparison">
        <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No activity in this period" />
      </Card>
    );
  }

  const top = niceMax(Math.max(...months.map((month) => Math.max(month.income, month.expense))));
  const netMax = Math.max(1, ...months.map((month) => Math.abs(month.net)));
  const current = months[Math.min(selected, months.length - 1)];
  const previous = selected > 0 ? months[selected - 1] : null;
  const scrollable = months.length > 12;

  const expenseChange =
    previous && previous.expense > 0 ? ((current.expense - previous.expense) / previous.expense) * 100 : null;

  return (
    <Card
      title="Monthly comparison"
      description={months.length === 1 ? "Choose a longer range to compare months" : `${months.length} months`}
      action={
        <div className="flex shrink-0 items-center gap-3 text-[11px] font-medium text-fg-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-positive" /> Income
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-danger" /> Expenses
          </span>
        </div>
      }
      bodyClassName="pt-3"
    >
      {/* Selected month figures (the "tooltip", always visible on touch) */}
      <div className="mb-4 grid grid-cols-3 gap-2 rounded-2xl border border-line bg-glass-hover p-3" aria-live="polite">
        <p className="col-span-3 -mb-0.5 text-xs font-semibold text-fg">{current.label}</p>
        <Figure label="Income" value={formatMoney(current.income, currency)} className="text-positive" />
        <Figure label="Expenses" value={formatMoney(current.expense, currency)} className="text-danger" />
        <Figure
          label="Savings"
          value={signed(current.net, currency)}
          className={current.net > 0 ? "text-positive" : current.net < 0 ? "text-danger" : "text-fg"}
        />
        {expenseChange !== null && (
          <p className="col-span-3 text-[11px] text-fg-subtle">
            Spending {expenseChange >= 0 ? "up" : "down"}{" "}
            <span className="font-money font-semibold text-fg-muted">{Math.abs(Math.round(expenseChange))}%</span> vs{" "}
            {previous?.shortLabel}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        {/* Y axis */}
        <div className="relative shrink-0 text-right font-money text-[10px] text-fg-subtle" style={{ height: PLOT_HEIGHT, width: 40 }} aria-hidden="true">
          {[1, 0.5, 0].map((fraction) => (
            <span key={fraction} className="absolute right-0 -translate-y-1/2" style={{ top: (1 - fraction) * PLOT_HEIGHT }}>
              {formatMoney(top * fraction, currency, { compact: true })}
            </span>
          ))}
        </div>

        <div className={cn("min-w-0 flex-1", scrollable && "no-scrollbar overflow-x-auto")}>
          <div style={{ minWidth: scrollable ? months.length * 40 : undefined }}>
            {/* Plot */}
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
                  const active = index === selected;
                  return (
                    <button
                      key={month.key}
                      type="button"
                      onClick={() => setSelected(index)}
                      onPointerEnter={(event) => event.pointerType === "mouse" && setSelected(index)}
                      onFocus={() => setSelected(index)}
                      aria-pressed={active}
                      aria-label={`${month.label}: income ${formatMoney(month.income, currency)}, expenses ${formatMoney(month.expense, currency)}`}
                      className={cn(
                        "relative flex flex-1 cursor-pointer items-end justify-center gap-0.5 rounded-t-lg transition-colors focus-visible:outline-none",
                        active ? "bg-glass-hover" : "hover:bg-glass-hover/60"
                      )}
                    >
                      <Bar value={month.income} max={top} className="bg-positive" dimmed={!active} />
                      <Bar value={month.expense} max={top} className="bg-danger" dimmed={!active} />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* X axis */}
            <div className="mt-1.5 flex" aria-hidden="true">
              {months.map((month, index) => (
                <span
                  key={month.key}
                  className={cn(
                    "flex-1 truncate text-center text-[10px] font-medium",
                    index === selected ? "text-fg" : "text-fg-subtle"
                  )}
                >
                  {month.shortLabel}
                </span>
              ))}
            </div>

            {/* Savings strip: same months, diverging from zero */}
            <p className="mt-4 mb-1 text-[11px] font-medium text-fg-subtle">Savings</p>
            <div className="relative flex" style={{ height: SAVINGS_HEIGHT }} aria-hidden="true">
              <span className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
              {months.map((month, index) => {
                const height = (Math.abs(month.net) / netMax) * (SAVINGS_HEIGHT / 2);
                return (
                  <button
                    key={month.key}
                    type="button"
                    tabIndex={-1}
                    onClick={() => setSelected(index)}
                    className="relative flex-1 cursor-pointer"
                  >
                    {month.net !== 0 && (
                      <span
                        className={cn(
                          "absolute left-1/2 w-2.5 -translate-x-1/2 sm:w-3",
                          month.net > 0 ? "rounded-t-[3px] bg-positive" : "rounded-b-[3px] bg-danger",
                          index !== selected && "opacity-60"
                        )}
                        style={
                          month.net > 0
                            ? { bottom: "50%", height: Math.max(2, height) }
                            : { top: "50%", height: Math.max(2, height) }
                        }
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Table view: every value readable without the chart */}
      <button
        type="button"
        onClick={() => setShowTable((open) => !open)}
        aria-expanded={showTable}
        className="mt-4 flex w-full cursor-pointer items-center justify-center gap-1 rounded-xl py-2 text-xs font-semibold text-accent transition-colors hover:bg-glass-hover"
      >
        {showTable ? "Hide table" : "Show as table"}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showTable && "rotate-180")} />
      </button>
      {showTable && (
        <div className="mt-2 animate-fade overflow-x-auto">
          <table className="w-full min-w-[320px] border-separate border-spacing-0 text-left text-xs">
            <thead>
              <tr className="text-[11px] font-semibold text-fg-subtle">
                <th className="border-b border-line py-2 pr-2">Month</th>
                <th className="border-b border-line py-2 pr-2 text-right">Income</th>
                <th className="border-b border-line py-2 pr-2 text-right">Expenses</th>
                <th className="border-b border-line py-2 text-right">Savings</th>
              </tr>
            </thead>
            <tbody className="font-money">
              {[...months].reverse().map((month) => (
                <tr key={month.key}>
                  <td className="border-b border-line py-2 pr-2 font-sans font-medium text-fg">{month.shortLabel} {month.key.slice(0, 4)}</td>
                  <td className="border-b border-line py-2 pr-2 text-right font-semibold text-positive">{formatMoney(month.income, currency)}</td>
                  <td className="border-b border-line py-2 pr-2 text-right font-semibold text-danger">{formatMoney(month.expense, currency)}</td>
                  <td className={cn("border-b border-line py-2 text-right font-semibold", month.net < 0 ? "text-danger" : "text-fg")}>
                    {signed(month.net, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Bar({ value, max, className, dimmed }: { value: number; max: number; className: string; dimmed: boolean }) {
  const height = max > 0 ? (value / max) * PLOT_HEIGHT : 0;
  return (
    <span
      className={cn(
        "w-2.5 rounded-t-[4px] transition-[height,opacity] duration-300 sm:w-3.5",
        className,
        dimmed && "opacity-70"
      )}
      style={{ height: value > 0 ? Math.max(2, height) : 0 }}
    />
  );
}

function Figure({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-fg-subtle">{label}</p>
      <p className={cn("truncate font-money text-[13px] font-bold sm:text-sm", className)} title={value}>
        {value}
      </p>
    </div>
  );
}

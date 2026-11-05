"use client";

import React, { useState } from "react";
import { ChevronDown, PieChart } from "lucide-react";
import { CategoryTile, categoryStyle } from "@/components/categories/CategoryIcon";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/budget";
import { formatMoney } from "@/lib/format";
import type { CategoryTotal } from "@/lib/reports";
import type { SupportedCurrency } from "@/lib/supabase/profile";

const VISIBLE_ROWS = 5;
const SEGMENTS = 6;

/**
 * Part-to-whole for one transaction type: a thin segmented bar (top parts +
 * "Other") above a ranked list of categories with amount, share and a bar.
 * Tap or hover a row to highlight its segment.
 */
export function CategoryBreakdown({
  title,
  type,
  items,
  total,
  currency,
}: {
  title: string;
  type: "income" | "expense";
  items: CategoryTotal[];
  total: number;
  currency: SupportedCurrency;
}) {
  const [showAll, setShowAll] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  if (items.length === 0 || total <= 0) {
    return (
      <Card title={title}>
        <EmptyState
          icon={<PieChart className="h-5 w-5" />}
          title={type === "expense" ? "No expenses in this period" : "No income in this period"}
        />
      </Card>
    );
  }

  const max = items[0].total;
  const segments = items.slice(0, SEGMENTS - (items.length > SEGMENTS ? 1 : 0));
  const otherTotal = items.slice(segments.length).reduce((sum, item) => sum + item.total, 0);
  const visible = showAll ? items : items.slice(0, VISIBLE_ROWS);
  const top = items[0];

  return (
    <Card
      title={title}
      description={`${items.length} categor${items.length === 1 ? "y" : "ies"} · ${formatMoney(total, currency)}`}
      bodyClassName="pt-3"
    >
      <p className="mb-3 text-xs text-fg-muted">
        {type === "expense" ? "Most spent on" : "Most earned from"}{" "}
        <span className="font-semibold text-fg">{top.name}</span>
        {" · "}
        <span className="font-money font-bold text-fg">{formatPercent(top.percent)}</span>
      </p>

      {/* Thin segmented bar: names and figures are in the list below. */}
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
        {segments.map((item) => (
          <span
            key={item.id}
            style={{ ...categoryStyle(item.icon), flexGrow: item.total }}
            className={cn(
              "cat-fill min-w-1 rounded-full transition-opacity duration-200",
              activeId && activeId !== item.id && "opacity-25"
            )}
          />
        ))}
        {otherTotal > 0 && (
          <span
            style={{ flexGrow: otherTotal }}
            className={cn("min-w-1 rounded-full bg-line-strong transition-opacity", activeId && "opacity-25")}
          />
        )}
      </div>

      <ul className="mt-4 space-y-1">
        {visible.map((item, index) => {
          const active = activeId === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setActiveId(active ? null : item.id)}
                onPointerEnter={(event) => event.pointerType === "mouse" && setActiveId(item.id)}
                onPointerLeave={(event) => event.pointerType === "mouse" && setActiveId(null)}
                aria-pressed={active}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors",
                  active ? "bg-glass-hover" : "hover:bg-glass-hover"
                )}
              >
                <CategoryTile icon={item.icon} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium text-fg">
                      {index < 3 && (
                        <span className="mr-1.5 font-money text-[11px] font-bold text-fg-subtle">#{index + 1}</span>
                      )}
                      {item.name}
                    </p>
                    <p className="shrink-0 font-money text-[13px] font-bold text-fg">
                      {formatMoney(item.total, currency)}
                    </p>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                      <span
                        style={{ ...categoryStyle(item.icon), width: `${max > 0 ? (item.total / max) * 100 : 0}%` }}
                        className="cat-fill block h-full rounded-full"
                      />
                    </span>
                    <span className="w-11 shrink-0 text-right font-money text-[11px] font-semibold text-fg-muted">
                      {formatPercent(item.percent)}
                    </span>
                  </div>
                  {active && (
                    <p className="mt-1 animate-fade text-[11px] text-fg-subtle">
                      {item.count} transaction{item.count === 1 ? "" : "s"} · avg{" "}
                      {formatMoney(item.count ? item.total / item.count : 0, currency)}
                    </p>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {items.length > VISIBLE_ROWS && (
        <button
          type="button"
          onClick={() => setShowAll((open) => !open)}
          aria-expanded={showAll}
          className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1 rounded-xl py-2 text-xs font-semibold text-accent transition-colors hover:bg-glass-hover"
        >
          {showAll ? "Show less" : `Show all ${items.length}`}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAll && "rotate-180")} />
        </button>
      )}
    </Card>
  );
}

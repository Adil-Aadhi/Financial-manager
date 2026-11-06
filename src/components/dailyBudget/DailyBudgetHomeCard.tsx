"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import { cn } from "@/lib/cn";
import { calculateDailyBudgetToday } from "@/lib/dailyBudget";
import { formatMoney } from "@/lib/format";
import type { DailyBudgetServerData } from "@/lib/supabase/dailyBudget";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { useDailyBudgetData, useDailyBudgetToday } from "./useDailyBudget";
import { signedMoney } from "./format";
import { TodayProgress } from "./TodayProgress";

/**
 * Home card for the Daily Budget Tracker, shown above the Monthly Budget card. Reads only the
 * daily-budget tables (never accounts or transactions) and works offline from IndexedDB.
 */
export function DailyBudgetHomeCard({
  ownerId,
  currency,
  server,
  serverToday,
}: {
  ownerId: string;
  currency: SupportedCurrency;
  server: DailyBudgetServerData;
  serverToday: string;
}) {
  const data = useDailyBudgetData(ownerId, server);
  const today = useDailyBudgetToday(serverToday);
  const overview = calculateDailyBudgetToday(data.limits, data.expenses, today);
  const configured = data.limits.length > 0;
  const negative = overview.available < 0;

  return (
    <Link
      href="/daily-budget"
      aria-label="Open the daily budget tracker"
      className="group block rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <section className="glass-strong glass-edge animate-rise overflow-hidden rounded-3xl p-4 transition-colors group-hover:border-line-strong sm:p-7">
        <div className="pointer-events-none absolute -right-20 -bottom-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,var(--aurora-3),transparent_70%)]" />
        <div className="relative flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
            <CalendarDays className="h-4 w-4 text-accent" />
            Daily budget
          </span>
          <span className="flex items-center gap-1 rounded-full border border-line bg-glass-hover px-2.5 py-0.5 text-[11px] font-semibold text-fg-muted transition-colors group-hover:text-fg">
            {configured ? "Open" : "Set up"}
            <ArrowUpRight className="h-3 w-3" />
          </span>
        </div>

        {!data.available ? (
          <p className="relative mt-4 text-sm text-fg-muted">
            The daily budget needs a database update. Run the daily-budget migration to turn it on.
          </p>
        ) : !configured ? (
          <div className="relative mt-3">
            <h2 className="text-base font-semibold tracking-tight text-fg">Track a daily spending allowance</h2>
            <p className="mt-0.5 text-sm text-fg-muted">
              Choose how much you can spend each day. Unused money carries forward.
            </p>
          </div>
        ) : !overview.started ? (
          <p className="relative mt-4 text-sm text-fg-muted">
            Your daily budget starts on a later date. Open it to see the details.
          </p>
        ) : (
          <>
            <p
              className={cn(
                "relative mt-3 font-money text-[30px] font-bold leading-none tracking-tight sm:text-4xl",
                negative ? "text-danger" : "text-positive"
              )}
            >
              {formatMoney(overview.available, currency)}
            </p>
            <p className="relative mt-2 text-xs text-fg-subtle">
              {negative ? "Overspent so far this month" : "Available balance today"}
            </p>
            <TodayProgress allowance={overview.allowance} spent={overview.expenses} />
            <dl className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              <Stat label="Daily allowance" value={formatMoney(overview.allowance, currency)} />
              <Stat label="Today's expenses" value={formatMoney(overview.expenses, currency)} />
              {overview.expenses > overview.allowance ? (
                <Stat
                  label="Over today by"
                  value={formatMoney(overview.expenses - overview.allowance, currency)}
                  tone="negative"
                />
              ) : (
                <Stat
                  label="Left today"
                  value={formatMoney(overview.allowance - overview.expenses, currency)}
                  // Nothing left (limit reached exactly) shows red, like going over.
                  tone={overview.allowance - overview.expenses > 0 ? "positive" : "negative"}
                />
              )}
              <Stat
                label="Carried in"
                value={signedMoney(overview.carried, currency)}
                tone={overview.carried < 0 ? "negative" : overview.carried > 0 ? "positive" : "neutral"}
              />
            </dl>
          </>
        )}
      </section>
    </Link>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-glass-hover p-2.5 sm:p-3">
      <dt className="truncate text-[11px] font-medium text-fg-subtle">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 truncate font-money text-[13px] font-semibold sm:text-base",
          tone === "positive" && "text-positive",
          tone === "negative" && "text-danger",
          tone === "neutral" && "text-fg"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

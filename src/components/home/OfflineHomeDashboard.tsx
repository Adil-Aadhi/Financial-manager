"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Landmark,
  PieChart,
  PiggyBank,
  ReceiptText,
  Wallet,
} from "lucide-react";
import { MonthlyBudgetCard } from "@/components/budget/MonthlyBudgetCard";
import { CategoryTile, categoryStyle } from "@/components/categories/CategoryIcon";
import { Card, CardLink } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import { offlineDb } from "@/lib/offline/db";
import { useOfflineRefresh } from "@/lib/offline/useOfflineRefresh";
import { useLocalContentMark } from "@/lib/perf";
import type { MonthRange } from "@/lib/month";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { normalizeIncludeInSummary } from "@/lib/accountSummary";
import { normalizeTransactionDate } from "@/lib/transactions";

export interface HomeAccount {
  id: string;
  name: string;
  opening_balance: number | string | null;
  currency: string | null;
  deleted_at?: string | null;
  include_in_summary?: boolean | null;
  created_at: string;
}

export interface HomeTransaction {
  id: string;
  account_id: string;
  category_id: string | null;
  type: string;
  amount: number | string;
  description: string | null;
  transaction_date: string;
  created_at: string;
  category: { name: string; icon: string } | null;
}

export interface HomeSnapshot {
  accounts: HomeAccount[];
  transactions: HomeTransaction[];
  budget: {
    available: boolean;
    limit: number | null;
    spent: number;
    otherCurrencyCount: number;
  };
}

export function OfflineHomeDashboard({
  ownerId,
  currency,
  month,
  serverSnapshot,
  dailyBudgetCard,
  subscriptionsCard,
}: {
  ownerId: string;
  currency: SupportedCurrency;
  month: MonthRange;
  serverSnapshot: HomeSnapshot;
  /** Daily Budget Tracker card, shown directly above the Monthly Budget card. */
  dailyBudgetCard?: React.ReactNode;
  /** Isolated recurring-payment reminders, rendered after Monthly Budget. */
  subscriptionsCard?: React.ReactNode;
}) {
  const serverVersion = [
    ...serverSnapshot.accounts.map((account) => `${account.id}:${account.opening_balance}:${account.deleted_at ?? ""}:${normalizeIncludeInSummary(account.include_in_summary)}`),
    ...serverSnapshot.transactions.map((transaction) => `${transaction.id}:${transaction.amount}:${transaction.created_at}`),
    `budget:${serverSnapshot.budget.limit}:${serverSnapshot.budget.spent}`,
  ].join("|");

  useOfflineRefresh(ownerId, serverVersion, "the offline dashboard");

  const localSnapshot = useLiveQuery(async () => {
    const meta = await offlineDb.syncMeta.get(ownerId);
    if (!meta?.totalsMatch) return null;

    const [accounts, transactions, categories, budget, profile] = await Promise.all([
      offlineDb.accounts.where("ownerId").equals(ownerId).toArray(),
      offlineDb.transactions.where("ownerId").equals(ownerId).toArray(),
      offlineDb.categories.where("ownerId").equals(ownerId).toArray(),
      offlineDb.monthlyBudgets.get(ownerId),
      offlineDb.profiles.get(ownerId),
    ]);
    const localCurrency = isSupportedCurrency(profile?.default_currency)
      ? profile.default_currency
      : currency;
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    let spent = 0;
    let otherCurrencyCount = 0;

    for (const transaction of transactions) {
      if (
        transaction.type !== "expense" ||
        !normalizeTransactionDate(transaction.transaction_date)?.startsWith(month.prefix) ||
        !normalizeIncludeInSummary(accountById.get(transaction.account_id)?.include_in_summary)
      ) continue;
      const accountCurrency = accountById.get(transaction.account_id)?.currency || localCurrency;
      if (accountCurrency === localCurrency) spent += Number(transaction.amount) || 0;
      else otherCurrencyCount += 1;
    }

    const snapshot = {
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        opening_balance: account.opening_balance,
        currency: account.currency,
        deleted_at: account.deleted_at,
        include_in_summary: normalizeIncludeInSummary(account.include_in_summary),
        created_at: account.created_at,
      })),
      transactions: transactions.map((transaction) => {
        const category = categoryById.get(transaction.category_id);
        return {
          id: transaction.id,
          account_id: transaction.account_id,
          category_id: transaction.category_id,
          type: transaction.type,
          amount: transaction.amount,
          description: transaction.description,
          transaction_date:
            normalizeTransactionDate(transaction.transaction_date) ??
            transaction.transaction_date,
          created_at: transaction.created_at,
          category: category ? { name: category.name, icon: category.icon } : null,
        };
      }),
      budget: {
        available: meta.budgetAvailable,
        limit: budget ? Number(budget.amount) || null : null,
        spent,
        otherCurrencyCount,
      },
    } satisfies HomeSnapshot;

    return { snapshot, currency: localCurrency };
  }, [currency, month.prefix, ownerId]);
  useLocalContentMark(localSnapshot != null); // TEMPORARY perf (Step 3 Phase 0)

  return (
    <HomeDashboard
      snapshot={localSnapshot?.snapshot ?? serverSnapshot}
      currency={localSnapshot?.currency ?? currency}
      month={month}
      dailyBudgetCard={dailyBudgetCard}
      subscriptionsCard={subscriptionsCard}
    />
  );
}

function isSupportedCurrency(value: string | null | undefined): value is SupportedCurrency {
  return value === "INR" || value === "USD" || value === "AED";
}

function HomeDashboard({
  snapshot,
  currency,
  month,
  dailyBudgetCard,
  subscriptionsCard,
}: {
  snapshot: HomeSnapshot;
  currency: SupportedCurrency;
  month: MonthRange;
  dailyBudgetCard?: React.ReactNode;
  subscriptionsCard?: React.ReactNode;
}) {
  const data = useMemo(() => calculateDashboard(snapshot, currency, month.prefix), [snapshot, currency, month.prefix]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <section className="glass-strong glass-edge animate-rise overflow-hidden rounded-3xl p-4 sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,var(--aurora-1),transparent_70%)]" />
        <div className="relative flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
            <Wallet className="h-4 w-4 text-accent" /> Total balance
          </span>
          <span className="rounded-full border border-line bg-glass-hover px-2.5 py-0.5 font-mono text-[11px] font-semibold text-fg-muted">
            {currency}
          </span>
        </div>
        <p className="relative mt-3 font-money text-[30px] font-bold leading-none tracking-tight text-fg sm:text-5xl">
          {formatMoney(data.balance, currency)}
        </p>
        <p className="relative mt-2 text-xs text-fg-subtle">
          {data.currencyAccountCount === 0
            ? "No included accounts in this currency"
            : `Across ${data.currencyAccountCount} included ${currency} account${data.currencyAccountCount === 1 ? "" : "s"}`}
        </p>
        <div className="relative mt-5 grid grid-cols-3 gap-2 sm:mt-6 sm:gap-3">
          <MonthStat label="Income" value={formatMoney(data.monthIncome, currency, { compact: true })} icon={<ArrowDownLeft className="h-3.5 w-3.5" />} tone="positive" />
          <MonthStat label="Expenses" value={formatMoney(data.monthExpense, currency, { compact: true })} icon={<ArrowUpRight className="h-3.5 w-3.5" />} tone="negative" />
          <MonthStat label="Saved" value={formatMoney(data.saved, currency, { compact: true })} icon={<PiggyBank className="h-3.5 w-3.5" />} tone={data.saved < 0 ? "negative" : "neutral"} />
        </div>
        <p className="relative mt-3 text-[11px] text-fg-subtle">This month</p>
      </section>

      {dailyBudgetCard}

      <MonthlyBudgetCard
        available={snapshot.budget.available}
        limit={snapshot.budget.limit}
        spent={snapshot.budget.spent}
        otherCurrencyCount={snapshot.budget.otherCurrencyCount}
        currency={currency}
        monthLabel={month.label}
      />

      {subscriptionsCard}

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3">
        <div className="space-y-4 sm:space-y-5 lg:col-span-2">
          <Card title="Recent transactions" action={<CardLink href="/transactions">View all</CardLink>} bodyClassName="pt-2">
            {data.recent.length ? (
              <div className="divide-y divide-line">
                {data.recent.map((transaction) => {
                  const income = transaction.type === "income";
                  const transactionCurrency = data.accountById.get(transaction.account_id)?.currency || currency;
                  return (
                    <Link key={transaction.id} href={`/accounts/${transaction.account_id}`} className="flex items-center gap-3 px-1 py-2.5 transition-colors first:pt-1 last:pb-1 hover:opacity-80">
                      <CategoryTile icon={transaction.category?.icon} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-fg">{transaction.description || transaction.category?.name || (income ? "Income" : "Expense")}</p>
                        <p className="mt-0.5 truncate text-[11px] text-fg-subtle">{[transaction.description ? transaction.category?.name : null, formatShortDate(transaction.transaction_date)].filter(Boolean).join(" · ")}</p>
                      </div>
                      <p className={cn("shrink-0 font-money text-[13px] font-semibold sm:text-sm", income ? "text-positive" : "text-danger")}>
                        {income ? "+" : "−"}{formatMoney(Number(transaction.amount) || 0, transactionCurrency as SupportedCurrency)}
                      </p>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={<ReceiptText className="h-5 w-5" />} title="No transactions yet" description="Tap + to record your first income or expense." />
            )}
          </Card>
          <Card title="Cash flow" description="Income vs expenses · last 6 months"><EmptyChart /></Card>
        </div>

        <div className="space-y-4 sm:space-y-5">
          <Card title="Accounts" bodyClassName="pt-2">
            {data.activeAccounts.length ? (
              <div className="space-y-2 p-1">
                {data.activeAccounts.map((account) => {
                  const totals = data.totalsByAccount.get(account.id);
                  return (
                    <Link key={account.id} href={`/accounts/${account.id}`} className="flex items-center justify-between rounded-xl border border-line bg-glass-hover p-3 transition-colors hover:border-accent/40">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent"><Landmark className="h-4 w-4" /></span>
                        <div>
                          <p className="text-xs font-semibold text-fg">{account.name}</p>
                          <p className="font-money text-[11px] text-fg-subtle">{formatMoney((Number(account.opening_balance) || 0) + (totals?.income ?? 0) - (totals?.expense ?? 0), (account.currency || currency) as SupportedCurrency)}</p>
                        </div>
                      </div>
                      <ArrowUpRight className="h-4 w-4 text-fg-subtle" />
                    </Link>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={<Landmark className="h-5 w-5" />} title="No accounts yet" description="Bank, cash, UPI and cards will show here." />
            )}
          </Card>
          <Card title="Top spending" description="This month" bodyClassName="pt-3">
            {data.topSpending.length ? <TopSpending items={data.topSpending} total={data.monthExpense} currency={currency} /> : <EmptyState icon={<PieChart className="h-5 w-5" />} title="Nothing spent yet" />}
          </Card>
        </div>
      </div>
    </div>
  );
}

export function calculateDashboard(snapshot: HomeSnapshot, currency: SupportedCurrency, monthPrefix: string) {
  const activeAccounts = snapshot.accounts.filter((account) => !account.deleted_at).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const accountById = new Map(activeAccounts.map((account) => [account.id, account]));
  const activeIds = new Set(accountById.keys());
  const summaryAccounts = activeAccounts.filter((account) =>
    normalizeIncludeInSummary(account.include_in_summary)
  );
  const summaryIds = new Set(summaryAccounts.map((account) => account.id));
  const transactions = snapshot.transactions.filter((transaction) => activeIds.has(transaction.account_id));
  const totalsByAccount = new Map<string, { income: number; expense: number }>();
  const spendByCategory = new Map<string, { name: string; icon: string; total: number }>();
  let balance = 0;
  let monthIncome = 0;
  let monthExpense = 0;

  for (const account of summaryAccounts) {
    if ((account.currency || currency) === currency) balance += Number(account.opening_balance) || 0;
  }
  for (const transaction of transactions) {
    const amount = Number(transaction.amount) || 0;
    const totals = totalsByAccount.get(transaction.account_id) ?? { income: 0, expense: 0 };
    if (transaction.type === "income") totals.income += amount;
    if (transaction.type === "expense") totals.expense += amount;
    totalsByAccount.set(transaction.account_id, totals);

    if (!summaryIds.has(transaction.account_id)) continue;
    if ((accountById.get(transaction.account_id)?.currency || currency) !== currency) continue;
    if (transaction.type === "income") balance += amount;
    if (transaction.type === "expense") balance -= amount;
    if (!normalizeTransactionDate(transaction.transaction_date)?.startsWith(monthPrefix)) continue;
    if (transaction.type === "income") monthIncome += amount;
    if (transaction.type === "expense") {
      monthExpense += amount;
      const key = transaction.category_id || "uncategorized";
      const entry = spendByCategory.get(key) ?? { name: transaction.category?.name ?? "Other", icon: transaction.category?.icon ?? "circle-ellipsis", total: 0 };
      entry.total += amount;
      spendByCategory.set(key, entry);
    }
  }
  const recent = [...transactions]
    .sort((a, b) =>
      `${normalizeTransactionDate(b.transaction_date) ?? ""}|${b.created_at}`.localeCompare(
        `${normalizeTransactionDate(a.transaction_date) ?? ""}|${a.created_at}`
      )
    )
    .slice(0, 5);
  return {
    activeAccounts,
    accountById,
    totalsByAccount,
    recent,
    balance,
    monthIncome,
    monthExpense,
    saved: monthIncome - monthExpense,
    currencyAccountCount: summaryAccounts.filter((account) => (account.currency || currency) === currency).length,
    topSpending: [...spendByCategory.values()].sort((a, b) => b.total - a.total),
  };
}

function formatShortDate(value: string) {
  const normalized = normalizeTransactionDate(value);
  if (!normalized) return value;
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

function TopSpending({ items, total, currency }: { items: { name: string; icon: string; total: number }[]; total: number; currency: SupportedCurrency }) {
  const top = items.slice(0, 5);
  return <div className="space-y-4"><div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">{top.map((item) => <span key={item.name} style={{ ...categoryStyle(item.icon), flexGrow: item.total }} className="cat-fill min-w-1 rounded-full" />)}</div><ul className="space-y-2.5">{top.map((item) => <li key={item.name} className="flex items-center gap-3"><CategoryTile icon={item.icon} size="sm" /><span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{item.name}</span><span className="text-[11px] text-fg-subtle">{total > 0 ? Math.round((item.total / total) * 100) : 0}%</span><span className="w-20 shrink-0 text-right font-money text-[13px] font-semibold text-fg">{formatMoney(item.total, currency, { compact: true })}</span></li>)}</ul></div>;
}

function MonthStat({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: "positive" | "negative" | "neutral" }) {
  return <div className="min-w-0 rounded-2xl border border-line bg-glass-hover p-2.5 sm:p-4"><span className={cn("flex h-6 w-6 items-center justify-center rounded-lg", tone === "positive" && "bg-positive/12 text-positive", tone === "negative" && "bg-danger/12 text-danger", tone === "neutral" && "bg-accent-3/12 text-accent-3")}>{icon}</span><p className="mt-2 text-[11px] font-medium text-fg-subtle">{label}</p><p className={cn("mt-0.5 truncate font-money text-sm font-semibold sm:text-base", tone === "positive" && "text-positive", tone === "negative" && "text-danger", tone === "neutral" && "text-fg")}>{value}</p></div>;
}

function EmptyChart() {
  const bars = [38, 55, 30, 62, 45, 70];
  return <div className="relative"><div className="flex h-40 items-end justify-between gap-3 px-1" aria-hidden="true">{bars.map((height, index) => <div key={index} className="flex flex-1 items-end justify-center gap-1"><span className="w-full max-w-4 rounded-t-md bg-line-strong" style={{ height: `${height}%` }} /><span className="w-full max-w-4 rounded-t-md bg-line" style={{ height: `${height * 0.7}%` }} /></div>)}</div><div className="absolute inset-0 flex flex-col items-center justify-center"><span className="glass flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-fg-muted"><BarChart3 className="h-3.5 w-3.5 text-accent" />Your trend appears after a few transactions</span></div></div>;
}

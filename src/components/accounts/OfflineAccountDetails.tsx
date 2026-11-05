"use client";

import React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownLeft, ArrowUpRight, Landmark } from "lucide-react";
import { TransactionHistory } from "@/components/transactions/TransactionHistory";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import { offlineDb } from "@/lib/offline/db";
import { useOfflineRefresh } from "@/lib/offline/useOfflineRefresh";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import {
  normalizeTransactionDate,
  transactionSortValue,
  type TransactionCategoryOption,
  type TransactionRecord,
  type TransactionType,
} from "@/lib/transactions";

export interface OfflineAccountDetailsAccount {
  id: string;
  name: string;
  opening_balance: number | string | null;
  currency: string | null;
}

function isTransactionType(value: string): value is TransactionType {
  return value === "income" || value === "expense";
}

export function OfflineAccountDetails({
  ownerId,
  account: serverAccount,
  transactions: serverTransactions,
  categories: serverCategories,
  fallbackCurrency,
}: {
  ownerId: string;
  account: OfflineAccountDetailsAccount;
  transactions: TransactionRecord[];
  categories: TransactionCategoryOption[];
  fallbackCurrency: SupportedCurrency;
}) {
  const serverVersion = [
    serverAccount.id,
    serverAccount.name,
    serverAccount.opening_balance,
    ...serverTransactions.map(
      (transaction) =>
        `${transaction.id}:${transaction.updated_at ?? transaction.created_at}:${transaction.amount}`
    ),
  ].join("|");

  useOfflineRefresh(ownerId, serverVersion, "the offline account details");

  const localSnapshot = useLiveQuery(async () => {
    const meta = await offlineDb.syncMeta.get(ownerId);
    if (!meta?.totalsMatch) return null;

    const [account, transactionRows, categoryRows] = await Promise.all([
      offlineDb.accounts.get([ownerId, serverAccount.id]),
      offlineDb.transactions
        .where("[ownerId+account_id]")
        .equals([ownerId, serverAccount.id])
        .toArray(),
      offlineDb.categories.where("ownerId").equals(ownerId).toArray(),
    ]);
    if (!account || account.deleted_at) return null;

    const categories = categoryRows.flatMap<TransactionCategoryOption>((category) =>
      isTransactionType(category.type)
        ? [
            {
              id: category.id,
              name: category.name,
              type: category.type,
              icon: category.icon,
              is_default: category.is_default,
            },
          ]
        : []
    );
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const transactions = transactionRows
      .flatMap<TransactionRecord>((transaction) => {
        if (!isTransactionType(transaction.type)) return [];
        const category = categoryById.get(transaction.category_id);
        return [
          {
            id: transaction.id,
            account_id: transaction.account_id,
            category_id: transaction.category_id,
            type: transaction.type,
            amount: transaction.amount,
            description: transaction.description,
            transaction_date: normalizeTransactionDate(transaction.transaction_date),
            transaction_time: transaction.transaction_time,
            created_at: transaction.created_at,
            updated_at: transaction.updated_at,
            category: category
              ? { id: category.id, name: category.name, icon: category.icon }
              : null,
          },
        ];
      })
      .sort((left, right) => transactionSortValue(right).localeCompare(transactionSortValue(left)));

    return {
      account: {
        id: account.id,
        name: account.name,
        opening_balance: account.opening_balance,
        currency: account.currency,
      },
      transactions,
      categories,
    };
  }, [ownerId, serverAccount.id]);

  const account = localSnapshot?.account ?? serverAccount;
  const transactions = localSnapshot?.transactions ?? serverTransactions;
  const categories = localSnapshot?.categories ?? serverCategories;
  const totalIncome = transactions.reduce(
    (sum, transaction) =>
      transaction.type === "income" ? sum + (Number(transaction.amount) || 0) : sum,
    0
  );
  const totalExpense = transactions.reduce(
    (sum, transaction) =>
      transaction.type === "expense" ? sum + (Number(transaction.amount) || 0) : sum,
    0
  );
  const openingBalance = Number(account.opening_balance) || 0;
  const currentBalance = openingBalance + totalIncome - totalExpense;
  const currency = (account.currency as SupportedCurrency) || fallbackCurrency;

  return (
    <div className="space-y-4 sm:space-y-6">
      <section className="glass-strong glass-edge animate-rise overflow-hidden rounded-3xl p-4 sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,var(--aurora-1),transparent_70%)]" />

        <div className="relative flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
            <Landmark className="h-4 w-4 text-accent" /> Current balance
          </span>
          <span className="rounded-full border border-line bg-glass-hover px-2.5 py-0.5 font-mono text-[11px] font-semibold text-fg-muted">
            {currency}
          </span>
        </div>
        <p
          className={cn(
            "relative mt-3 font-money text-[30px] font-bold leading-none tracking-tight sm:text-5xl",
            currentBalance > 0 ? "text-positive" : currentBalance < 0 ? "text-danger" : "text-fg"
          )}
        >
          {formatMoney(currentBalance, currency)}
        </p>
        <p className="relative mt-2 text-xs text-fg-subtle">
          Opening <span className="font-money font-semibold">{formatMoney(openingBalance, currency)}</span>
          {" · "}
          {transactions.length} transaction{transactions.length === 1 ? "" : "s"}
        </p>

        <dl className="relative mt-5 grid grid-cols-2 gap-2 sm:mt-6 sm:gap-3">
          <SummaryMetric
            label="Income"
            value={formatMoney(totalIncome, currency)}
            tone="positive"
            icon={<ArrowDownLeft className="h-3.5 w-3.5" />}
          />
          <SummaryMetric
            label="Expenses"
            value={formatMoney(totalExpense, currency)}
            tone="negative"
            icon={<ArrowUpRight className="h-3.5 w-3.5" />}
          />
        </dl>
      </section>

      <Card title="Activity" bodyClassName="pt-3">
        <TransactionHistory transactions={transactions} currency={currency} categories={categories} />
      </Card>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: "positive" | "negative";
  icon: React.ReactNode;
}) {
  const positive = tone === "positive";
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-glass-hover p-3 sm:p-4">
      <dt className="flex items-center gap-2 text-[11px] font-medium text-fg-subtle">
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-lg",
            positive ? "bg-positive/12 text-positive" : "bg-danger/12 text-danger"
          )}
        >
          {icon}
        </span>
        {label}
      </dt>
      <dd
        className={cn(
          "mt-2 truncate font-money text-base font-bold sm:text-lg",
          positive ? "text-positive" : "text-danger"
        )}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}


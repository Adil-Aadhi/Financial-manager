"use client";

import React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Landmark } from "lucide-react";
import { TransactionHistory } from "@/components/transactions/TransactionHistory";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionRefreshIndicator } from "@/components/ui/SectionRefreshIndicator";
import { cn } from "@/lib/cn";
import { managedTransactions, type ManagedTransactionInfo } from "@/lib/installments";
import { formatMoney } from "@/lib/format";
import { offlineDb } from "@/lib/offline/db";
import { useOfflineRefresh } from "@/lib/offline/useOfflineRefresh";
import { useLocalContentMark } from "@/lib/perf";
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
  /** Read from this device's copy; archived accounts take no new transactions. */
  archived_at?: string | null;
}

function isTransactionType(value: string): value is TransactionType {
  return value === "income" || value === "expense";
}

export function OfflineAccountDetails({
  ownerId,
  account: serverAccount,
  transactions: serverTransactions,
  categories: serverCategories,
  managedTransactions: serverManaged = [],
  fallbackCurrency,
  serverMissing = false,
}: {
  ownerId: string;
  account: OfflineAccountDetailsAccount;
  transactions: TransactionRecord[];
  categories: TransactionCategoryOption[];
  /** Installment-generated expenses (read only here; changed from the Installments page). */
  managedTransactions?: ManagedTransactionInfo[];
  fallbackCurrency: SupportedCurrency;
  /** The server has no such account (e.g. created offline, not synced yet): show only the local copy. */
  serverMissing?: boolean;
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

    const [account, transactionRows, categoryRows, installmentPayments, installmentPlans] = await Promise.all([
      offlineDb.accounts.get([ownerId, serverAccount.id]),
      offlineDb.transactions
        .where("[ownerId+account_id]")
        .equals([ownerId, serverAccount.id])
        .toArray(),
      offlineDb.categories.where("ownerId").equals(ownerId).toArray(),
      offlineDb.installmentPayments.where("ownerId").equals(ownerId).toArray(),
      offlineDb.installmentPlans.where("ownerId").equals(ownerId).toArray(),
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
            transaction_date:
              normalizeTransactionDate(transaction.transaction_date) ??
              transaction.transaction_date,
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
        archived_at: account.archived_at ?? null,
      },
      transactions,
      categories,
      managed: managedTransactions(installmentPayments, installmentPlans),
    };
  }, [ownerId, serverAccount.id]);
  useLocalContentMark(localSnapshot != null); // TEMPORARY perf (Step 3 Phase 0)

  if (serverMissing && !localSnapshot) {
    // undefined: still reading IndexedDB. null: this device doesn't have the account either.
    return localSnapshot === undefined ? (
      <div className="glass-strong glass-edge h-40 animate-pulse rounded-3xl" aria-hidden="true" />
    ) : (
      <EmptyState
        icon={<Landmark className="h-5 w-5" />}
        title="Account not found"
        description="It may have been deleted, or it hasn't reached this device yet."
      />
    );
  }

  const account = localSnapshot?.account ?? serverAccount;
  const transactions = localSnapshot?.transactions ?? serverTransactions;
  const managed = localSnapshot?.managed ?? new Map(serverManaged.map((info) => [info.transactionId, info]));
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
      {account.archived_at && (
        <Alert variant="info" title="Archived account">
          Its balance and history still count on Home and Reports, but new transactions can&apos;t be added.{" "}
          <Link href="/accounts/archived" className="font-semibold text-accent hover:text-accent-strong">
            Unarchive it
          </Link>{" "}
          to use it again.
        </Alert>
      )}
      <section className="glass-strong glass-edge relative animate-rise overflow-hidden rounded-3xl p-4 sm:p-7">
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
        <SectionRefreshIndicator scope={["accounts", "transactions", "installments"]} className="absolute right-4 top-14 sm:right-7 sm:top-16" />

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
        <TransactionHistory transactions={transactions} currency={currency} categories={categories} managed={managed} />
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


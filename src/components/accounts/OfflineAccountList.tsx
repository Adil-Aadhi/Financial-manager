"use client";

import React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Landmark } from "lucide-react";
import { AccountList, type AccountListItem } from "@/components/accounts/AccountList";
import { EmptyState } from "@/components/ui/EmptyState";
import { offlineDb } from "@/lib/offline/db";
import { useOfflineRefresh } from "@/lib/offline/useOfflineRefresh";
import type { SupportedCurrency } from "@/lib/supabase/profile";

export function OfflineAccountList({
  ownerId,
  serverAccounts,
  fallbackCurrency,
  actionsEnabled,
}: {
  ownerId: string;
  serverAccounts: AccountListItem[];
  fallbackCurrency: SupportedCurrency;
  actionsEnabled: boolean;
}) {
  const serverVersion = serverAccounts
    .map(
      (account) =>
        `${account.id}:${account.name}:${account.opening_balance}:${account.total_income}:${account.total_expense}`
    )
    .join("|");

  useOfflineRefresh(ownerId, serverVersion, "the offline account list");

  const localAccounts = useLiveQuery(async () => {
    const meta = await offlineDb.syncMeta.get(ownerId);
    if (!meta?.totalsMatch) return null;

    const [accounts, transactions] = await Promise.all([
      offlineDb.accounts.where("ownerId").equals(ownerId).toArray(),
      offlineDb.transactions.where("ownerId").equals(ownerId).toArray(),
    ]);
    const totalsByAccount = new Map<string, { income: number; expense: number }>();
    for (const transaction of transactions) {
      const current = totalsByAccount.get(transaction.account_id) ?? { income: 0, expense: 0 };
      const amount = Number(transaction.amount) || 0;
      if (transaction.type === "income") current.income += amount;
      if (transaction.type === "expense") current.expense += amount;
      totalsByAccount.set(transaction.account_id, current);
    }

    return accounts
      .filter((account) => !account.deleted_at)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map<AccountListItem>((account) => ({
        id: account.id,
        name: account.name,
        opening_balance: account.opening_balance,
        currency: account.currency,
        total_income: totalsByAccount.get(account.id)?.income ?? 0,
        total_expense: totalsByAccount.get(account.id)?.expense ?? 0,
      }));
  }, [ownerId]);

  const accounts = localAccounts ?? serverAccounts;
  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={<Landmark className="h-5 w-5" />}
        title="No accounts yet"
        description="Add an account before recording transactions."
      />
    );
  }

  return (
    <AccountList
      accounts={accounts}
      fallbackCurrency={fallbackCurrency}
      actionsEnabled={actionsEnabled}
    />
  );
}


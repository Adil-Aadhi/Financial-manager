"use client";

import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Landmark } from "lucide-react";
import { AccountList, type AccountListItem } from "@/components/accounts/AccountList";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  ACCOUNT_GROUP_LABELS,
  ACCOUNT_GROUPS,
  normalizeAccountGroup,
  type AccountGroup,
} from "@/lib/accounts";
import { normalizeIncludeInSummary } from "@/lib/accountSummary";
import { cn } from "@/lib/cn";
import { offlineDb } from "@/lib/offline/db";
import { useOfflineRefresh } from "@/lib/offline/useOfflineRefresh";
import { useLocalContentMark } from "@/lib/perf";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { clearCardOrder } from "@/lib/transactionCardOrder";

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
  const [activeGroup, setActiveGroup] = useState<AccountGroup>("primary");
  const [hasCustomOrder, setHasCustomOrder] = useState(false);

  const handleResetOrder = () => {
    clearCardOrder(ownerId);
    setHasCustomOrder(false);
  };

  const serverVersion = serverAccounts
    .map(
      (account) =>
        `${account.id}:${account.name}:${account.opening_balance}:${normalizeAccountGroup(account.account_group)}:${normalizeIncludeInSummary(account.include_in_summary)}:${account.total_income}:${account.total_expense}`
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
        account_group: normalizeAccountGroup(account.account_group),
        include_in_summary: normalizeIncludeInSummary(account.include_in_summary),
        total_income: totalsByAccount.get(account.id)?.income ?? 0,
        total_expense: totalsByAccount.get(account.id)?.expense ?? 0,
      }));
  }, [ownerId]);
  useLocalContentMark(localAccounts != null); // TEMPORARY perf (Step 3 Phase 0)

  const accounts = localAccounts ?? serverAccounts;
  // Every account has exactly one group (missing = General), so each appears in exactly one tab.
  const counts: Record<AccountGroup, number> = { primary: 0, general: 0 };
  for (const account of accounts) counts[normalizeAccountGroup(account.account_group)] += 1;
  const visibleAccounts = accounts.filter(
    (account) => normalizeAccountGroup(account.account_group) === activeGroup
  );

  return (
    <>
      {/* Sits directly under the page header's Add Account button (right-aligned from sm up). */}
      <div className="-mt-1 flex sm:-mt-3 sm:justify-end">
      <div
        role="tablist"
        aria-label="Account group"
        className="glass-track grid w-full grid-cols-2 gap-1 rounded-full p-1 sm:w-auto sm:min-w-64"
      >
        {ACCOUNT_GROUPS.map((group) => {
          const active = activeGroup === group;
          return (
            <button
              key={group}
              type="button"
              role="tab"
              id={`account-group-tab-${group}`}
              aria-selected={active}
              aria-controls="account-group-panel"
              onClick={() => setActiveGroup(group)}
              className={cn(
                "flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full text-xs font-semibold transition-all duration-200",
                active ? "glass text-fg" : "text-fg-subtle hover:text-fg"
              )}
            >
              {ACCOUNT_GROUP_LABELS[group]}
              <span
                className={cn(
                  "rounded-full px-1.5 py-px font-mono text-[10px]",
                  active ? "bg-accent/12 text-accent" : "bg-glass-hover"
                )}
              >
                {counts[group]}
              </span>
            </button>
          );
        })}
      </div>
      </div>

      <Card
        title="Accounts"
        description="Balances are calculated from transaction history."
        bodyClassName="pt-2"
        action={
          hasCustomOrder ? (
            <button
              type="button"
              onClick={handleResetOrder}
              className="cursor-pointer rounded-lg px-2.5 py-1 text-xs font-semibold text-fg-subtle transition-colors hover:bg-glass-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              title="Reset card arrangement to default"
            >
              Reset to default
            </button>
          ) : null
        }
      >
        <div id="account-group-panel" role="tabpanel" aria-labelledby={`account-group-tab-${activeGroup}`}>
          {visibleAccounts.length === 0 ? (
            <EmptyState
              icon={<Landmark className="h-5 w-5" />}
              title={
                accounts.length === 0 ? "No accounts yet" : `No ${ACCOUNT_GROUP_LABELS[activeGroup]} accounts`
              }
              description={
                accounts.length === 0
                  ? "Add an account before recording transactions."
                  : `Edit an account and choose ${ACCOUNT_GROUP_LABELS[activeGroup]} to show it here.`
              }
            />
          ) : (
            <AccountList
              accounts={visibleAccounts}
              ownerId={ownerId}
              fallbackCurrency={fallbackCurrency}
              actionsEnabled={actionsEnabled}
              // Follow an account that was moved, so it stays in view after the edit.
              onAccountSaved={setActiveGroup}
              onCustomOrderChange={setHasCustomOrder}
            />
          )}
        </div>
      </Card>
    </>
  );
}

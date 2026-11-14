"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Archive, ArchiveRestore, ChevronRight } from "lucide-react";
import { changeAccountArchived } from "@/components/accounts/archiveAccount";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import { isAccountArchived } from "@/lib/accounts";
import { offlineDb } from "@/lib/offline/db";
import { useOfflineRefresh } from "@/lib/offline/useOfflineRefresh";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";
import type { SupportedCurrency } from "@/lib/supabase/profile";

export interface ArchivedAccountItem {
  id: string;
  name: string;
  currency: string | null;
  archived_at: string;
  balance: number;
  transactionCount: number;
}

/** Archived accounts with their balance; renders from this device's copy when it has one. */
export function ArchivedAccountList({
  ownerId,
  serverAccounts,
  fallbackCurrency,
  timeZone,
}: {
  ownerId: string;
  serverAccounts: ArchivedAccountItem[];
  fallbackCurrency: SupportedCurrency;
  timeZone: string;
}) {
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useOfflineRefresh(
    ownerId,
    serverAccounts.map((account) => `${account.id}:${account.archived_at}:${account.balance}`).join("|"),
    "archived accounts"
  );

  const localAccounts = useLiveQuery(async () => {
    const meta = await offlineDb.syncMeta.get(ownerId);
    if (!meta?.totalsMatch) return null;
    const [accounts, transactions] = await Promise.all([
      offlineDb.accounts.where("ownerId").equals(ownerId).toArray(),
      offlineDb.transactions.where("ownerId").equals(ownerId).toArray(),
    ]);
    const archived = accounts.filter((account) => !account.deleted_at && isAccountArchived(account));
    const ids = new Set(archived.map((account) => account.id));
    const totals = new Map<string, { net: number; count: number }>();
    for (const transaction of transactions) {
      if (!ids.has(transaction.account_id)) continue;
      const entry = totals.get(transaction.account_id) ?? { net: 0, count: 0 };
      const amount = Number(transaction.amount) || 0;
      if (transaction.type === "income") entry.net += amount;
      if (transaction.type === "expense") entry.net -= amount;
      entry.count += 1;
      totals.set(transaction.account_id, entry);
    }
    return archived
      .map<ArchivedAccountItem>((account) => ({
        id: account.id,
        name: account.name,
        currency: account.currency,
        archived_at: account.archived_at!,
        balance: (Number(account.opening_balance) || 0) + (totals.get(account.id)?.net ?? 0),
        transactionCount: totals.get(account.id)?.count ?? 0,
      }))
      .sort((left, right) => right.archived_at.localeCompare(left.archived_at));
  }, [ownerId]);

  const accounts = localAccounts ?? serverAccounts;

  const unarchive = (accountId: string) => {
    setError(null);
    setWorkingId(accountId);
    startTransition(async () => {
      const result = await changeAccountArchived(accountId, false);
      setWorkingId(null);
      if (!result.success) {
        setError(result.error || "Unable to unarchive this account.");
        return;
      }
      if (!result.queued) router.refresh();
    });
  };

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={<Archive className="h-5 w-5" />}
        title="No archived accounts"
        description="Archive an account from its Edit sheet on the Transactions page to hide it there."
        className="py-10"
      />
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {!isOnline && (
        <Alert variant="info">You are offline. Unarchived accounts are saved on this device and sync later.</Alert>
      )}

      {accounts.map((account) => {
        const currency = (account.currency as SupportedCurrency) || fallbackCurrency;
        const archivedOn = new Date(account.archived_at).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone,
        });
        return (
          <div
            key={account.id}
            className="flex flex-col gap-3 rounded-2xl border border-line bg-glass-hover p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <Link
              href={`/accounts/${account.id}`}
              className="group flex min-w-0 flex-1 items-start gap-3.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-glass-input text-fg-subtle">
                <Archive className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 truncate text-base font-semibold text-fg">
                  <span className="truncate">{account.name}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
                </p>
                <p
                  className={cn(
                    "mt-0.5 font-money text-sm font-semibold",
                    account.balance > 0 ? "text-positive" : account.balance < 0 ? "text-danger" : "text-fg"
                  )}
                >
                  {formatMoney(account.balance, currency)}
                </p>
                <p className="mt-1 text-xs text-fg-subtle">
                  Archived {archivedOn} · {account.transactionCount} transaction
                  {account.transactionCount === 1 ? "" : "s"}
                </p>
              </div>
            </Link>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<ArchiveRestore className="h-3.5 w-3.5" />}
              isLoading={isPending && workingId === account.id}
              disabled={isPending}
              onClick={() => unarchive(account.id)}
              className="w-full shrink-0 sm:w-auto"
            >
              Unarchive
            </Button>
          </div>
        );
      })}
    </div>
  );
}

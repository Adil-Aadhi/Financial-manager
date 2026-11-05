"use client";

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AccountTrashList,
  type TrashedAccountListItem,
} from "@/components/accounts/AccountTrashList";
import { ensureOfflineBootstrap } from "@/lib/offline/bootstrap";
import { offlineDb } from "@/lib/offline/db";
import type { SupportedCurrency } from "@/lib/supabase/profile";

export function OfflineAccountTrashList({
  ownerId,
  serverAccounts,
  fallbackCurrency,
  timeZone,
}: {
  ownerId: string;
  serverAccounts: TrashedAccountListItem[];
  fallbackCurrency: SupportedCurrency;
  timeZone: string;
}) {
  const serverVersion = serverAccounts
    .map((account) => `${account.id}:${account.deleted_at}`)
    .join("|");

  useEffect(() => {
    if (!navigator.onLine) return;
    void ensureOfflineBootstrap(ownerId, true).catch((error: unknown) => {
      console.warn(
        "Unable to refresh offline Trash:",
        error instanceof Error ? error.message : error
      );
    });
  }, [ownerId, serverVersion]);

  const localAccounts = useLiveQuery(async () => {
    const meta = await offlineDb.syncMeta.get(ownerId);
    if (!meta?.totalsMatch) return null;

    const [rows, profile] = await Promise.all([
      offlineDb.accounts.where("ownerId").equals(ownerId).toArray(),
      offlineDb.profiles.get(ownerId),
    ]);
    const localCurrency = isSupportedCurrency(profile?.default_currency)
      ? profile.default_currency
      : fallbackCurrency;
    const accounts = rows
      .flatMap<TrashedAccountListItem>((account) =>
        account.deleted_at
          ? [
              {
                id: account.id,
                name: account.name,
                opening_balance: account.opening_balance,
                currency: account.currency,
                deleted_at: account.deleted_at,
              },
            ]
          : []
      )
      .sort((left, right) => right.deleted_at.localeCompare(left.deleted_at));
    return { accounts, currency: localCurrency };
  }, [ownerId]);

  return (
    <AccountTrashList
      accounts={localAccounts?.accounts ?? serverAccounts}
      fallbackCurrency={localAccounts?.currency ?? fallbackCurrency}
      timeZone={timeZone}
    />
  );
}

function isSupportedCurrency(value: string | null | undefined): value is SupportedCurrency {
  return value === "INR" || value === "USD" || value === "AED";
}

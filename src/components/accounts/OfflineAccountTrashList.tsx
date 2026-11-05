"use client";

import { useLiveQuery } from "dexie-react-hooks";
import {
  AccountTrashList,
  type TrashedAccountListItem,
} from "@/components/accounts/AccountTrashList";
import { offlineDb } from "@/lib/offline/db";
import { useOfflineRefresh } from "@/lib/offline/useOfflineRefresh";
import { useLocalContentMark } from "@/lib/perf";
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

  useOfflineRefresh(ownerId, serverVersion, "offline Trash");

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
  useLocalContentMark(localAccounts != null); // TEMPORARY perf (Step 3 Phase 0)

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

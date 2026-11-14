"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { INSTALLMENT_CATEGORY_NAME } from "@/lib/installments";
import { offlineDb } from "@/lib/offline/db";
import { useOfflineRefresh } from "@/lib/offline/useOfflineRefresh";
import type { InstallmentsServerData } from "@/lib/supabase/installments";
import { normalizeTransactionDate } from "@/lib/transactions";
import { useIndiaToday } from "@/lib/useIndiaToday";

/**
 * Installments read model: the device's IndexedDB copy once a complete snapshot exists (so the
 * module works offline and shows pending local changes), otherwise the server-rendered data.
 * Accounts, transactions and categories are read only here, for payment selection and history.
 */
export function useInstallmentsData(ownerId: string, server: InstallmentsServerData) {
  const version = [
    server.available,
    ...server.plans.map((plan) => `${plan.id}:${plan.lifecycle}:${plan.updated_at ?? ""}`),
    ...server.payments.map((payment) => `${payment.id}:${payment.actual_amount}:${payment.updated_at ?? ""}`),
  ].join("|");
  useOfflineRefresh(ownerId, version, "installments");

  const local = useLiveQuery(async () => {
    const meta = await offlineDb.syncMeta.get(ownerId);
    if (!meta?.totalsMatch || meta.installmentsAvailable === undefined) return null;
    const [plans, payments, accounts, transactions, categories] = await Promise.all([
      offlineDb.installmentPlans.where("ownerId").equals(ownerId).toArray(),
      offlineDb.installmentPayments.where("ownerId").equals(ownerId).toArray(),
      offlineDb.accounts.where("ownerId").equals(ownerId).toArray(),
      offlineDb.transactions.where("ownerId").equals(ownerId).filter((transaction) => transaction.type === "expense").toArray(),
      offlineDb.categories.where("ownerId").equals(ownerId).toArray(),
    ]);
    return {
      available: meta.installmentsAvailable,
      plans,
      payments,
      accounts: accounts
        .map((account) => ({
          id: account.id,
          name: account.name,
          currency: account.currency,
          deleted_at: account.deleted_at,
          archived_at: account.archived_at ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      transactions: transactions.map((transaction) => ({
        id: transaction.id,
        account_id: transaction.account_id,
        category_id: transaction.category_id,
        type: transaction.type,
        amount: transaction.amount,
        description: transaction.description,
        transaction_date: normalizeTransactionDate(transaction.transaction_date) ?? transaction.transaction_date,
        transaction_time: transaction.transaction_time,
      })),
      categoryAvailable: categories.some(
        (category) =>
          category.is_default && category.type === "expense" && category.name.trim().toLowerCase() === INSTALLMENT_CATEGORY_NAME.toLowerCase()
      ),
    };
  }, [ownerId]);

  return local ? { source: "local" as const, ...local } : { source: "server" as const, ...server };
}

export type InstallmentsData = ReturnType<typeof useInstallmentsData>;

/** Today in the India calendar, refreshed every minute and when the app returns to the foreground. */
export function useInstallmentToday(initial: string) {
  return useIndiaToday(initial);
}

const LAST_ACCOUNT_KEY = "ft:installments:last-account:";

/** The last account used for an installment payment: only a convenient default. */
export function readLastInstallmentAccount(ownerId: string) {
  try {
    return window.localStorage.getItem(LAST_ACCOUNT_KEY + ownerId);
  } catch {
    return null;
  }
}

export function rememberInstallmentAccount(ownerId: string, accountId: string) {
  try {
    window.localStorage.setItem(LAST_ACCOUNT_KEY + ownerId, accountId);
  } catch {
    // Private mode or blocked storage: the default just isn't remembered.
  }
}

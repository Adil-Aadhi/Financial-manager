import "client-only";

import { offlineDb } from "@/lib/offline/db";
import { ledgerTableList } from "@/lib/offline/ledgerTables";

const PRIVATE_CACHE_CLEAR_TIMEOUT_MS = 5_000;
const PRIVATE_CACHE_NAME = "account-tracker-private-v1";

async function deletePrivateCacheDirectly() {
  if ("caches" in window) await window.caches.delete(PRIVATE_CACHE_NAME);
}

/** Clears warmed authenticated routes and waits for the worker to finish when possible. */
export async function clearPrivateRouteCache() {
  if (!("serviceWorker" in navigator)) return;

  let worker = navigator.serviceWorker.controller;
  if (!worker) {
    const registration = await Promise.race([
      navigator.serviceWorker.ready.catch(() => null),
      new Promise<null>((resolve) =>
        window.setTimeout(() => resolve(null), PRIVATE_CACHE_CLEAR_TIMEOUT_MS)
      ),
    ]);
    worker = registration?.active ?? null;
  }
  if (!worker) {
    await deletePrivateCacheDirectly();
    return;
  }

  try {
    const acknowledged = await new Promise<boolean>((resolve) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(
        () => resolve(false),
        PRIVATE_CACHE_CLEAR_TIMEOUT_MS
      );
      channel.port1.onmessage = () => {
        window.clearTimeout(timeout);
        resolve(true);
      };
      worker.postMessage({ type: "CLEAR_PRIVATE_ROUTES" }, [channel.port2]);
    });
    if (!acknowledged) await deletePrivateCacheDirectly();
  } catch {
    // A stale controller can reject postMessage during a worker update. Delete the named cache
    // directly so privacy cleanup still completes and sign-out navigation is not interrupted.
    await deletePrivateCacheDirectly();
  }
}

/** Removes exactly one owner's local copy. Only call after an explicit destructive choice. */
export async function removeLocalOwnerData(ownerId: string) {
  await offlineDb.transaction(
    "rw",
    [
      offlineDb.profiles,
      offlineDb.accounts,
      offlineDb.categories,
      offlineDb.transactions,
      offlineDb.monthlyBudgets,
      offlineDb.dailyBudgetLimits,
      offlineDb.dailyBudgetExpenses,
      offlineDb.subscriptions,
      offlineDb.subscriptionPayments,
      offlineDb.bills,
      offlineDb.billPayments,
      offlineDb.installmentPlans,
      offlineDb.installmentPayments,
      ...ledgerTableList(),
      offlineDb.syncMeta,
      offlineDb.outbox,
      offlineDb.syncConflicts,
    ],
    async () => {
      await Promise.all([
        offlineDb.profiles.delete(ownerId),
        offlineDb.accounts.where("ownerId").equals(ownerId).delete(),
        offlineDb.categories.where("ownerId").equals(ownerId).delete(),
        offlineDb.transactions.where("ownerId").equals(ownerId).delete(),
        offlineDb.monthlyBudgets.delete(ownerId),
        offlineDb.dailyBudgetLimits.where("ownerId").equals(ownerId).delete(),
        offlineDb.dailyBudgetExpenses.where("ownerId").equals(ownerId).delete(),
        offlineDb.subscriptions.where("ownerId").equals(ownerId).delete(),
        offlineDb.subscriptionPayments.where("ownerId").equals(ownerId).delete(),
        offlineDb.bills.where("ownerId").equals(ownerId).delete(),
        offlineDb.billPayments.where("ownerId").equals(ownerId).delete(),
        offlineDb.installmentPlans.where("ownerId").equals(ownerId).delete(),
        offlineDb.installmentPayments.where("ownerId").equals(ownerId).delete(),
        ...ledgerTableList().map((table) => table.where("ownerId").equals(ownerId).delete()),
        offlineDb.syncMeta.delete(ownerId),
        offlineDb.outbox.where("ownerId").equals(ownerId).delete(),
        offlineDb.syncConflicts.where("ownerId").equals(ownerId).delete(),
      ]);
    }
  );
}

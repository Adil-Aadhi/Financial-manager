import "client-only";

import { offlineDb } from "@/lib/offline/db";

const PRIVATE_CACHE_CLEAR_TIMEOUT_MS = 5_000;

/** Clears warmed authenticated routes and waits for the worker to finish when possible. */
export async function clearPrivateRouteCache() {
  if (!("serviceWorker" in navigator)) return;

  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const worker = navigator.serviceWorker.controller ?? registration?.active;
  if (!worker) return;

  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(resolve, PRIVATE_CACHE_CLEAR_TIMEOUT_MS);
    channel.port1.onmessage = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    worker.postMessage({ type: "CLEAR_PRIVATE_ROUTES" }, [channel.port2]);
  });
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
        offlineDb.syncMeta.delete(ownerId),
        offlineDb.outbox.where("ownerId").equals(ownerId).delete(),
        offlineDb.syncConflicts.where("ownerId").equals(ownerId).delete(),
      ]);
    }
  );
}

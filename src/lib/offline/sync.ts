import "client-only";

import { useSyncExternalStore } from "react";
import { syncOutboxAction } from "@/app/actions/sync";
import { getActiveOwnerId, subscribeActiveOwner } from "@/lib/offline/activeOwner";
import { ensureOfflineBootstrap } from "@/lib/offline/bootstrap";
import { offlineDb, type OutboxEntry } from "@/lib/offline/db";
import { describeChange } from "@/lib/offline/describeChange";
import { OUTBOX_CHANGED_EVENT } from "@/lib/offline/events";
import { selectRunnableEntries } from "@/lib/offline/queuePolicy";
import { isLedgerEntity } from "@/lib/ledger";
import { ledgerTableFor, ledgerTableList } from "@/lib/offline/ledgerTables";
import { SYNC_BATCH_SIZE, type SyncBatchResponse, type SyncOperation, type SyncOpResult } from "@/lib/sync/types";
import { normalizeTransactionDate } from "@/lib/transactions";

/**
 * Offline sync engine (Phase 2). Replays the signed-in user's outbox to Supabase in `seq`
 * order through syncOutboxAction, and is the only code that removes outbox entries, each one
 * only after the server reports it applied (or already applied).
 *
 * - One run at a time per device: Web Locks across tabs, plus an in-tab guard (the fallback
 *   when Web Locks is unavailable). Resending is harmless, see runSyncBatch.
 * - A rejected change remains visible and durable. Only operations that depend on it wait;
 *   independent records continue without violating record/reference ordering.
 * - Temporary failures back off 5s → 10s → … capped at 5 minutes, only while visible.
 * - Entries left "syncing" by a closed app go back to "pending" on the next run.
 * - When the outbox is empty after sending something, the normal forced snapshot refresh runs;
 *   its own guard still protects any change saved while syncing.
 */

export type SyncPhase =
  | "idle"
  | "syncing"
  | "synced"
  | "offline"
  | "waiting-retry"
  | "paused-auth"
  | "paused-failed";

export interface SyncState {
  phase: SyncPhase;
  lastSyncedAt: number | null;
  nextRetryAt: number | null;
  message: string | null;
}

const LOCK_NAME = "account-tracker-outbox-sync";
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/** Server-side temporary errors become "failed" (shown to the user) after this many tries. */
const MAX_SERVER_RETRIES = 8;

let state: SyncState = { phase: "idle", lastSyncedAt: null, nextRetryAt: null, message: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let rerun = false;
let started = false;
/** Owners whose local copy must be refreshed once their outbox is empty (sync or discard). */
const refreshWhenDrained = new Set<string>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function getSyncState() {
  return state;
}

export function useSyncState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSyncState,
    getSyncState
  );
}

export function backoffMs(attempts: number) {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

/** Schedule a run; repeated calls collapse into one. */
export function requestSync(delayMs = 0) {
  if (typeof window === "undefined") return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (document.visibilityState === "hidden") return; // resumes on visibilitychange
    void syncNow();
  }, Math.max(0, delayMs));
}

/** Run now (the "Sync now" button). Concurrent calls in this tab coalesce into one more run. */
export async function syncNow() {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    do {
      rerun = false;
      await withDeviceLock(runSync);
    } while (rerun);
  } finally {
    running = false;
  }
}

async function withDeviceLock(work: () => Promise<void>) {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    // ifAvailable: if another tab is syncing, skip; it is processing the same outbox.
    await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (lock) await work();
    });
    return;
  }
  await work();
}

function toWire(entry: OutboxEntry): SyncOperation {
  return {
    opId: entry.opId,
    seq: entry.seq!,
    ownerId: entry.ownerId,
    entity: entry.entity,
    entityId: entry.entityId,
    op: entry.op,
    payload: entry.payload,
    transactionDateIntent: entry.transactionDateIntent,
    baseUpdatedAt: entry.baseUpdatedAt,
    editedAt: entry.updatedAt,
  };
}

async function runSync() {
  const ownerId = getActiveOwnerId();
  if (!ownerId) return;
  if (!navigator.onLine) {
    setState({ phase: "offline" });
    return;
  }

  await recoverInterrupted(ownerId);
  let sentSomething = false;

  for (;;) {
    const entries = await offlineDb.outbox.where("ownerId").equals(ownerId).sortBy("seq");
    if (entries.length === 0) {
      if (sentSomething || refreshWhenDrained.has(ownerId)) {
        refreshWhenDrained.delete(ownerId);
        setState({ phase: "synced", lastSyncedAt: Date.now(), nextRetryAt: null, message: null });
        await ensureOfflineBootstrap(ownerId, true).catch((error: unknown) => {
          console.warn("Snapshot refresh after sync failed:", error instanceof Error ? error.message : error);
        });
      } else if (state.phase !== "synced") {
        setState({ phase: "idle", nextRetryAt: null, message: null });
      }
      return;
    }

    const now = Date.now();
    const ready = selectRunnableEntries(entries, now, SYNC_BATCH_SIZE);
    if (ready.length === 0) {
      const nextRetryAt = entries.reduce<number | null>((soonest, entry) => {
        if (entry.status !== "pending" || !entry.nextAttemptAt || entry.nextAttemptAt <= now) {
          return soonest;
        }
        return soonest === null ? entry.nextAttemptAt : Math.min(soonest, entry.nextAttemptAt);
      }, null);
      if (nextRetryAt !== null) requestSync(nextRetryAt - now);
      setState({
        phase: entries.some((entry) => entry.status === "failed")
          ? "paused-failed"
          : "waiting-retry",
        nextRetryAt,
      });
      return;
    }

    setState({ phase: "syncing", message: null });
    const batch = await claim(ready);
    if (batch.length === 0) continue;

    let response: SyncBatchResponse;
    try {
      response = await syncOutboxAction(batch.map(toWire));
    } catch {
      // The request may or may not have reached the server; resending later is safe.
      const wait = backoffMs(batch[0].attempts);
      await release(batch, "Couldn't reach the server.", wait);
      setState({ phase: "waiting-retry", nextRetryAt: Date.now() + wait, message: "Couldn't reach the server." });
      requestSync(wait);
      return;
    }

    if (response.status === "auth" || response.status === "wrong-user") {
      await release(batch, response.error ?? null, 0);
      setState({ phase: "paused-auth", nextRetryAt: null, message: response.error ?? "Sign in again to sync." });
      return;
    }
    if (response.status === "invalid") {
      await settle(batch, [{ opId: batch[0].opId, status: "rejected", error: response.error ?? "This change is malformed." }]);
      continue;
    }

    const outcome = await settle(batch, response.results);
    sentSomething = true;
    if (outcome.retryAt !== null) {
      requestSync(outcome.retryAt - Date.now());
    }
  }
}

/** Entries a closed or crashed app left mid-send go back to pending (resending is safe). */
async function recoverInterrupted(ownerId: string) {
  await offlineDb.transaction("rw", offlineDb.outbox, async () => {
    const stuck = await offlineDb.outbox.where("[ownerId+status]").equals([ownerId, "syncing"]).toArray();
    for (const entry of stuck) await offlineDb.outbox.update(entry.seq!, { status: "pending" });
  });
}

/** Marks entries as syncing, skipping any that changed since they were read. */
async function claim(ready: OutboxEntry[]) {
  return offlineDb.transaction("rw", offlineDb.outbox, async () => {
    const claimed: OutboxEntry[] = [];
    for (const entry of ready) {
      const current = await offlineDb.outbox.get(entry.seq!);
      if (!current || current.opId !== entry.opId || current.status !== "pending") break; // keep order
      const next = { ...current, status: "syncing" as const, attempts: current.attempts + 1 };
      await offlineDb.outbox.put(next);
      claimed.push(next);
    }
    return claimed;
  });
}

/** Puts claimed entries back to pending, e.g. after a network failure. */
async function release(entries: OutboxEntry[], error: string | null, waitMs: number) {
  await offlineDb.transaction("rw", offlineDb.outbox, async () => {
    for (const entry of entries) {
      const current = await offlineDb.outbox.get(entry.seq!);
      if (!current || current.opId !== entry.opId || current.status !== "syncing") continue;
      await offlineDb.outbox.update(entry.seq!, {
        status: "pending",
        error,
        nextAttemptAt: waitMs > 0 ? Date.now() + waitMs : undefined,
      });
    }
  });
}

/** Applies the server's results to the outbox in one transaction. */
async function settle(batch: OutboxEntry[], results: SyncOpResult[]) {
  const byOp = new Map(results.map((result) => [result.opId, result]));
  const summaries = new Map<string, string>();
  for (const entry of batch) {
    if (byOp.get(entry.opId)?.conflict) summaries.set(entry.opId, await describeChange(entry));
  }

  let rejected = false;
  let retryAt: number | null = null;
  const tables = [
    offlineDb.outbox,
    offlineDb.syncConflicts,
    offlineDb.transactions,
    offlineDb.accounts,
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
  ];
  await offlineDb.transaction("rw", tables, async () => {
    for (const entry of batch) {
      const current = await offlineDb.outbox.get(entry.seq!);
      if (!current || current.opId !== entry.opId) continue;
      const result = byOp.get(entry.opId);

      if (!result) {
        // Not reached: the server stopped earlier in the batch.
        if (current.status === "syncing") await offlineDb.outbox.update(entry.seq!, { status: "pending" });
        continue;
      }

      if (result.status === "applied" || result.status === "already-applied") {
        await offlineDb.outbox.delete(entry.seq!);
        if (result.conflict) {
          await offlineDb.syncConflicts.add({
            ownerId: entry.ownerId,
            opId: entry.opId,
            entity: entry.entity,
            entityId: entry.entityId,
            op: entry.op,
            outcome: result.conflict.outcome,
            serverUpdatedAt: result.conflict.serverUpdatedAt,
            clientEditedAt: result.conflict.clientEditedAt,
            summary: summaries.get(entry.opId) ?? "A change",
            recordedAt: new Date().toISOString(),
          });
        }
        // Later queued changes to the same record now build on the server's current version.
        if (result.serverUpdatedAt !== undefined) {
          const later = await offlineDb.outbox
            .where("[ownerId+entity+entityId]")
            .equals([entry.ownerId, entry.entity, entry.entityId])
            .toArray();
          for (const next of later) {
            if (next.status === "pending") await offlineDb.outbox.update(next.seq!, { baseUpdatedAt: result.serverUpdatedAt });
          }
          // With nothing else queued for it, the local row now matches the server, so record the
          // server's updated_at. Otherwise the next offline edit would compare against the
          // device's old edit time and report a conflict that isn't one.
          if (later.length === 0 && result.serverUpdatedAt) {
            await recordServerVersion(entry, result.serverUpdatedAt);
          }
        }
        continue;
      }

      if (result.status === "rejected") {
        rejected = true;
        await offlineDb.outbox.update(entry.seq!, {
          status: "failed",
          error: result.error ?? "The server rejected this change.",
          reviewReason: result.reviewReason,
          nextAttemptAt: undefined,
        });
        if (
          result.reviewReason === "legacy-transaction-date" &&
          result.serverTransactionDate
        ) {
          const serverDate = normalizeTransactionDate(result.serverTransactionDate);
          if (serverDate) {
            await offlineDb.transactions.update(
              [entry.ownerId, entry.entityId],
              { transaction_date: serverDate }
            );
          }
        }
        continue;
      }

      // retry
      if (current.attempts >= MAX_SERVER_RETRIES) {
        rejected = true;
        await offlineDb.outbox.update(entry.seq!, {
          status: "failed",
          error: `Couldn't sync after several tries: ${result.error ?? "server error"}`,
          nextAttemptAt: undefined,
        });
      } else {
        const at = Date.now() + backoffMs(current.attempts);
        retryAt = retryAt === null ? at : Math.min(retryAt, at);
        await offlineDb.outbox.update(entry.seq!, { status: "pending", error: result.error ?? null, nextAttemptAt: at });
      }
    }
  });
  return { rejected, retryAt };
}

/** Stores the server's updated_at on the local row after a confirmed change (inside settle). */
async function recordServerVersion(entry: OutboxEntry, serverUpdatedAt: string) {
  if (entry.entity === "transaction") {
    await offlineDb.transactions.update([entry.ownerId, entry.entityId], { updated_at: serverUpdatedAt });
  } else if (entry.entity === "account") {
    await offlineDb.accounts.update([entry.ownerId, entry.entityId], { updated_at: serverUpdatedAt });
  } else if (entry.entity === "budget") {
    await offlineDb.monthlyBudgets.update(entry.ownerId, { updated_at: serverUpdatedAt });
  } else if (entry.entity === "daily_expense") {
    await offlineDb.dailyBudgetExpenses.update([entry.ownerId, entry.entityId], { updated_at: serverUpdatedAt });
  } else if (entry.entity === "daily_limit") {
    await offlineDb.dailyBudgetLimits.update([entry.ownerId, entry.entityId], { updated_at: serverUpdatedAt });
  } else if (entry.entity === "subscription") {
    await offlineDb.subscriptions.update([entry.ownerId, entry.entityId], { updated_at: serverUpdatedAt });
  } else if (entry.entity === "subscription_payment") {
    await offlineDb.subscriptionPayments.update([entry.ownerId, entry.entityId], { updated_at: serverUpdatedAt });
  } else if (entry.entity === "bill") {
    await offlineDb.bills.update([entry.ownerId, entry.entityId], { updated_at: serverUpdatedAt });
  } else if (entry.entity === "bill_payment") {
    await offlineDb.billPayments.update([entry.ownerId, entry.entityId], { updated_at: serverUpdatedAt });
  } else if (entry.entity === "installment_plan") {
    await offlineDb.installmentPlans.update([entry.ownerId, entry.entityId], { updated_at: serverUpdatedAt });
  } else if (entry.entity === "installment_payment") {
    await offlineDb.installmentPayments.update([entry.ownerId, entry.entityId], { updated_at: serverUpdatedAt });
    // The expense this payment created was written with the same server timestamp.
    if (entry.payload.transaction_origin === "created" && typeof entry.payload.transaction_id === "string") {
      const pendingEdits = await offlineDb.outbox
        .where("[ownerId+entity+entityId]")
        .equals([entry.ownerId, "transaction", entry.payload.transaction_id])
        .count();
      if (pendingEdits === 0) {
        await offlineDb.transactions.update([entry.ownerId, entry.payload.transaction_id], { updated_at: serverUpdatedAt });
      }
    }
  } else if (isLedgerEntity(entry.entity)) {
    // Ledger rows keep their own timestamps; an expense's shares were written with the same one.
    await ledgerTableFor(entry.entity).update([entry.ownerId, entry.entityId], { updated_at: serverUpdatedAt });
  }
  // Categories have no updated_at.
}

/* ------------------------------------------------------------------ user actions */

/** Puts a failed change back in the queue and syncs. */
export async function retryChange(seq: number) {
  await offlineDb.outbox.update(seq, { status: "pending", attempts: 0, error: null, nextAttemptAt: undefined });
  requestSync(0);
}

/** Puts every failed change for the user back in the queue and syncs. */
export async function retryAllFailed(ownerId: string) {
  await offlineDb.transaction("rw", offlineDb.outbox, async () => {
    const failed = await offlineDb.outbox.where("[ownerId+status]").equals([ownerId, "failed"]).toArray();
    for (const entry of failed) {
      await offlineDb.outbox.update(entry.seq!, { status: "pending", attempts: 0, error: null, nextAttemptAt: undefined });
    }
  });
  requestSync(0);
}

/**
 * Removes one queued change at the user's explicit, confirmed request. The device then
 * reloads the server's version of the data once nothing else is waiting, which undoes the
 * discarded change locally. Never called automatically.
 */
export async function discardChange(seq: number) {
  const entry = await offlineDb.outbox.get(seq);
  if (!entry) return;
  await offlineDb.outbox.delete(seq);
  refreshWhenDrained.add(entry.ownerId);
  requestSync(0);
}

export async function dismissConflicts(ownerId: string) {
  await offlineDb.syncConflicts.where("ownerId").equals(ownerId).delete();
}

/** Starts the triggers once per page load: startup, foreground, online, after local saves. */
export function startSyncEngine() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => requestSync(0));
  window.addEventListener("offline", () => setState({ phase: "offline" }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestSync(0);
  });
  window.addEventListener(OUTBOX_CHANGED_EVENT, () => {
    if (navigator.onLine) requestSync(2_000);
  });
  subscribeActiveOwner(() => requestSync(500));
  requestSync(1_000);
}

/**
 * Offline data source: the existing Dexie snapshot. No network requests.
 *
 * Why the snapshot can be trusted as complete: `commitSnapshot` (lib/offline/bootstrap.ts)
 * downloads every page of every table first, then replaces the owner's rows and writes
 * `syncMeta` inside ONE IndexedDB transaction, after verifying counts and totals. So a
 * `syncMeta` row exists only after a full, verified bootstrap, and a later failed refresh
 * leaves the previous complete copy untouched. Local unsynced changes (the outbox) are already
 * applied to these rows; they are reported, not hidden.
 */

import type { LocalSyncMeta } from "@/lib/offline/db";
import type { ReportDataset } from "@/lib/reportExport/model";
import {
  partitionByPeriod,
  toExportAccount,
  toExportCategory,
  toExportTransaction,
  type AccountLike,
  type CategoryLike,
  type TransactionLike,
} from "@/lib/reportExport/normalize";
import type { ResolvedPeriod } from "@/lib/reportExport/period";

export interface OfflineCacheInput {
  ownerId: string;
  /** The owner registered by the page on screen (activeOwner), if any. */
  activeOwnerId: string | null;
  meta: Pick<LocalSyncMeta, "ownerId" | "completedAt" | "totalsMatch"> | undefined;
  accountIds: Set<string>;
  transactionAccountIds: Iterable<string>;
  invalidTransactions: number;
  requiredAccountId?: string | null;
  failedChanges: number;
}

export interface OfflineCacheAssessment {
  ok: boolean;
  /** Blocking problems: a complete offline report can't be guaranteed. */
  problems: string[];
  /** Non-blocking: shown in the export summary. */
  warnings: string[];
  asOf: string | null;
}

/** Pure completeness check (unit-tested). */
export function assessOfflineCache(input: OfflineCacheInput): OfflineCacheAssessment {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (input.activeOwnerId && input.activeOwnerId !== input.ownerId) {
    problems.push("The data on this device belongs to a different signed-in user.");
  }
  if (!input.meta) {
    problems.push("This device hasn't finished downloading your data yet. Open the app once while online to prepare offline exports.");
  } else {
    if (input.meta.ownerId !== input.ownerId) problems.push("The offline copy belongs to a different user.");
    if (!input.meta.totalsMatch) problems.push("The last offline refresh couldn't be verified, so the copy may be incomplete.");
  }

  let orphaned = 0;
  for (const accountId of input.transactionAccountIds) if (!input.accountIds.has(accountId)) orphaned += 1;
  if (orphaned > 0) problems.push(`${orphaned} cached transaction(s) belong to accounts missing from the offline copy.`);
  if (input.invalidTransactions > 0) {
    problems.push(`${input.invalidTransactions} cached transaction(s) have an unreadable date, type or amount.`);
  }
  if (input.requiredAccountId && !input.accountIds.has(input.requiredAccountId)) {
    problems.push("The selected account isn't in the offline copy.");
  }
  if (input.failedChanges > 0) {
    warnings.push(
      `${input.failedChanges} change(s) on this device couldn't sync. They're included as saved here, but the server may differ.`
    );
  }

  return { ok: problems.length === 0, problems, warnings, asOf: input.meta?.completedAt ?? null };
}

export interface OfflineRows {
  meta: LocalSyncMeta | undefined;
  accounts: AccountLike[];
  categories: CategoryLike[];
  transactions: TransactionLike[];
  profileCurrency: string | null;
  pendingChanges: number;
  failedChanges: number;
}

export type OfflineLoadResult =
  | { ok: true; dataset: ReportDataset; assessment: OfflineCacheAssessment }
  | { ok: false; assessment: OfflineCacheAssessment };

/** Build the dataset from already-read rows (pure; the Dexie read is in readOfflineRows). */
export function datasetFromOfflineRows(
  rows: OfflineRows,
  options: {
    ownerId: string;
    activeOwnerId: string | null;
    defaultCurrency: string;
    period: Pick<ResolvedPeriod, "start" | "end">;
    requiredAccountId?: string | null;
  }
): OfflineLoadResult {
  const normalized = [];
  let invalid = 0;
  for (const row of rows.transactions) {
    const tx = toExportTransaction(row);
    if (tx) normalized.push(tx);
    else invalid += 1;
  }
  const assessment = assessOfflineCache({
    ownerId: options.ownerId,
    activeOwnerId: options.activeOwnerId,
    meta: rows.meta,
    accountIds: new Set(rows.accounts.map((account) => String(account.id))),
    transactionAccountIds: new Set(normalized.map((tx) => tx.accountId)),
    invalidTransactions: invalid,
    requiredAccountId: options.requiredAccountId,
    failedChanges: rows.failedChanges,
  });
  if (!assessment.ok) return { ok: false, assessment };

  const currency = rows.profileCurrency || options.defaultCurrency;
  const { inPeriod, priorTotals } = partitionByPeriod(normalized, options.period);
  return {
    ok: true,
    assessment,
    dataset: {
      accounts: rows.accounts.map((row) => toExportAccount(row, currency)),
      // The snapshot stores the full category list atomically with transactions; a missing
      // category for a transaction is surfaced by the report as "Unavailable".
      categories: rows.categories.map(toExportCategory),
      transactions: inPeriod,
      priorTotals,
      source: {
        kind: "offline",
        asOf: assessment.asOf ?? new Date().toISOString(),
        pendingChanges: rows.pendingChanges,
        failedChanges: rows.failedChanges,
      },
    },
  };
}

/** Read the owner's rows from IndexedDB (client only). */
export async function readOfflineRows(ownerId: string): Promise<OfflineRows> {
  const { offlineDb } = await import("@/lib/offline/db");
  return offlineDb.transaction(
    "r",
    [offlineDb.syncMeta, offlineDb.accounts, offlineDb.categories, offlineDb.transactions, offlineDb.profiles, offlineDb.outbox],
    async () => {
      const [meta, accounts, categories, transactions, profile, pendingChanges, failedChanges] = await Promise.all([
        offlineDb.syncMeta.get(ownerId),
        offlineDb.accounts.where("ownerId").equals(ownerId).toArray(),
        offlineDb.categories.where("ownerId").equals(ownerId).toArray(),
        offlineDb.transactions.where("ownerId").equals(ownerId).toArray(),
        offlineDb.profiles.get(ownerId),
        offlineDb.outbox.where("ownerId").equals(ownerId).count(),
        offlineDb.outbox.where("[ownerId+status]").equals([ownerId, "failed"]).count(),
      ]);
      return {
        meta,
        accounts,
        categories,
        transactions,
        profileCurrency: profile?.default_currency ?? null,
        pendingChanges,
        failedChanges,
      };
    }
  );
}

/** Outbox counts for the online summary ("N changes not yet synced"). No network. */
export async function readOutboxCounts(ownerId: string) {
  const { offlineDb } = await import("@/lib/offline/db");
  const [pending, failed] = await Promise.all([
    offlineDb.outbox.where("ownerId").equals(ownerId).count(),
    offlineDb.outbox.where("[ownerId+status]").equals([ownerId, "failed"]).count(),
  ]);
  return { pending, failed };
}

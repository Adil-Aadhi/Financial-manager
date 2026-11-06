import "client-only";

import Dexie, { type EntityTable, type Table } from "dexie";
import type { SyncReviewReason, TransactionDateIntent } from "@/lib/sync/types";

export interface LocalProfile {
  ownerId: string;
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  default_currency: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LocalAccount {
  ownerId: string;
  id: string;
  user_id: string;
  name: string;
  account_type: string;
  opening_balance: number | string | null;
  currency: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface LocalCategory {
  ownerId: string;
  id: string;
  user_id: string | null;
  name: string;
  type: string;
  icon: string;
  is_default: boolean;
}

export interface LocalTransaction {
  ownerId: string;
  id: string;
  user_id: string;
  account_id: string;
  category_id: string;
  type: string;
  amount: number | string;
  description: string | null;
  transaction_date: string;
  transaction_time: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface LocalMonthlyBudget {
  ownerId: string;
  id: string;
  user_id: string;
  amount: number | string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LocalVerificationTotals {
  accounts: number;
  transactions: number;
  income: number;
  expense: number;
}

export interface LocalSyncMeta {
  ownerId: string;
  completedAt: string;
  budgetAvailable: boolean;
  server: LocalVerificationTotals;
  local: LocalVerificationTotals;
  totalsMatch: boolean;
}

export type OutboxEntity = "transaction" | "account" | "category" | "budget";
export type OutboxOperation = "CREATE" | "UPDATE" | "DELETE";
/** Phase 1 only writes "pending". Phase 2's sync engine moves ops through the others. */
export type OutboxStatus = "pending" | "syncing" | "failed";

/**
 * One change made on this device that Supabase has not received yet. Rows are applied to the
 * local tables immediately; this queue is what Phase 2 will replay against Supabase, in `seq`
 * order. Only the sync engine (after the server confirms) may delete an entry.
 */
export interface OutboxEntry {
  /** Auto-increment: replay order. */
  seq?: number;
  /** Stable unique id for this operation (idempotency key for Phase 2). */
  opId: string;
  ownerId: string;
  entity: OutboxEntity;
  /** The record's id. Locally created records use a client UUID that becomes the server id. */
  entityId: string;
  op: OutboxOperation;
  /** Server column values to write (CREATE/UPDATE) or the identifying fields (DELETE). */
  payload: Record<string, unknown>;
  /** Date-aware clients record whether the user changed the transaction date. */
  transactionDateIntent?: TransactionDateIntent;
  /** Set after the server identifies an old date value that requires explicit review. */
  reviewReason?: SyncReviewReason;
  /** The record's updated_at before this device first changed it (for conflict checks later). */
  baseUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  status: OutboxStatus;
  attempts: number;
  error: string | null;
  /** Epoch ms before which a retryable failure shouldn't be resent (backoff). */
  nextAttemptAt?: number;
}

/** A last-write-wins decision made during sync, kept until the user dismisses it. */
export interface SyncConflictRecord {
  id?: number;
  ownerId: string;
  opId: string;
  entity: OutboxEntity;
  entityId: string;
  op: OutboxOperation;
  /** kept-local: this device's later edit was applied. kept-server: a later edit from elsewhere was kept. */
  outcome: "kept-local" | "kept-server";
  serverUpdatedAt: string;
  clientEditedAt: string;
  /** Human description of the change, captured when it was synced. */
  summary: string;
  recordedAt: string;
}

class FinanceOfflineDatabase extends Dexie {
  profiles!: EntityTable<LocalProfile, "ownerId">;
  accounts!: Table<LocalAccount, [string, string]>;
  categories!: Table<LocalCategory, [string, string]>;
  transactions!: Table<LocalTransaction, [string, string]>;
  monthlyBudgets!: EntityTable<LocalMonthlyBudget, "ownerId">;
  syncMeta!: EntityTable<LocalSyncMeta, "ownerId">;
  outbox!: EntityTable<OutboxEntry, "seq">;
  syncConflicts!: EntityTable<SyncConflictRecord, "id">;

  constructor() {
    super("finance-tracker-offline");
    this.version(1).stores({
      profiles: "&ownerId, id",
      accounts: "&[ownerId+id], ownerId, [ownerId+deleted_at], created_at",
      categories: "&[ownerId+id], ownerId, [ownerId+type], is_default",
      transactions:
        "&[ownerId+id], ownerId, [ownerId+account_id], [ownerId+category_id], [ownerId+transaction_date], [ownerId+account_id+transaction_date], [ownerId+type+transaction_date]",
      monthlyBudgets: "&ownerId, id",
      syncMeta: "&ownerId, completedAt",
    });
    // v2 only adds the outbox; existing tables and rows are kept as they are.
    this.version(2).stores({
      outbox: "++seq, &opId, ownerId, [ownerId+entity+entityId], [ownerId+status]",
    });
    // v3 only adds the conflict log; the outbox and all other tables are unchanged.
    this.version(3).stores({
      syncConflicts: "++id, ownerId, opId",
    });
  }
}

export const offlineDb = new FinanceOfflineDatabase();


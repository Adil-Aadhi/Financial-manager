import "client-only";

import Dexie, { type EntityTable, type Table } from "dexie";
import type { AccountGroup } from "@/lib/accounts";
import type { BillingCycle, SubscriptionIconName, SubscriptionLifecycle } from "@/lib/subscriptions";
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
  /**
   * Not indexed, so no schema version change was needed. Rows cached before groups existed
   * have no value; read it with normalizeAccountGroup (missing = General).
   */
  account_group?: AccountGroup;
  /** Missing on legacy cached rows; read as true through normalizeIncludeInSummary(). */
  include_in_summary?: boolean;
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

/**
 * Daily Budget Tracker (independent of accounts and transactions). One limit per effective
 * date, keyed by that date, so a calendar day can never have two allowances.
 */
export interface LocalDailyBudgetLimit {
  ownerId: string;
  effective_date: string;
  user_id: string;
  amount: number | string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LocalDailyBudgetExpense {
  ownerId: string;
  id: string;
  user_id: string;
  expense_date: string;
  amount: number | string;
  description: string;
  created_at: string;
  updated_at?: string | null;
}

export interface LocalSubscription {
  ownerId: string;
  id: string;
  user_id: string;
  name: string;
  icon: SubscriptionIconName;
  amount: number | string;
  currency: string;
  billing_cycle: BillingCycle;
  billing_anchor_day: number;
  start_date: string;
  next_payment_date: string;
  lifecycle: SubscriptionLifecycle;
  notes: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface LocalSubscriptionPayment {
  ownerId: string;
  id: string;
  user_id: string;
  subscription_id: string;
  due_date: string;
  paid_at: string;
  created_at: string;
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
  /**
   * false until the daily-budget migration is applied. Missing on metas written before the
   * feature existed; read with `=== true`, and the next refresh fills it in.
   */
  dailyBudgetAvailable?: boolean;
  /** Missing until a snapshot from a subscription-aware client has completed. */
  subscriptionsAvailable?: boolean;
  server: LocalVerificationTotals;
  local: LocalVerificationTotals;
  totalsMatch: boolean;
}

export type OutboxEntity =
  | "transaction"
  | "account"
  | "category"
  | "budget"
  | "daily_expense"
  | "daily_limit"
  | "subscription"
  | "subscription_payment";
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
  dailyBudgetLimits!: Table<LocalDailyBudgetLimit, [string, string]>;
  dailyBudgetExpenses!: Table<LocalDailyBudgetExpense, [string, string]>;
  subscriptions!: Table<LocalSubscription, [string, string]>;
  subscriptionPayments!: Table<LocalSubscriptionPayment, [string, string]>;
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
    // v4 only adds the Daily Budget Tracker tables; every existing table and row is unchanged.
    this.version(4).stores({
      dailyBudgetLimits: "&[ownerId+effective_date], ownerId",
      dailyBudgetExpenses: "&[ownerId+id], ownerId, [ownerId+expense_date]",
    });
    // v5 adds the isolated Subscriptions Tracker tables.
    this.version(5).stores({
      subscriptions: "&[ownerId+id], ownerId, [ownerId+lifecycle], [ownerId+next_payment_date]",
      subscriptionPayments: "&[ownerId+id], ownerId, [ownerId+subscription_id], [ownerId+subscription_id+due_date]",
    });
  }
}

export const offlineDb = new FinanceOfflineDatabase();


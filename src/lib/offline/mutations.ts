import "client-only";

import {
  ACCOUNT_GROUP_ERROR,
  DEFAULT_NEW_ACCOUNT_GROUP,
  isAccountGroup,
  type AccountGroup,
} from "@/lib/accounts";
import { validateBudgetAmount } from "@/lib/budget";
import {
  addBillCycle,
  isBillLifecycle,
  validateBillInput,
  validateBillPayment,
  type BillInput,
  type BillLifecycle,
} from "@/lib/bills";
import {
  dailyBudgetToday,
  isDateKey,
  roundAmount,
  validateDailyExpenseInput,
  validateDailyLimitInput,
  type DailyExpenseInput,
  type DailyLimitInput,
} from "@/lib/dailyBudget";
import { isCategoryType } from "@/lib/categories";
import {
  addBillingCycle,
  isSubscriptionLifecycle,
  validateSubscriptionInput,
  type SubscriptionInput,
  type SubscriptionLifecycle,
} from "@/lib/subscriptions";
import {
  ACCOUNT_RESTORE_WINDOW_MS,
  accountFieldsError,
  transactionFieldsError,
  validateCategoryFields,
} from "@/lib/validation/rules";
import { getActiveOwnerId } from "@/lib/offline/activeOwner";
import { notifyOutboxChanged } from "@/lib/offline/events";
import {
  offlineDb,
  type LocalAccount,
  type LocalCategory,
  type LocalTransaction,
  type OutboxEntity,
  type OutboxEntry,
  type OutboxOperation,
} from "@/lib/offline/db";
import {
  isTransactionDateChange,
  type TransactionFormOptions,
  type TransactionType,
} from "@/lib/transactions";
import type { TransactionDateIntent } from "@/lib/sync/types";
import { canCoalesce } from "@/lib/offline/queuePolicy";

/**
 * Local-first mutations (offline Phase 1).
 *
 * Each function validates with the same rules as the matching Server Action, then writes the
 * record to IndexedDB *and* records an outbox entry in one Dexie transaction: either both
 * happen or neither does. Pages re-render through their existing useLiveQuery reads.
 *
 * Nothing here talks to Supabase. Phase 2's sync engine replays the outbox in `seq` order and
 * is the only code allowed to remove entries, after the server confirms them.
 */

/** A rule failed or the local copy is missing: safe to show to the user. */
export class LocalMutationError extends Error {}

export interface MutationOutcome {
  success: boolean;
  error?: string;
  /** true when the change was saved on this device and is waiting to sync. */
  queued: boolean;
}

const TEN_DAYS_IN_MS = ACCOUNT_RESTORE_WINDOW_MS;
/** Transactions, the budget and daily-budget records are never referenced by other records, so
 * their queued operations can be merged and moved to the end of the queue without breaking
 * ordering. */
const MOVABLE_ENTITIES = new Set<OutboxEntity>([
  "transaction",
  "budget",
  "daily_expense",
  "daily_limit",
  "subscription_payment",
  "bill_payment",
]);

function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Any outbox entry (pending, syncing or failed) means Supabase is missing local changes. */
export async function countUnsyncedChanges(ownerId: string) {
  return offlineDb.outbox.where("ownerId").equals(ownerId).count();
}

/**
 * Local-first when offline, and also whenever this user already has queued changes, so a
 * later change can never reach Supabase before an earlier one. Otherwise the existing
 * Server Action path runs unchanged.
 */
export async function shouldWriteLocally(ownerId: string | null) {
  if (!ownerId) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return (await countUnsyncedChanges(ownerId)) > 0;
}

/**
 * Runs a mutation through the right path. Remote network failures are reported, never
 * retried locally: the server may already have applied the change, and replaying it from the
 * outbox could create a duplicate.
 */
export async function runMutation<R extends { success: boolean; error?: string }>({
  local,
  remote,
}: {
  local: (ownerId: string) => Promise<void>;
  remote: () => Promise<R>;
}): Promise<MutationOutcome> {
  const ownerId = getActiveOwnerId();
  if (ownerId && (await shouldWriteLocally(ownerId))) {
    try {
      await local(ownerId);
    } catch (error) {
      if (error instanceof LocalMutationError) return { success: false, error: error.message, queued: true };
      console.error("Local mutation failed:", error);
      return {
        success: false,
        error: "This change couldn't be saved on this device, so nothing was changed. Try again.",
        queued: true,
      };
    }
    // Committed. Wake the sync engine (it sends ~2s later when online); a notification problem
    // must never turn a saved change into a reported failure.
    try {
      notifyOutboxChanged();
    } catch {
      // The next app-open / foreground / online trigger syncs it instead.
    }
    return { success: true, queued: true };
  }

  try {
    const result = await remote();
    return { success: result.success, error: result.error, queued: false };
  } catch {
    return {
      success: false,
      error: "Couldn't reach the server. Check your connection and try again.",
      queued: false,
    };
  }
}

async function requireLocalSnapshot(ownerId: string) {
  const meta = await offlineDb.syncMeta.get(ownerId);
  if (!meta?.totalsMatch) {
    throw new LocalMutationError(
      "This device doesn't have a complete copy of your data yet. Connect to the internet once, then try again."
    );
  }
}

/** Adds an operation to the outbox, merging it with this record's queued operations when safe. */
async function enqueue(
  ownerId: string,
  entity: OutboxEntity,
  entityId: string,
  op: OutboxOperation,
  payload: Record<string, unknown>,
  baseUpdatedAt: string | null,
  transactionDateIntent?: TransactionDateIntent
) {
  const now = new Date().toISOString();
  const fresh = (
    finalOp: OutboxOperation,
    finalPayload: Record<string, unknown>,
    base: string | null,
    dateIntent = transactionDateIntent
  ): OutboxEntry => ({
      opId: newId(),
      ownerId,
      entity,
      entityId,
      op: finalOp,
      payload: finalPayload,
      ...(entity === "transaction" && finalOp === "UPDATE" && dateIntent
        ? { transactionDateIntent: dateIntent }
        : {}),
      baseUpdatedAt: base,
      createdAt: now,
      updatedAt: now,
      status: "pending",
      attempts: 0,
      error: null,
    });

  const existing = await offlineDb.outbox
    .where("[ownerId+entity+entityId]")
    .equals([ownerId, entity, entityId])
    .sortBy("seq");

  // An older client could not record whether the transaction date changed. Once
  // the server asks for review, a new form save is the reliable user decision:
  // replace only those rejected entries and retain all of their non-date edits.
  const reviewedLegacy = existing.filter(
    (entry) =>
      entity === "transaction" &&
      op === "UPDATE" &&
      transactionDateIntent !== undefined &&
      entry.reviewReason === "legacy-transaction-date"
  );
  if (reviewedLegacy.length > 0) {
    const base = reviewedLegacy[0].baseUpdatedAt;
    const merged = Object.assign({}, ...reviewedLegacy.map((entry) => entry.payload), payload);
    await offlineDb.outbox.bulkDelete(reviewedLegacy.map((entry) => entry.seq!));
    await offlineDb.outbox.add(fresh("UPDATE", merged, base));
    return;
  }
  // Once an entry has been attempted, the server may already have applied it even when the
  // response never reached this device. Its opId and payload must stay immutable so a retry can
  // be recognised as already applied; later intent is appended as a separate operation.
  const mergeable = canCoalesce(existing);

  if (MOVABLE_ENTITIES.has(entity) && mergeable) {
    const createdHere = existing.some((entry) => entry.op === "CREATE");
    const base = existing[0].baseUpdatedAt;
    await offlineDb.outbox.bulkDelete(existing.map((entry) => entry.seq!));
    if (op === "DELETE") {
      // Created on this device and deleted again: Supabase never saw it, nothing to send.
      if (!createdHere) await offlineDb.outbox.add(fresh("DELETE", payload, base));
      return;
    }
    const merged = Object.assign({}, ...existing.map((entry) => entry.payload), payload);
    const previousIntent = [...existing]
      .reverse()
      .find((entry) => entry.transactionDateIntent)?.transactionDateIntent;
    await offlineDb.outbox.add(
      fresh(createdHere ? "CREATE" : op, merged, base, transactionDateIntent ?? previousIntent)
    );
    return;
  }

  // Accounts and categories are referenced by other records, so their order matters.
  // Merge only into the very last queued operation, which can't reorder anything.
  if (op === "UPDATE" && mergeable) {
    const last = await offlineDb.outbox.where("ownerId").equals(ownerId).last();
    const tail = existing[existing.length - 1];
    if (last && last.seq === tail.seq && tail.op !== "DELETE") {
      await offlineDb.outbox.update(tail.seq!, { payload: { ...tail.payload, ...payload }, updatedAt: now });
      return;
    }
  }

  const base = existing.length > 0 ? existing[0].baseUpdatedAt : baseUpdatedAt;
  await offlineDb.outbox.add(fresh(op, payload, base));
}

const WRITE_TABLES = [
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
  offlineDb.syncMeta,
  offlineDb.outbox,
];

function inLocalTransaction(work: () => Promise<void>) {
  return offlineDb.transaction("rw", WRITE_TABLES, work);
}

/* ---------------------------------------------------------------- transactions */

export interface LocalTransactionInput {
  transactionId?: string;
  type: TransactionType;
  amount: number;
  accountId: string;
  categoryId: string;
  transactionDate: string;
  transactionTime: string;
  remark?: string;
}

async function validateTransaction(ownerId: string, input: LocalTransactionInput) {
  const fieldError = transactionFieldsError(input);
  if (fieldError) return fieldError;

  const [account, category] = await Promise.all([
    offlineDb.accounts.get([ownerId, input.accountId]),
    offlineDb.categories.get([ownerId, input.categoryId]),
  ]);
  if (!account || account.deleted_at) return "Choose one of your active accounts.";
  if (!category || category.type !== input.type) {
    return "Choose an available category matching the transaction type.";
  }
  return null;
}

function transactionColumns(input: LocalTransactionInput) {
  return {
    account_id: input.accountId,
    category_id: input.categoryId,
    type: input.type,
    amount: input.amount,
    description: input.remark?.trim() || null,
    transaction_date: input.transactionDate,
    transaction_time: input.transactionTime ? `${input.transactionTime}:00` : null,
  };
}

export function createTransactionLocally(ownerId: string, input: LocalTransactionInput) {
  return inLocalTransaction(async () => {
    await requireLocalSnapshot(ownerId);
    const invalid = await validateTransaction(ownerId, input);
    if (invalid) throw new LocalMutationError(invalid);

    const now = new Date().toISOString();
    const row: LocalTransaction = {
      ownerId,
      id: newId(),
      user_id: ownerId,
      ...transactionColumns(input),
      created_at: now,
      updated_at: now,
    };
    await offlineDb.transactions.add(row);
    const { ownerId: _owner, ...payload } = row;
    void _owner;
    await enqueue(ownerId, "transaction", row.id, "CREATE", payload, null);
  });
}

export function updateTransactionLocally(ownerId: string, input: LocalTransactionInput) {
  return inLocalTransaction(async () => {
    await requireLocalSnapshot(ownerId);
    if (!input.transactionId) throw new LocalMutationError("Transaction not found.");
    const existing = await offlineDb.transactions.get([ownerId, input.transactionId]);
    if (!existing) throw new LocalMutationError("Transaction not found.");
    const invalid = await validateTransaction(ownerId, input);
    if (invalid) throw new LocalMutationError(invalid);

    const dateIntent: TransactionDateIntent =
      isTransactionDateChange(existing.transaction_date, input.transactionDate)
        ? "changed"
        : "unchanged";
    const changes = { ...transactionColumns(input), updated_at: new Date().toISOString() };
    await offlineDb.transactions.update([ownerId, existing.id], changes);
    await enqueue(
      ownerId,
      "transaction",
      existing.id,
      "UPDATE",
      changes,
      existing.updated_at ?? null,
      dateIntent
    );
  });
}

export function deleteTransactionLocally(ownerId: string, transactionId: string) {
  return inLocalTransaction(async () => {
    await requireLocalSnapshot(ownerId);
    const existing = await offlineDb.transactions.get([ownerId, transactionId]);
    if (!existing) throw new LocalMutationError("Transaction not found.");
    await offlineDb.transactions.delete([ownerId, transactionId]);
    await enqueue(
      ownerId,
      "transaction",
      transactionId,
      "DELETE",
      { id: transactionId, account_id: existing.account_id },
      existing.updated_at ?? null
    );
  });
}

/** Accounts and categories for the transaction form, read from this device. */
export async function loadLocalTransactionOptions(ownerId: string): Promise<TransactionFormOptions> {
  await requireLocalSnapshot(ownerId);
  const [accounts, categories] = await Promise.all([
    offlineDb.accounts.where("ownerId").equals(ownerId).toArray(),
    offlineDb.categories.where("ownerId").equals(ownerId).toArray(),
  ]);
  return {
    accounts: accounts
      .filter((account) => !account.deleted_at)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((account) => ({ id: account.id, name: account.name, currency: account.currency })),
    categories: categories
      .flatMap((category) =>
        isCategoryType(category.type)
          ? [{ id: category.id, name: category.name, type: category.type as TransactionType, icon: category.icon, is_default: category.is_default }]
          : []
      )
      .sort((left, right) => Number(right.is_default) - Number(left.is_default) || left.name.localeCompare(right.name)),
  };
}

/* ---------------------------------------------------------------- accounts */

export function createAccountLocally(
  ownerId: string,
  input: {
    name: string;
    startingAmount?: number;
    accountGroup?: AccountGroup;
    includeInSummary?: boolean;
  }
) {
  return inLocalTransaction(async () => {
    await requireLocalSnapshot(ownerId);
    const name = input.name?.trim();
    if (!name) throw new LocalMutationError("Account Name is required.");
    const accountGroup = input.accountGroup ?? DEFAULT_NEW_ACCOUNT_GROUP;
    if (!isAccountGroup(accountGroup)) throw new LocalMutationError(ACCOUNT_GROUP_ERROR);
    const includeInSummary = input.includeInSummary ?? true;
    if (typeof includeInSummary !== "boolean") {
      throw new LocalMutationError("Choose whether to include this account in financial summaries.");
    }
    const amount =
      typeof input.startingAmount === "number" && !Number.isNaN(input.startingAmount)
        ? input.startingAmount
        : Number(input.startingAmount) || 0;

    const now = new Date().toISOString();
    const row: LocalAccount = {
      ownerId,
      id: newId(),
      user_id: ownerId,
      name,
      account_type: "other",
      opening_balance: amount,
      // The server fills its own default currency when this syncs; until then the app shows
      // the profile's default currency, exactly as it does for any account without one.
      currency: null,
      account_group: accountGroup,
      include_in_summary: includeInSummary,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    await offlineDb.accounts.add(row);
    await enqueue(
      ownerId,
      "account",
      row.id,
      "CREATE",
      {
        id: row.id,
        user_id: ownerId,
        name,
        account_type: "other",
        opening_balance: amount,
        account_group: accountGroup,
        include_in_summary: includeInSummary,
        created_at: now,
        updated_at: now,
      },
      null
    );
  });
}

export function updateAccountLocally(
  ownerId: string,
  input: {
    accountId: string;
    name: string;
    openingAmount: number;
    accountGroup?: AccountGroup;
    includeInSummary?: boolean;
  }
) {
  return inLocalTransaction(async () => {
    await requireLocalSnapshot(ownerId);
    const name = input.name.trim();
    if (!input.accountId) throw new LocalMutationError("Account Name is required.");
    const fieldsError = accountFieldsError(input.name, input.openingAmount);
    if (fieldsError) throw new LocalMutationError(fieldsError);
    const existing = await offlineDb.accounts.get([ownerId, input.accountId]);
    if (!existing || existing.deleted_at) throw new LocalMutationError("Account not found.");
    if (input.accountGroup !== undefined && !isAccountGroup(input.accountGroup)) {
      throw new LocalMutationError(ACCOUNT_GROUP_ERROR);
    }
    if (input.includeInSummary !== undefined && typeof input.includeInSummary !== "boolean") {
      throw new LocalMutationError("Choose whether to include this account in financial summaries.");
    }

    // The same object updates the local row and the outbox payload, so the queued change always
    // carries exactly the group the user just chose (later saves merge over or follow it).
    const changes = {
      name,
      opening_balance: input.openingAmount,
      ...(input.accountGroup !== undefined ? { account_group: input.accountGroup } : {}),
      ...(input.includeInSummary !== undefined
        ? { include_in_summary: input.includeInSummary }
        : {}),
      updated_at: new Date().toISOString(),
    };
    await offlineDb.accounts.update([ownerId, existing.id], changes);
    await enqueue(ownerId, "account", existing.id, "UPDATE", changes, existing.updated_at ?? null);
  });
}

/** Soft delete (Trash), same as trashAccountAction: transactions stay and count again on restore. */
export function trashAccountLocally(ownerId: string, accountId: string, confirmation: string) {
  return inLocalTransaction(async () => {
    await requireLocalSnapshot(ownerId);
    if (!accountId || confirmation !== "CONFIRM") {
      throw new LocalMutationError("Type CONFIRM to move this account to Trash.");
    }
    const existing = await offlineDb.accounts.get([ownerId, accountId]);
    if (!existing || existing.deleted_at) throw new LocalMutationError("Account not found.");

    const now = new Date().toISOString();
    const changes = { deleted_at: now, updated_at: now };
    await offlineDb.accounts.update([ownerId, accountId], changes);
    await enqueue(ownerId, "account", accountId, "UPDATE", changes, existing.updated_at ?? null);
  });
}

export function restoreAccountLocally(ownerId: string, accountId: string) {
  return inLocalTransaction(async () => {
    await requireLocalSnapshot(ownerId);
    const existing = await offlineDb.accounts.get([ownerId, accountId]);
    const cutoff = Date.now() - TEN_DAYS_IN_MS;
    if (!existing?.deleted_at || Date.parse(existing.deleted_at) <= cutoff) {
      throw new LocalMutationError("This account is no longer available for recovery.");
    }
    const changes = { deleted_at: null, updated_at: new Date().toISOString() };
    await offlineDb.accounts.update([ownerId, accountId], changes);
    await enqueue(ownerId, "account", accountId, "UPDATE", changes, existing.updated_at ?? null);
  });
}

/* ---------------------------------------------------------------- categories */

export interface LocalCategoryInput {
  categoryId?: string;
  name: string;
  type: string;
  icon: string;
}

async function validateCategory(ownerId: string, input: LocalCategoryInput) {
  const fields = validateCategoryFields(input);
  if (fields.error || !fields.name) throw new LocalMutationError(fields.error ?? "Category name is required.");
  const name = fields.name;

  // Same rule as the categories_user_name_type_unique index: case-insensitive per type,
  // among this user's own categories.
  const own = await offlineDb.categories.where("ownerId").equals(ownerId).toArray();
  const clash = own.some(
    (category: LocalCategory) =>
      !category.is_default &&
      category.id !== input.categoryId &&
      category.type === input.type &&
      category.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (clash) throw new LocalMutationError("A category with this name already exists for that type.");
  return name;
}

export function createCategoryLocally(ownerId: string, input: LocalCategoryInput) {
  return inLocalTransaction(async () => {
    await requireLocalSnapshot(ownerId);
    const name = await validateCategory(ownerId, input);
    const row: LocalCategory = { ownerId, id: newId(), user_id: ownerId, name, type: input.type, icon: input.icon, is_default: false };
    await offlineDb.categories.add(row);
    await enqueue(
      ownerId,
      "category",
      row.id,
      "CREATE",
      { id: row.id, user_id: ownerId, name, type: input.type, icon: input.icon, is_default: false },
      null
    );
  });
}

export function updateCategoryLocally(ownerId: string, input: LocalCategoryInput) {
  return inLocalTransaction(async () => {
    await requireLocalSnapshot(ownerId);
    const existing = input.categoryId ? await offlineDb.categories.get([ownerId, input.categoryId]) : undefined;
    if (!existing || existing.is_default || existing.user_id !== ownerId) {
      throw new LocalMutationError("Only your custom categories can be edited.");
    }
    const name = await validateCategory(ownerId, input);
    const changes = { name, type: input.type, icon: input.icon };
    await offlineDb.categories.update([ownerId, existing.id], changes);
    await enqueue(ownerId, "category", existing.id, "UPDATE", changes, null);
  });
}

export function deleteCategoryLocally(ownerId: string, categoryId: string) {
  return inLocalTransaction(async () => {
    await requireLocalSnapshot(ownerId);
    const existing = await offlineDb.categories.get([ownerId, categoryId]);
    if (!existing || existing.is_default || existing.user_id !== ownerId) {
      throw new LocalMutationError("Only your custom categories can be deleted.");
    }
    // Every transaction this user has is on the device, including ones in trashed accounts.
    const used = await offlineDb.transactions.where("[ownerId+category_id]").equals([ownerId, categoryId]).count();
    if (used > 0) throw new LocalMutationError("This category is used by transactions and cannot be deleted.");
    await offlineDb.categories.delete([ownerId, categoryId]);
    await enqueue(ownerId, "category", categoryId, "DELETE", { id: categoryId }, null);
  });
}

/* ---------------------------------------------------------------- monthly budget */

export function saveBudgetLocally(ownerId: string, amount: number) {
  return inLocalTransaction(async () => {
    await requireLocalSnapshot(ownerId);
    const meta = await offlineDb.syncMeta.get(ownerId);
    if (!meta?.budgetAvailable) {
      throw new LocalMutationError("Run the monthly-budget migration before setting a budget.");
    }
    const value = typeof amount === "number" ? Math.round(amount * 100) / 100 : Number.NaN;
    const invalid = validateBudgetAmount(value);
    if (invalid) throw new LocalMutationError(invalid);

    const existing = await offlineDb.monthlyBudgets.get(ownerId);
    const now = new Date().toISOString();
    await offlineDb.monthlyBudgets.put({
      ownerId,
      id: existing?.id ?? newId(),
      user_id: ownerId,
      amount: value,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });
    // One budget per user; the server upserts on user_id, so the entity id is the owner.
    await enqueue(ownerId, "budget", ownerId, existing ? "UPDATE" : "CREATE", { user_id: ownerId, amount: value }, existing?.updated_at ?? null);
  });
}

export function deleteBudgetLocally(ownerId: string) {
  return inLocalTransaction(async () => {
    await requireLocalSnapshot(ownerId);
    const existing = await offlineDb.monthlyBudgets.get(ownerId);
    if (!existing) throw new LocalMutationError("There is no budget to remove.");
    await offlineDb.monthlyBudgets.delete(ownerId);
    await enqueue(ownerId, "budget", ownerId, "DELETE", { user_id: ownerId }, existing.updated_at ?? null);
  });
}

/* ---------------------------------------------------------------- daily budget tracker */
// Independent of accounts and transactions: these only touch the two daily-budget tables.

async function requireDailyBudget(ownerId: string) {
  await requireLocalSnapshot(ownerId);
  const meta = await offlineDb.syncMeta.get(ownerId);
  if (meta?.dailyBudgetAvailable !== true) {
    throw new LocalMutationError(
      "The daily budget isn't ready on this device yet. Connect to the internet once, then try again."
    );
  }
}

function dailyExpenseColumns(input: DailyExpenseInput) {
  return {
    expense_date: input.expenseDate,
    amount: roundAmount(input.amount),
    description: input.description.trim(),
  };
}

export interface LocalDailyExpenseInput extends DailyExpenseInput {
  /** Client-generated id, reused on retry so the same entry can never be added twice. */
  id?: string;
}

export function addDailyExpenseLocally(ownerId: string, input: LocalDailyExpenseInput) {
  return inLocalTransaction(async () => {
    await requireDailyBudget(ownerId);
    const invalid = validateDailyExpenseInput(input, dailyBudgetToday());
    if (invalid) throw new LocalMutationError(invalid);
    const id = input.id ?? newId();
    if (await offlineDb.dailyBudgetExpenses.get([ownerId, id])) return; // already saved
    const now = new Date().toISOString();
    const row = { ownerId, id, user_id: ownerId, ...dailyExpenseColumns(input), created_at: now, updated_at: now };
    await offlineDb.dailyBudgetExpenses.add(row);
    const { ownerId: _owner, ...payload } = row;
    void _owner;
    await enqueue(ownerId, "daily_expense", id, "CREATE", payload, null);
  });
}

export function updateDailyExpenseLocally(
  ownerId: string,
  input: DailyExpenseInput & { expenseId: string }
) {
  return inLocalTransaction(async () => {
    await requireDailyBudget(ownerId);
    const existing = await offlineDb.dailyBudgetExpenses.get([ownerId, input.expenseId]);
    if (!existing) throw new LocalMutationError("This expense no longer exists.");
    const invalid = validateDailyExpenseInput(input, dailyBudgetToday());
    if (invalid) throw new LocalMutationError(invalid);
    const changes = { ...dailyExpenseColumns(input), updated_at: new Date().toISOString() };
    await offlineDb.dailyBudgetExpenses.update([ownerId, existing.id], changes);
    await enqueue(ownerId, "daily_expense", existing.id, "UPDATE", changes, existing.updated_at ?? null);
  });
}

export function deleteDailyExpenseLocally(ownerId: string, expenseId: string) {
  return inLocalTransaction(async () => {
    await requireDailyBudget(ownerId);
    const existing = await offlineDb.dailyBudgetExpenses.get([ownerId, expenseId]);
    if (!existing) throw new LocalMutationError("This expense no longer exists.");
    await offlineDb.dailyBudgetExpenses.delete([ownerId, expenseId]);
    await enqueue(ownerId, "daily_expense", expenseId, "DELETE", { id: expenseId }, existing.updated_at ?? null);
  });
}

/**
 * Sets the limit from `effectiveDate` onward. The record is keyed by its date (one limit per
 * day), so setting it again for the same date replaces it and earlier days are untouched.
 */
export function setDailyLimitLocally(ownerId: string, input: DailyLimitInput) {
  return inLocalTransaction(async () => {
    await requireDailyBudget(ownerId);
    const invalid = validateDailyLimitInput(input, dailyBudgetToday());
    if (invalid) throw new LocalMutationError(invalid);
    const amount = roundAmount(input.amount);
    const existing = await offlineDb.dailyBudgetLimits.get([ownerId, input.effectiveDate]);
    const now = new Date().toISOString();
    await offlineDb.dailyBudgetLimits.put({
      ownerId,
      effective_date: input.effectiveDate,
      user_id: ownerId,
      amount,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });
    await enqueue(
      ownerId,
      "daily_limit",
      input.effectiveDate,
      existing ? "UPDATE" : "CREATE",
      { effective_date: input.effectiveDate, amount },
      existing?.updated_at ?? null
    );
  });
}

/** Removes one limit change; the previous limit then applies from that date again. */
export function deleteDailyLimitLocally(ownerId: string, effectiveDate: string) {
  return inLocalTransaction(async () => {
    await requireDailyBudget(ownerId);
    const existing = await offlineDb.dailyBudgetLimits.get([ownerId, effectiveDate]);
    if (!existing) throw new LocalMutationError("This limit change no longer exists.");
    await offlineDb.dailyBudgetLimits.delete([ownerId, effectiveDate]);
    await enqueue(
      ownerId,
      "daily_limit",
      effectiveDate,
      "DELETE",
      { effective_date: effectiveDate },
      existing.updated_at ?? null
    );
  });
}

/* ---------------------------------------------------------------- subscriptions tracker */

async function requireSubscriptions(ownerId: string) {
  await requireLocalSnapshot(ownerId);
  const meta = await offlineDb.syncMeta.get(ownerId);
  if (meta?.subscriptionsAvailable !== true) {
    throw new LocalMutationError(
      "Subscriptions aren't ready on this device yet. Connect to the internet once, then try again."
    );
  }
}

export interface LocalSubscriptionInput extends SubscriptionInput {
  id: string;
  startDate: string;
  lifecycle?: SubscriptionLifecycle;
}

function subscriptionColumns(input: LocalSubscriptionInput) {
  const [, , day] = input.nextPaymentDate.split("-").map(Number);
  return {
    name: input.name.trim(),
    icon: input.icon,
    amount: roundAmount(input.amount),
    currency: input.currency,
    billing_cycle: input.billingCycle,
    billing_anchor_day: day,
    start_date: input.startDate,
    next_payment_date: input.nextPaymentDate,
    lifecycle: input.lifecycle ?? ("active" as const),
    notes: input.notes.trim() || null,
  };
}

function validateLocalSubscription(input: LocalSubscriptionInput) {
  const invalid = validateSubscriptionInput(input);
  if (invalid) return invalid;
  if (!isDateKey(input.startDate)) return "Choose a valid start date.";
  if (input.lifecycle && !isSubscriptionLifecycle(input.lifecycle)) return "Choose a valid subscription state.";
  return null;
}

export function createSubscriptionLocally(ownerId: string, input: LocalSubscriptionInput) {
  return inLocalTransaction(async () => {
    await requireSubscriptions(ownerId);
    const invalid = validateLocalSubscription(input);
    if (invalid) throw new LocalMutationError(invalid);
    if (await offlineDb.subscriptions.get([ownerId, input.id])) return;
    const now = new Date().toISOString();
    const row = {
      ownerId,
      id: input.id,
      user_id: ownerId,
      ...subscriptionColumns(input),
      created_at: now,
      updated_at: now,
    };
    await offlineDb.subscriptions.add(row);
    const { ownerId: _owner, ...payload } = row;
    void _owner;
    await enqueue(ownerId, "subscription", input.id, "CREATE", payload, null);
  });
}

export function updateSubscriptionLocally(ownerId: string, input: LocalSubscriptionInput) {
  return inLocalTransaction(async () => {
    await requireSubscriptions(ownerId);
    const existing = await offlineDb.subscriptions.get([ownerId, input.id]);
    if (!existing) throw new LocalMutationError("This subscription no longer exists.");
    const invalid = validateLocalSubscription(input);
    if (invalid) throw new LocalMutationError(invalid);
    const changes = { ...subscriptionColumns(input), updated_at: new Date().toISOString() };
    await offlineDb.subscriptions.update([ownerId, input.id], changes);
    await enqueue(ownerId, "subscription", input.id, "UPDATE", changes, existing.updated_at ?? null);
  });
}

export function setSubscriptionLifecycleLocally(
  ownerId: string,
  subscriptionId: string,
  lifecycle: SubscriptionLifecycle
) {
  return inLocalTransaction(async () => {
    await requireSubscriptions(ownerId);
    if (!isSubscriptionLifecycle(lifecycle)) throw new LocalMutationError("Choose a valid subscription state.");
    const existing = await offlineDb.subscriptions.get([ownerId, subscriptionId]);
    if (!existing) throw new LocalMutationError("This subscription no longer exists.");
    const changes = { lifecycle, updated_at: new Date().toISOString() };
    await offlineDb.subscriptions.update([ownerId, subscriptionId], changes);
    await enqueue(ownerId, "subscription", subscriptionId, "UPDATE", changes, existing.updated_at ?? null);
  });
}

export function deleteSubscriptionLocally(ownerId: string, subscriptionId: string) {
  return inLocalTransaction(async () => {
    await requireSubscriptions(ownerId);
    const existing = await offlineDb.subscriptions.get([ownerId, subscriptionId]);
    if (!existing) throw new LocalMutationError("This subscription no longer exists.");
    await offlineDb.subscriptions.delete([ownerId, subscriptionId]);
    const payments = await offlineDb.subscriptionPayments
      .where("[ownerId+subscription_id]").equals([ownerId, subscriptionId]).toArray();
    await offlineDb.subscriptionPayments.bulkDelete(payments.map((payment) => [ownerId, payment.id]));
    await enqueue(ownerId, "subscription", subscriptionId, "DELETE", { id: subscriptionId }, existing.updated_at ?? null);
  });
}

export function markSubscriptionPaidLocally(
  ownerId: string,
  input: { paymentId: string; subscriptionId: string; dueDate: string; paidAt?: string }
) {
  return inLocalTransaction(async () => {
    await requireSubscriptions(ownerId);
    const subscription = await offlineDb.subscriptions.get([ownerId, input.subscriptionId]);
    if (!subscription) throw new LocalMutationError("This subscription no longer exists.");
    if (subscription.lifecycle !== "active") throw new LocalMutationError("Resume this subscription before marking it paid.");
    const existing = await offlineDb.subscriptionPayments.get([ownerId, input.paymentId]);
    if (existing) return;
    if (subscription.next_payment_date !== input.dueDate) throw new LocalMutationError("This billing cycle is no longer current.");
    const paidAt = input.paidAt ?? new Date().toISOString();
    const nextPaymentDate = addBillingCycle(input.dueDate, subscription.billing_cycle, subscription.billing_anchor_day);
    const payment = {
      ownerId,
      id: input.paymentId,
      user_id: ownerId,
      subscription_id: input.subscriptionId,
      due_date: input.dueDate,
      paid_at: paidAt,
      created_at: paidAt,
      updated_at: paidAt,
    };
    await offlineDb.subscriptionPayments.add(payment);
    await offlineDb.subscriptions.update([ownerId, input.subscriptionId], {
      next_payment_date: nextPaymentDate,
      updated_at: paidAt,
    });
    const { ownerId: _owner, ...payload } = payment;
    void _owner;
    await enqueue(ownerId, "subscription_payment", input.paymentId, "CREATE", {
      ...payload,
      next_payment_date: nextPaymentDate,
    }, null);
  });
}

export function undoSubscriptionPaymentLocally(
  ownerId: string,
  input: { paymentId: string; subscriptionId: string; dueDate: string }
) {
  return inLocalTransaction(async () => {
    await requireSubscriptions(ownerId);
    const [subscription, payment] = await Promise.all([
      offlineDb.subscriptions.get([ownerId, input.subscriptionId]),
      offlineDb.subscriptionPayments.get([ownerId, input.paymentId]),
    ]);
    if (!subscription || !payment) throw new LocalMutationError("This payment no longer exists.");
    const expectedNext = addBillingCycle(payment.due_date, subscription.billing_cycle, subscription.billing_anchor_day);
    if (subscription.next_payment_date !== expectedNext) {
      throw new LocalMutationError("Only the most recently confirmed payment can be undone.");
    }
    const now = new Date().toISOString();
    await offlineDb.subscriptionPayments.delete([ownerId, input.paymentId]);
    await offlineDb.subscriptions.update([ownerId, input.subscriptionId], {
      next_payment_date: input.dueDate,
      updated_at: now,
    });
    await enqueue(ownerId, "subscription_payment", input.paymentId, "DELETE", {
      subscription_id: input.subscriptionId,
      due_date: input.dueDate,
    }, payment.updated_at ?? null);
  });
}

/* ---------------------------------------------------------------- bills tracker */

async function requireBills(ownerId: string) {
  await requireLocalSnapshot(ownerId);
  const meta = await offlineDb.syncMeta.get(ownerId);
  if (meta?.billsAvailable !== true) throw new LocalMutationError("Bills aren't ready on this device yet. Connect to the internet once, then try again.");
}

export interface LocalBillInput extends BillInput {
  id: string;
  lifecycle?: BillLifecycle;
}

function billColumns(input: LocalBillInput) {
  const [, , anchor] = input.nextDueDate.split("-").map(Number);
  return {
    name: input.name.trim(), category: input.category, icon: input.icon, amount_type: input.amountType,
    expected_amount: input.expectedAmount === null ? null : roundAmount(input.expectedAmount),
    currency: input.currency, billing_cycle: input.billingCycle,
    billing_interval: input.billingCycle.startsWith("custom_") ? input.billingInterval : 1,
    billing_anchor_day: anchor, start_date: input.startDate, next_due_date: input.nextDueDate,
    reminder_days: input.reminderDays, lifecycle: input.lifecycle ?? ("active" as const),
    notes: input.notes.trim() || null,
  };
}

function validateLocalBill(input: LocalBillInput) {
  const invalid = validateBillInput(input);
  if (invalid) return invalid;
  if (input.lifecycle && !isBillLifecycle(input.lifecycle)) return "Choose a valid bill state.";
  return null;
}

export function createBillLocally(ownerId: string, input: LocalBillInput) {
  return inLocalTransaction(async () => {
    await requireBills(ownerId);
    const invalid = validateLocalBill(input);
    if (invalid) throw new LocalMutationError(invalid);
    if (await offlineDb.bills.get([ownerId, input.id])) return;
    const now = new Date().toISOString();
    const row = { ownerId, id: input.id, user_id: ownerId, ...billColumns(input), created_at: now, updated_at: now };
    await offlineDb.bills.add(row);
    const { ownerId: _owner, ...payload } = row;
    void _owner;
    await enqueue(ownerId, "bill", input.id, "CREATE", payload, null);
  });
}

export function updateBillLocally(ownerId: string, input: LocalBillInput) {
  return inLocalTransaction(async () => {
    await requireBills(ownerId);
    const existing = await offlineDb.bills.get([ownerId, input.id]);
    if (!existing) throw new LocalMutationError("This bill no longer exists.");
    const invalid = validateLocalBill(input);
    if (invalid) throw new LocalMutationError(invalid);
    const changes = { ...billColumns(input), updated_at: new Date().toISOString() };
    await offlineDb.bills.update([ownerId, input.id], changes);
    await enqueue(ownerId, "bill", input.id, "UPDATE", changes, existing.updated_at ?? null);
  });
}

export function setBillLifecycleLocally(ownerId: string, billId: string, lifecycle: BillLifecycle) {
  return inLocalTransaction(async () => {
    await requireBills(ownerId);
    if (!isBillLifecycle(lifecycle)) throw new LocalMutationError("Choose a valid bill state.");
    const existing = await offlineDb.bills.get([ownerId, billId]);
    if (!existing) throw new LocalMutationError("This bill no longer exists.");
    const changes = { lifecycle, updated_at: new Date().toISOString() };
    await offlineDb.bills.update([ownerId, billId], changes);
    await enqueue(ownerId, "bill", billId, "UPDATE", changes, existing.updated_at ?? null);
  });
}

export function deleteBillLocally(ownerId: string, billId: string) {
  return inLocalTransaction(async () => {
    await requireBills(ownerId);
    const existing = await offlineDb.bills.get([ownerId, billId]);
    if (!existing) throw new LocalMutationError("This bill no longer exists.");
    await offlineDb.bills.delete([ownerId, billId]);
    const payments = await offlineDb.billPayments.where("[ownerId+bill_id]").equals([ownerId, billId]).toArray();
    await offlineDb.billPayments.bulkDelete(payments.map((payment) => [ownerId, payment.id]));
    await enqueue(ownerId, "bill", billId, "DELETE", { id: billId }, existing.updated_at ?? null);
  });
}

export interface LocalBillPaymentInput {
  paymentId: string;
  billId: string;
  dueDate: string;
  actualAmount: number;
  paymentDate: string;
  paidAt?: string;
}

export function createBillPaymentLocally(ownerId: string, input: LocalBillPaymentInput) {
  return inLocalTransaction(async () => {
    await requireBills(ownerId);
    const bill = await offlineDb.bills.get([ownerId, input.billId]);
    if (!bill) throw new LocalMutationError("This bill no longer exists.");
    if (bill.lifecycle !== "active") throw new LocalMutationError("Resume this bill before marking it paid.");
    const invalid = validateBillPayment(input.actualAmount, input.paymentDate, input.dueDate);
    if (invalid) throw new LocalMutationError(invalid);
    const duplicate = await offlineDb.billPayments.where("[ownerId+bill_id+due_date]").equals([ownerId, input.billId, input.dueDate]).first();
    if (duplicate) throw new LocalMutationError("This billing cycle is already paid.");
    const now = input.paidAt ?? new Date().toISOString();
    const advances = bill.next_due_date === input.dueDate;
    const nextDueDate = advances ? addBillCycle(input.dueDate, bill.billing_cycle, bill.billing_interval, bill.billing_anchor_day) : undefined;
    const row = {
      ownerId, id: input.paymentId, user_id: ownerId, bill_id: input.billId, due_date: input.dueDate,
      expected_amount: bill.expected_amount, actual_amount: roundAmount(input.actualAmount), payment_date: input.paymentDate,
      paid_at: now, status: "paid" as const, created_at: now, updated_at: now,
    };
    await offlineDb.billPayments.add(row);
    if (nextDueDate) await offlineDb.bills.update([ownerId, input.billId], { next_due_date: nextDueDate, updated_at: now });
    const { ownerId: _owner, ...payload } = row;
    void _owner;
    await enqueue(ownerId, "bill_payment", input.paymentId, "CREATE", { ...payload, next_due_date: nextDueDate }, null);
  });
}

export function updateBillPaymentLocally(ownerId: string, input: LocalBillPaymentInput) {
  return inLocalTransaction(async () => {
    await requireBills(ownerId);
    const payment = await offlineDb.billPayments.get([ownerId, input.paymentId]);
    if (!payment || payment.bill_id !== input.billId) throw new LocalMutationError("This bill payment no longer exists.");
    const invalid = validateBillPayment(input.actualAmount, input.paymentDate, payment.due_date);
    if (invalid) throw new LocalMutationError(invalid);
    const changes = { actual_amount: roundAmount(input.actualAmount), payment_date: input.paymentDate, updated_at: new Date().toISOString() };
    await offlineDb.billPayments.update([ownerId, input.paymentId], changes);
    await enqueue(ownerId, "bill_payment", input.paymentId, "UPDATE", changes, payment.updated_at ?? null);
  });
}

export function deleteBillPaymentLocally(ownerId: string, paymentId: string) {
  return inLocalTransaction(async () => {
    await requireBills(ownerId);
    const payment = await offlineDb.billPayments.get([ownerId, paymentId]);
    if (!payment) throw new LocalMutationError("This bill payment no longer exists.");
    const bill = await offlineDb.bills.get([ownerId, payment.bill_id]);
    const expectedNext = bill ? addBillCycle(payment.due_date, bill.billing_cycle, bill.billing_interval, bill.billing_anchor_day) : null;
    const rollbackDueDate = bill && bill.next_due_date === expectedNext ? payment.due_date : undefined;
    const now = new Date().toISOString();
    await offlineDb.billPayments.delete([ownerId, paymentId]);
    if (bill && rollbackDueDate) await offlineDb.bills.update([ownerId, bill.id], { next_due_date: rollbackDueDate, updated_at: now });
    await enqueue(ownerId, "bill_payment", paymentId, "DELETE", { bill_id: payment.bill_id, due_date: payment.due_date, rollback_due_date: rollbackDueDate }, payment.updated_at ?? null);
  });
}

import {
  ACCOUNT_GROUP_ERROR,
  isAccountGroup,
  normalizeAccountGroup,
} from "@/lib/accounts";
import { normalizeIncludeInSummary } from "@/lib/accountSummary";
import { validateBudgetAmount } from "@/lib/budget";
import {
  addBillCycle,
  isBillAmountType,
  isBillCategory,
  isBillCycle,
  isBillIcon,
  isBillLifecycle,
  sameBillMoney,
  validateBillInput,
  validateBillPayment,
} from "@/lib/bills";
import {
  dailyBudgetToday,
  isDateKey,
  roundAmount,
  toCents,
  validateDailyExpenseInput,
  validateDailyLimitInput,
} from "@/lib/dailyBudget";
import type { createClient } from "@/lib/supabase/server";
import {
  addBillingCycle,
  isBillingCycle,
  isSubscriptionIcon,
  isSubscriptionLifecycle,
  sameMoney,
  validateSubscriptionInput,
} from "@/lib/subscriptions";
import { countCategoryUsage, validateTransactionInput } from "@/lib/server/validation";
import {
  isAmbiguousLegacyTransactionDateUpdate,
  normalizeTransactionDate,
} from "@/lib/transactions";
import {
  SYNC_BATCH_SIZE,
  type SyncBatchResponse,
  type SyncConflict,
  type SyncOperation,
  type SyncOpResult,
} from "@/lib/sync/types";
import {
  ACCOUNT_RESTORE_WINDOW_MS,
  accountFieldsError,
  validateCategoryFields,
} from "@/lib/validation/rules";

type ServerClient = Awaited<ReturnType<typeof createClient>>;
type DbError = { code?: string; message: string } | null;
type Row = Record<string, unknown>;

/**
 * Applies a batch of offline changes for one authenticated user, in order, stopping at the
 * first change that is rejected or needs a retry.
 *
 * Security: the user id always comes from the session (`userId`), never from the payload;
 * every query filters on it in addition to RLS; only whitelisted columns are written.
 *
 * Idempotency (no extra tables needed): every change is recognised as already applied from
 * the database's own state, so resending after a lost response is harmless:
 *   CREATE  a row with this client-generated id already exists for this user
 *   UPDATE  the row already holds the requested values
 *   DELETE  the row is already gone
 *   budget  one row per user, compared by amount
 *   daily_limit  one row per user per effective date (the entity id), compared by amount
 *
 * Last write wins: a conflict exists when the server row changed after the version this device
 * edited (server updated_at > baseUpdatedAt). The later edit wins by edit time: this device's
 * editedAt (clamped so it can never be in the server's future) against the server row's
 * updated_at. A kept-server outcome writes nothing; both outcomes are reported back.
 */
export async function runSyncBatch(
  supabase: ServerClient,
  userId: string,
  operations: unknown,
  now = new Date()
): Promise<SyncBatchResponse> {
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > SYNC_BATCH_SIZE) {
    return { status: "invalid", results: [], error: `Send between 1 and ${SYNC_BATCH_SIZE} changes.` };
  }
  const ops = operations as SyncOperation[];
  for (const op of ops) {
    if (!isOperationShape(op)) return { status: "invalid", results: [], error: "A change in this batch is malformed." };
    if (op.ownerId !== userId) return { status: "wrong-user", results: [], error: "These changes belong to a different account." };
  }

  const results: SyncOpResult[] = [];
  // Within a batch a record's later change must compare against what this batch just wrote,
  // not against the version the device originally saw.
  const writtenAt = new Map<string, string | null>();

  for (const op of ops) {
    const key = `${op.entity}:${op.entityId}`;
    const effective = writtenAt.has(key) ? { ...op, baseUpdatedAt: writtenAt.get(key) ?? op.baseUpdatedAt } : op;
    let result: SyncOpResult;
    try {
      result = await applyOne(supabase, userId, effective, now);
    } catch (error) {
      console.error("Sync apply failed:", error instanceof Error ? error.message : error);
      result = { opId: op.opId, status: "retry", error: "The server couldn't apply this change right now." };
    }
    results.push(result);
    if (result.status === "applied" || result.status === "already-applied") {
      if (result.serverUpdatedAt !== undefined) writtenAt.set(key, result.serverUpdatedAt);
      continue;
    }
    break; // Stop at the first rejected/retry so later changes never overtake it.
  }

  return { status: "ok", results };
}

/* ------------------------------------------------------------------ helpers */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isOperationShape(op: SyncOperation) {
  return (
    !!op &&
    typeof op.opId === "string" &&
    typeof op.ownerId === "string" &&
    ["transaction", "account", "category", "budget", "daily_expense", "daily_limit", "subscription", "subscription_payment", "bill", "bill_payment"].includes(op.entity) &&
    ["CREATE", "UPDATE", "DELETE"].includes(op.op) &&
    typeof op.entityId === "string" &&
    (op.entity === "budget"
      ? op.entityId === op.ownerId
      : op.entity === "daily_limit"
        ? isDateKey(op.entityId)
        : UUID.test(op.entityId)) &&
    !!op.payload &&
    typeof op.payload === "object" &&
    (op.transactionDateIntent === undefined ||
      ["unchanged", "changed"].includes(op.transactionDateIntent)) &&
    typeof op.editedAt === "string"
  );
}

function ms(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The device's edit time, never later than the server's clock. */
function resolveEditedAt(value: string, now: Date) {
  const parsed = ms(value);
  return new Date(parsed === null ? now.getTime() : Math.min(parsed, now.getTime())).toISOString();
}

function lastWriteWins(serverUpdatedAt: unknown, base: string | null, editedAt: string) {
  const server = ms(serverUpdatedAt);
  const seen = ms(base);
  if (server === null || seen === null || server <= seen) return { apply: true as const, conflict: undefined };
  const conflict: SyncConflict = {
    outcome: ms(editedAt)! > server ? "kept-local" : "kept-server",
    serverUpdatedAt: String(serverUpdatedAt),
    clientEditedAt: editedAt,
  };
  return { apply: conflict.outcome === "kept-local", conflict };
}

function pick(source: Row, fields: readonly string[]) {
  const out: Row = {};
  for (const field of fields) if (Object.prototype.hasOwnProperty.call(source, field)) out[field] = source[field];
  return out;
}

const done = (op: SyncOperation, extra: Partial<SyncOpResult> = {}): SyncOpResult => ({ opId: op.opId, status: "applied", ...extra });
const already = (op: SyncOperation, serverUpdatedAt?: string | null): SyncOpResult => ({ opId: op.opId, status: "already-applied", serverUpdatedAt });
const rejected = (op: SyncOperation, error: string): SyncOpResult => ({ opId: op.opId, status: "rejected", error });
const reviewLegacyTransactionDate = (
  op: SyncOperation,
  serverTransactionDate: unknown
): SyncOpResult => ({
  opId: op.opId,
  status: "rejected",
  reviewReason: "legacy-transaction-date",
  serverTransactionDate: String(serverTransactionDate ?? ""),
  error:
    "Review this transaction and save it again. Its older offline edit cannot prove whether the date changed.",
});

/** Rule/permission/data errors need the user; anything else is treated as temporary. */
function fromDbError(op: SyncOperation, error: NonNullable<DbError>, messages: Record<string, string> = {}): SyncOpResult {
  const code = error.code ?? "";
  if (messages[code]) return rejected(op, messages[code]);
  if (code === "P0001") return rejected(op, error.message);
  if (code === "42501") return rejected(op, "You don't have permission to change this record.");
  if (code === "42703" || code === "42P01" || code === "PGRST204" || code === "PGRST205") {
    return rejected(op, "A database update is required before this change can sync.");
  }
  if (/^2[23]/.test(code)) return rejected(op, "The server rejected this change because its data is invalid.");
  return { opId: op.opId, status: "retry", error: "The server couldn't apply this change right now." };
}

async function applyOne(supabase: ServerClient, userId: string, op: SyncOperation, now: Date): Promise<SyncOpResult> {
  const editedAt = resolveEditedAt(op.editedAt, now);
  switch (op.entity) {
    case "transaction":
      return applyTransaction(supabase, userId, op, editedAt);
    case "account":
      return applyAccount(supabase, userId, op, editedAt, now);
    case "category":
      return applyCategory(supabase, userId, op);
    case "budget":
      return applyBudget(supabase, userId, op, editedAt);
    case "daily_expense":
      return applyDailyExpense(supabase, userId, op, editedAt, now);
    case "daily_limit":
      return applyDailyLimit(supabase, userId, op, editedAt, now);
    case "subscription":
      return applySubscription(supabase, userId, op, editedAt);
    case "subscription_payment":
      return applySubscriptionPayment(supabase, userId, op, editedAt);
    case "bill":
      return applyBill(supabase, userId, op, editedAt);
    case "bill_payment":
      return applyBillPayment(supabase, userId, op, editedAt);
  }
}

/* ------------------------------------------------------------------ transactions */

const TRANSACTION_FIELDS = ["account_id", "category_id", "type", "amount", "description", "transaction_date", "transaction_time"] as const;
const TRANSACTION_SELECT = "id, user_id, account_id, category_id, type, amount, description, transaction_date, transaction_time, updated_at";

function transactionColumns(source: Row) {
  const time = typeof source.transaction_time === "string" ? source.transaction_time.slice(0, 5) : "";
  const description = typeof source.description === "string" ? source.description.trim() : "";
  const rawDate = String(source.transaction_date ?? "");
  return {
    account_id: String(source.account_id ?? ""),
    category_id: String(source.category_id ?? ""),
    type: String(source.type ?? ""),
    amount: Number(source.amount),
    description: description || null,
    transaction_date: normalizeTransactionDate(rawDate) ?? rawDate,
    transaction_time: time ? `${time}:00` : null,
  };
}

function sameTransaction(a: ReturnType<typeof transactionColumns>, b: ReturnType<typeof transactionColumns>) {
  return (
    a.account_id === b.account_id &&
    a.category_id === b.category_id &&
    a.type === b.type &&
    Math.round(a.amount * 100) === Math.round(b.amount * 100) &&
    a.description === b.description &&
    a.transaction_date === b.transaction_date &&
    a.transaction_time === b.transaction_time
  );
}

async function validateTransactionColumns(supabase: ServerClient, userId: string, cols: ReturnType<typeof transactionColumns>) {
  return validateTransactionInput(
    {
      type: cols.type,
      amount: cols.amount,
      accountId: cols.account_id,
      categoryId: cols.category_id,
      transactionDate: cols.transaction_date,
      transactionTime: cols.transaction_time ? cols.transaction_time.slice(0, 5) : "",
      remark: cols.description ?? "",
    },
    userId,
    supabase
  );
}

async function loadOwnRow(supabase: ServerClient, table: string, select: string, userId: string, id: string) {
  const { data, error } = await supabase.from(table).select(select).eq("id", id).eq("user_id", userId).maybeSingle();
  return { row: (data as Row | null) ?? null, error: error as DbError };
}

async function applyTransaction(supabase: ServerClient, userId: string, op: SyncOperation, editedAt: string): Promise<SyncOpResult> {
  const { row, error } = await loadOwnRow(supabase, "transactions", TRANSACTION_SELECT, userId, op.entityId);
  if (error) return fromDbError(op, error);

  if (op.op === "CREATE") {
    if (row) return already(op, (row.updated_at as string) ?? null);
    const cols = transactionColumns(pick(op.payload, TRANSACTION_FIELDS));
    const invalid = await validateTransactionColumns(supabase, userId, cols);
    if (invalid) return rejected(op, invalid);
    const createdAt = resolveEditedAt(String(op.payload.created_at ?? editedAt), new Date(editedAt));
    const insert = await supabase
      .from("transactions")
      .insert({ id: op.entityId, user_id: userId, ...cols, created_at: createdAt, updated_at: editedAt });
    if (insert.error) {
      if (insert.error.code === "23505") {
        const again = await loadOwnRow(supabase, "transactions", "id, updated_at", userId, op.entityId);
        if (again.row) return already(op, (again.row.updated_at as string) ?? null);
      }
      return fromDbError(op, insert.error, { "23503": "The account or category for this transaction no longer exists." });
    }
    return done(op, { serverUpdatedAt: editedAt });
  }

  if (op.op === "UPDATE") {
    if (!row) return rejected(op, "This transaction no longer exists. It may have been deleted on another device.");
    const current = transactionColumns(row);
    const picked = pick(op.payload, TRANSACTION_FIELDS);
    if (
      op.transactionDateIntent === undefined &&
      isAmbiguousLegacyTransactionDateUpdate(
        row.transaction_date,
        picked.transaction_date
      )
    ) {
      return reviewLegacyTransactionDate(op, row.transaction_date);
    }
    if (op.transactionDateIntent === "unchanged") delete picked.transaction_date;
    const next = transactionColumns({ ...row, ...picked });
    if (sameTransaction(current, next)) return already(op, (row.updated_at as string) ?? null);
    const lww = lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
    if (!lww.apply) return done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
    const invalid = await validateTransactionColumns(supabase, userId, next);
    if (invalid) return rejected(op, invalid);
    const changes: Row = { ...next, updated_at: editedAt };
    if (current.transaction_date === next.transaction_date) delete changes.transaction_date;
    const update = await supabase
      .from("transactions")
      .update(changes)
      .eq("id", op.entityId)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();
    if (update.error) return fromDbError(op, update.error, { "23503": "The account or category for this transaction no longer exists." });
    if (!update.data) return rejected(op, "This transaction no longer exists. It may have been deleted on another device.");
    return done(op, { conflict: lww.conflict, serverUpdatedAt: editedAt });
  }

  // DELETE
  if (!row) return already(op, null);
  const lww = lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
  if (!lww.apply) return done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
  const removed = await supabase.from("transactions").delete().eq("id", op.entityId).eq("user_id", userId).select("id").maybeSingle();
  if (removed.error) return fromDbError(op, removed.error);
  return done(op, { conflict: lww.conflict, serverUpdatedAt: null });
}

/* ------------------------------------------------------------------ accounts */

const ACCOUNT_SELECT =
  "id, user_id, name, opening_balance, account_group, include_in_summary, deleted_at, updated_at";

async function applyAccount(supabase: ServerClient, userId: string, op: SyncOperation, editedAt: string, now: Date): Promise<SyncOpResult> {
  const { row, error } = await loadOwnRow(supabase, "accounts", ACCOUNT_SELECT, userId, op.entityId);
  if (error) return fromDbError(op, error);

  if (op.op === "CREATE") {
    if (row) return already(op, (row.updated_at as string) ?? null);
    const name = String(op.payload.name ?? "").trim();
    const opening = Number(op.payload.opening_balance ?? 0);
    const invalid = accountFieldsError(name, opening);
    if (invalid) return rejected(op, invalid);
    const accountType = typeof op.payload.account_type === "string" && op.payload.account_type ? op.payload.account_type : "other";
    // Changes queued before groups existed carry no group: the column default (general) applies.
    const hasGroup = op.payload.account_group !== undefined;
    if (hasGroup && !isAccountGroup(op.payload.account_group)) return rejected(op, ACCOUNT_GROUP_ERROR);
    const hasSummaryInclusion = op.payload.include_in_summary !== undefined;
    if (hasSummaryInclusion && typeof op.payload.include_in_summary !== "boolean") {
      return rejected(op, "Choose whether to include this account in financial summaries.");
    }
    const createdAt = resolveEditedAt(String(op.payload.created_at ?? editedAt), new Date(editedAt));
    // currency is omitted on purpose: the column default (INR) applies, like createAccountAction.
    const insert = await supabase.from("accounts").insert({
      id: op.entityId,
      user_id: userId,
      name,
      account_type: accountType,
      opening_balance: opening,
      ...(hasGroup ? { account_group: op.payload.account_group } : {}),
      ...(hasSummaryInclusion
        ? { include_in_summary: op.payload.include_in_summary }
        : {}),
      created_at: createdAt,
      updated_at: editedAt,
    });
    if (insert.error) {
      if (insert.error.code === "23505") {
        const again = await loadOwnRow(supabase, "accounts", "id, updated_at", userId, op.entityId);
        if (again.row) return already(op, (again.row.updated_at as string) ?? null);
      }
      return fromDbError(op, insert.error);
    }
    return done(op, { serverUpdatedAt: editedAt });
  }

  if (op.op === "DELETE") return rejected(op, "Accounts are moved to Trash, not deleted.");

  // UPDATE: name/opening edits and/or Trash (deleted_at set) / restore (deleted_at null).
  if (!row) return rejected(op, "This account no longer exists. It may have been permanently deleted from Trash.");
  const payload = pick(op.payload, [
    "name",
    "opening_balance",
    "account_group",
    "include_in_summary",
    "deleted_at",
  ]);
  if (payload.account_group !== undefined && !isAccountGroup(payload.account_group)) {
    return rejected(op, ACCOUNT_GROUP_ERROR);
  }
  if (payload.include_in_summary !== undefined && typeof payload.include_in_summary !== "boolean") {
    return rejected(op, "Choose whether to include this account in financial summaries.");
  }
  const wantsTrashChange = Object.prototype.hasOwnProperty.call(payload, "deleted_at");
  const wantTrashed = wantsTrashChange ? payload.deleted_at !== null : row.deleted_at !== null;
  const isTrashed = row.deleted_at !== null;
  const name = payload.name !== undefined ? String(payload.name).trim() : String(row.name);
  const opening = payload.opening_balance !== undefined ? Number(payload.opening_balance) : Number(row.opening_balance);
  // The group is part of "already applied": a group-only change must never be skipped as a no-op.
  const currentGroup = normalizeAccountGroup(row.account_group);
  const group = payload.account_group !== undefined ? normalizeAccountGroup(payload.account_group) : currentGroup;
  const groupChanged = group !== currentGroup;
  const currentSummaryInclusion = normalizeIncludeInSummary(row.include_in_summary);
  const includeInSummary =
    payload.include_in_summary !== undefined
      ? normalizeIncludeInSummary(payload.include_in_summary)
      : currentSummaryInclusion;
  const summaryInclusionChanged = includeInSummary !== currentSummaryInclusion;

  if (
    name === String(row.name) &&
    Number(opening) === Number(row.opening_balance) &&
    !groupChanged &&
    !summaryInclusionChanged &&
    wantTrashed === isTrashed
  ) {
    return already(op, (row.updated_at as string) ?? null);
  }
  const lww = lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
  if (!lww.apply) return done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });

  const invalid = accountFieldsError(name, opening);
  if (invalid) return rejected(op, invalid);
  const fieldsChanged =
    name !== String(row.name) ||
    Number(opening) !== Number(row.opening_balance) ||
    groupChanged ||
    summaryInclusionChanged;
  if (fieldsChanged && isTrashed && !(wantsTrashChange && !wantTrashed)) {
    return rejected(op, "This account is in Trash on the server. Restore it before editing.");
  }
  if (isTrashed && !wantTrashed) {
    const deletedAt = ms(row.deleted_at);
    if (deletedAt !== null && deletedAt <= now.getTime() - ACCOUNT_RESTORE_WINDOW_MS) {
      return rejected(op, "This account is no longer available for recovery.");
    }
  }

  // The protect_account_deleted_at trigger sets the real Trash time and enforces the 10-day
  // restore window, so the device's own deleted_at value is never trusted.
  const changes: Row = { name, opening_balance: opening, updated_at: editedAt };
  if (groupChanged) changes.account_group = group;
  if (summaryInclusionChanged) changes.include_in_summary = includeInSummary;
  if (wantTrashed !== isTrashed) changes.deleted_at = wantTrashed ? now.toISOString() : null;
  const update = await supabase
    .from("accounts")
    .update(changes)
    .eq("id", op.entityId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (update.error) return fromDbError(op, update.error);
  if (!update.data) return rejected(op, "This account no longer exists. It may have been permanently deleted from Trash.");
  return done(op, { conflict: lww.conflict, serverUpdatedAt: editedAt });
}

/* ------------------------------------------------------------------ categories */

const CATEGORY_MESSAGES = {
  "23505": "A category with this name already exists for that type.",
  "23503": "This category is used by transactions and cannot be deleted.",
};

async function applyCategory(supabase: ServerClient, userId: string, op: SyncOperation): Promise<SyncOpResult> {
  // Categories have no updated_at column, so there is nothing to compare: the edit is applied.
  const { data, error } = await supabase
    .from("categories")
    .select("id, user_id, name, type, icon, is_default")
    .eq("id", op.entityId)
    .eq("user_id", userId)
    .eq("is_default", false)
    .maybeSingle();
  if (error) return fromDbError(op, error as NonNullable<DbError>);
  const row = (data as Row | null) ?? null;

  if (op.op === "CREATE") {
    if (row) return already(op);
    const fields = validateCategoryFields({
      name: String(op.payload.name ?? ""),
      type: String(op.payload.type ?? ""),
      icon: String(op.payload.icon ?? ""),
    });
    if (fields.error || !fields.name) return rejected(op, fields.error ?? "Category name is required.");
    const insert = await supabase.from("categories").insert({
      id: op.entityId,
      user_id: userId,
      name: fields.name,
      type: op.payload.type,
      icon: op.payload.icon,
      is_default: false,
    });
    if (insert.error) {
      if (insert.error.code === "23505") {
        const again = await supabase.from("categories").select("id").eq("id", op.entityId).eq("user_id", userId).maybeSingle();
        if (again.data) return already(op);
      }
      return fromDbError(op, insert.error, CATEGORY_MESSAGES);
    }
    return done(op);
  }

  if (op.op === "UPDATE") {
    if (!row) return rejected(op, "This category no longer exists or can't be edited.");
    const merged = { name: String(row.name), type: String(row.type), icon: String(row.icon), ...pick(op.payload, ["name", "type", "icon"]) };
    const fields = validateCategoryFields({ name: String(merged.name), type: String(merged.type), icon: String(merged.icon) });
    if (fields.error || !fields.name) return rejected(op, fields.error ?? "Category name is required.");
    if (fields.name === row.name && merged.type === row.type && merged.icon === row.icon) return already(op);
    const update = await supabase
      .from("categories")
      .update({ name: fields.name, type: merged.type, icon: merged.icon })
      .eq("id", op.entityId)
      .eq("user_id", userId)
      .eq("is_default", false)
      .select("id")
      .maybeSingle();
    if (update.error) return fromDbError(op, update.error, CATEGORY_MESSAGES);
    if (!update.data) return rejected(op, "This category no longer exists or can't be edited.");
    return done(op);
  }

  // DELETE
  if (!row) return already(op);
  const used = await countCategoryUsage(supabase, userId, op.entityId);
  if (used === null) return { opId: op.opId, status: "retry", error: "Unable to check whether this category is in use." };
  if (used > 0) return rejected(op, "This category is used by transactions and cannot be deleted.");
  const removed = await supabase
    .from("categories")
    .delete()
    .eq("id", op.entityId)
    .eq("user_id", userId)
    .eq("is_default", false)
    .select("id")
    .maybeSingle();
  if (removed.error) return fromDbError(op, removed.error, CATEGORY_MESSAGES);
  return done(op);
}

/* ------------------------------------------------------------------ monthly budget */

async function applyBudget(supabase: ServerClient, userId: string, op: SyncOperation, editedAt: string): Promise<SyncOpResult> {
  const { data, error } = await supabase.from("monthly_budgets").select("id, amount, updated_at").eq("user_id", userId).maybeSingle();
  if (error) return fromDbError(op, error as NonNullable<DbError>);
  const row = (data as Row | null) ?? null;

  if (op.op === "DELETE") {
    if (!row) return already(op, null);
    const lww = lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
    if (!lww.apply) return done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
    const removed = await supabase.from("monthly_budgets").delete().eq("user_id", userId);
    if (removed.error) return fromDbError(op, removed.error);
    return done(op, { conflict: lww.conflict, serverUpdatedAt: null });
  }

  const value = Math.round(Number(op.payload.amount) * 100) / 100;
  const invalid = validateBudgetAmount(value);
  if (invalid) return rejected(op, invalid);
  if (row && Math.round(Number(row.amount) * 100) === Math.round(value * 100)) {
    return already(op, (row.updated_at as string) ?? null);
  }
  if (row) {
    const lww = lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
    if (!lww.apply) return done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
  }
  // Same upsert as saveMonthlyBudgetAction; the table's trigger maintains updated_at.
  const saved = await supabase
    .from("monthly_budgets")
    .upsert({ user_id: userId, amount: value }, { onConflict: "user_id" })
    .select("amount, updated_at")
    .single();
  if (saved.error) {
    return fromDbError(op, saved.error, { "42P01": "Run the monthly-budget migration before setting a budget." });
  }
  const conflict = row ? lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt).conflict : undefined;
  return done(op, { conflict, serverUpdatedAt: ((saved.data as Row | null)?.updated_at as string) ?? null });
}

/* ------------------------------------------------------------------ daily budget tracker */
// Writes only daily_budget_expenses / daily_budget_limits. Never touches accounts,
// transactions, categories or monthly_budgets.

const DAILY_MIGRATION_MESSAGE = "Run the daily-budget migration before using the daily budget.";
const DAILY_MIGRATION_MESSAGES = { "42P01": DAILY_MIGRATION_MESSAGE, PGRST205: DAILY_MIGRATION_MESSAGE };
const DAILY_EXPENSE_FIELDS = ["expense_date", "amount", "description"] as const;
const DAILY_EXPENSE_SELECT = "id, user_id, expense_date, amount, description, updated_at";
const DAILY_EXPENSE_MISSING = "This expense no longer exists. It may have been deleted on another device.";

function dailyExpenseColumns(source: Row) {
  return {
    expense_date: String(source.expense_date ?? ""),
    amount: roundAmount(Number(source.amount)),
    description: typeof source.description === "string" ? source.description.trim() : "",
  };
}

type DailyExpenseColumns = ReturnType<typeof dailyExpenseColumns>;

function sameDailyExpense(a: DailyExpenseColumns, b: DailyExpenseColumns) {
  return a.expense_date === b.expense_date && toCents(a.amount) === toCents(b.amount) && a.description === b.description;
}

function dailyExpenseError(cols: DailyExpenseColumns, now: Date) {
  return validateDailyExpenseInput(
    { amount: cols.amount, expenseDate: cols.expense_date, description: cols.description },
    dailyBudgetToday(now)
  );
}

async function applyDailyExpense(
  supabase: ServerClient,
  userId: string,
  op: SyncOperation,
  editedAt: string,
  now: Date
): Promise<SyncOpResult> {
  const { row, error } = await loadOwnRow(supabase, "daily_budget_expenses", DAILY_EXPENSE_SELECT, userId, op.entityId);
  if (error) return fromDbError(op, error, DAILY_MIGRATION_MESSAGES);

  if (op.op === "CREATE") {
    // The same client-generated id is already stored: a resend of an entry that went through.
    if (row) return already(op, (row.updated_at as string) ?? null);
    const cols = dailyExpenseColumns(pick(op.payload, DAILY_EXPENSE_FIELDS));
    const invalid = dailyExpenseError(cols, now);
    if (invalid) return rejected(op, invalid);
    const createdAt = resolveEditedAt(String(op.payload.created_at ?? editedAt), new Date(editedAt));
    const insert = await supabase
      .from("daily_budget_expenses")
      .insert({ id: op.entityId, user_id: userId, ...cols, created_at: createdAt, updated_at: editedAt });
    if (insert.error) {
      if (insert.error.code === "23505") {
        const again = await loadOwnRow(supabase, "daily_budget_expenses", "id, updated_at", userId, op.entityId);
        if (again.row) return already(op, (again.row.updated_at as string) ?? null);
      }
      return fromDbError(op, insert.error, DAILY_MIGRATION_MESSAGES);
    }
    return done(op, { serverUpdatedAt: editedAt });
  }

  if (op.op === "UPDATE") {
    if (!row) return rejected(op, DAILY_EXPENSE_MISSING);
    const current = dailyExpenseColumns(row);
    const next = dailyExpenseColumns({ ...row, ...pick(op.payload, DAILY_EXPENSE_FIELDS) });
    if (sameDailyExpense(current, next)) return already(op, (row.updated_at as string) ?? null);
    const lww = lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
    if (!lww.apply) return done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
    const invalid = dailyExpenseError(next, now);
    if (invalid) return rejected(op, invalid);
    const update = await supabase
      .from("daily_budget_expenses")
      .update({ ...next, updated_at: editedAt })
      .eq("id", op.entityId)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();
    if (update.error) return fromDbError(op, update.error, DAILY_MIGRATION_MESSAGES);
    if (!update.data) return rejected(op, DAILY_EXPENSE_MISSING);
    return done(op, { conflict: lww.conflict, serverUpdatedAt: editedAt });
  }

  // DELETE
  if (!row) return already(op, null);
  const lww = lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
  if (!lww.apply) return done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
  const removed = await supabase
    .from("daily_budget_expenses")
    .delete()
    .eq("id", op.entityId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (removed.error) return fromDbError(op, removed.error, DAILY_MIGRATION_MESSAGES);
  return done(op, { conflict: lww.conflict, serverUpdatedAt: null });
}

/** One limit per user per effective date; the entity id is that date (see isOperationShape). */
async function applyDailyLimit(
  supabase: ServerClient,
  userId: string,
  op: SyncOperation,
  editedAt: string,
  now: Date
): Promise<SyncOpResult> {
  const effectiveDate = op.entityId;
  const { data, error } = await supabase
    .from("daily_budget_limits")
    .select("id, effective_date, amount, updated_at")
    .eq("user_id", userId)
    .eq("effective_date", effectiveDate)
    .maybeSingle();
  if (error) return fromDbError(op, error as NonNullable<DbError>, DAILY_MIGRATION_MESSAGES);
  const row = (data as Row | null) ?? null;

  if (op.op === "DELETE") {
    if (!row) return already(op, null);
    const lww = lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
    if (!lww.apply) return done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
    const removed = await supabase
      .from("daily_budget_limits")
      .delete()
      .eq("user_id", userId)
      .eq("effective_date", effectiveDate);
    if (removed.error) return fromDbError(op, removed.error, DAILY_MIGRATION_MESSAGES);
    return done(op, { conflict: lww.conflict, serverUpdatedAt: null });
  }

  // CREATE and UPDATE both set the limit for this date (upsert on the unique user/date key, so
  // two devices choosing a limit for the same day can never create two allowances).
  const amount = roundAmount(Number(op.payload.amount));
  const invalid = validateDailyLimitInput({ amount, effectiveDate }, dailyBudgetToday(now));
  if (invalid) return rejected(op, invalid);
  if (row && toCents(row.amount as number | string) === toCents(amount)) {
    return already(op, (row.updated_at as string) ?? null);
  }
  if (row) {
    const lww = lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
    if (!lww.apply) return done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
  }
  const saved = await supabase
    .from("daily_budget_limits")
    .upsert(
      { user_id: userId, effective_date: effectiveDate, amount, updated_at: editedAt },
      { onConflict: "user_id,effective_date" }
    )
    .select("updated_at")
    .single();
  if (saved.error) return fromDbError(op, saved.error, DAILY_MIGRATION_MESSAGES);
  const conflict = row ? lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt).conflict : undefined;
  return done(op, { conflict, serverUpdatedAt: editedAt });
}

/* ------------------------------------------------------------------ subscriptions tracker */
// These handlers only access subscriptions / subscription_payments.

const SUBSCRIPTION_MIGRATION_MESSAGE = "Run the subscriptions migration before using subscriptions.";
const SUBSCRIPTION_MIGRATION_MESSAGES = { "42P01": SUBSCRIPTION_MIGRATION_MESSAGE, PGRST205: SUBSCRIPTION_MIGRATION_MESSAGE };
const SUBSCRIPTION_FIELDS = ["name", "icon", "amount", "currency", "billing_cycle", "billing_anchor_day", "start_date", "next_payment_date", "lifecycle", "notes"] as const;
const SUBSCRIPTION_SELECT = "id, user_id, name, icon, amount, currency, billing_cycle, billing_anchor_day, start_date, next_payment_date, lifecycle, notes, created_at, updated_at";
const SUBSCRIPTION_MISSING = "This subscription no longer exists.";

function subscriptionColumns(source: Row) {
  const notes = typeof source.notes === "string" ? source.notes.trim() : "";
  return {
    name: typeof source.name === "string" ? source.name.trim() : "",
    icon: String(source.icon ?? ""),
    amount: roundAmount(Number(source.amount)),
    currency: String(source.currency ?? "").toUpperCase(),
    billing_cycle: String(source.billing_cycle ?? ""),
    billing_anchor_day: Number(source.billing_anchor_day),
    start_date: String(source.start_date ?? ""),
    next_payment_date: String(source.next_payment_date ?? ""),
    lifecycle: String(source.lifecycle ?? ""),
    notes: notes || null,
  };
}

type SubscriptionColumns = ReturnType<typeof subscriptionColumns>;

function subscriptionError(cols: SubscriptionColumns) {
  if (!isBillingCycle(cols.billing_cycle)) return "Choose a supported billing cycle.";
  if (!isSubscriptionIcon(cols.icon)) return "Choose a valid subscription icon.";
  if (!isSubscriptionLifecycle(cols.lifecycle)) return "Choose a valid subscription state.";
  if (!Number.isInteger(cols.billing_anchor_day) || cols.billing_anchor_day < 1 || cols.billing_anchor_day > 31) return "Choose a valid billing date.";
  if (!isDateKey(cols.start_date)) return "Choose a valid start date.";
  return validateSubscriptionInput({
    name: cols.name,
    icon: cols.icon,
    amount: cols.amount,
    currency: cols.currency,
    billingCycle: cols.billing_cycle,
    nextPaymentDate: cols.next_payment_date,
    notes: cols.notes ?? "",
  });
}

function sameSubscription(a: SubscriptionColumns, b: SubscriptionColumns) {
  return a.name === b.name && a.icon === b.icon && sameMoney(a.amount, b.amount) && a.currency === b.currency &&
    a.billing_cycle === b.billing_cycle && a.billing_anchor_day === b.billing_anchor_day &&
    a.start_date === b.start_date && a.next_payment_date === b.next_payment_date &&
    a.lifecycle === b.lifecycle && a.notes === b.notes;
}

async function applySubscription(
  supabase: ServerClient,
  userId: string,
  op: SyncOperation,
  editedAt: string
): Promise<SyncOpResult> {
  const { row, error } = await loadOwnRow(supabase, "subscriptions", SUBSCRIPTION_SELECT, userId, op.entityId);
  if (error) return fromDbError(op, error, SUBSCRIPTION_MIGRATION_MESSAGES);

  if (op.op === "CREATE") {
    if (row) return already(op, (row.updated_at as string) ?? null);
    const cols = subscriptionColumns(pick(op.payload, SUBSCRIPTION_FIELDS));
    const invalid = subscriptionError(cols);
    if (invalid) return rejected(op, invalid);
    const createdAt = resolveEditedAt(String(op.payload.created_at ?? editedAt), new Date(editedAt));
    const insert = await supabase.from("subscriptions").insert({
      id: op.entityId, user_id: userId, ...cols, created_at: createdAt, updated_at: editedAt,
    });
    if (insert.error) {
      if (insert.error.code === "23505") {
        const again = await loadOwnRow(supabase, "subscriptions", "id, updated_at", userId, op.entityId);
        if (again.row) return already(op, (again.row.updated_at as string) ?? null);
      }
      return fromDbError(op, insert.error, SUBSCRIPTION_MIGRATION_MESSAGES);
    }
    return done(op, { serverUpdatedAt: editedAt });
  }

  if (op.op === "UPDATE") {
    if (!row) return rejected(op, SUBSCRIPTION_MISSING);
    const current = subscriptionColumns(row);
    const next = subscriptionColumns({ ...row, ...pick(op.payload, SUBSCRIPTION_FIELDS) });
    if (sameSubscription(current, next)) return already(op, (row.updated_at as string) ?? null);
    const invalid = subscriptionError(next);
    if (invalid) return rejected(op, invalid);
    const lww = lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
    if (!lww.apply) return done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
    const update = await supabase.from("subscriptions").update({ ...next, updated_at: editedAt })
      .eq("id", op.entityId).eq("user_id", userId).select("id").maybeSingle();
    if (update.error) return fromDbError(op, update.error, SUBSCRIPTION_MIGRATION_MESSAGES);
    if (!update.data) return rejected(op, SUBSCRIPTION_MISSING);
    return done(op, { conflict: lww.conflict, serverUpdatedAt: editedAt });
  }

  if (!row) return already(op, null);
  const lww = lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
  if (!lww.apply) return done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
  const removed = await supabase.from("subscriptions").delete().eq("id", op.entityId).eq("user_id", userId).select("id").maybeSingle();
  if (removed.error) return fromDbError(op, removed.error, SUBSCRIPTION_MIGRATION_MESSAGES);
  return done(op, { conflict: lww.conflict, serverUpdatedAt: null });
}

async function applySubscriptionPayment(
  supabase: ServerClient,
  userId: string,
  op: SyncOperation,
  editedAt: string
): Promise<SyncOpResult> {
  const subscriptionId = String(op.payload.subscription_id ?? "");
  const dueDate = String(op.payload.due_date ?? "");
  if (!UUID.test(subscriptionId) || !isDateKey(dueDate)) return rejected(op, "This payment is invalid.");
  const { row: subscription, error: subscriptionLoadError } = await loadOwnRow(
    supabase, "subscriptions", SUBSCRIPTION_SELECT, userId, subscriptionId
  );
  if (subscriptionLoadError) return fromDbError(op, subscriptionLoadError, SUBSCRIPTION_MIGRATION_MESSAGES);
  if (!subscription) return rejected(op, SUBSCRIPTION_MISSING);
  const cycle = subscription.billing_cycle;
  if (!isBillingCycle(cycle)) return rejected(op, "This subscription has an invalid billing cycle.");
  const nextDate = addBillingCycle(dueDate, cycle, Number(subscription.billing_anchor_day));
  const paymentResult = await loadOwnRow(
    supabase, "subscription_payments", "id, user_id, subscription_id, due_date, paid_at, updated_at", userId, op.entityId
  );
  if (paymentResult.error) return fromDbError(op, paymentResult.error, SUBSCRIPTION_MIGRATION_MESSAGES);
  const payment = paymentResult.row;

  if (op.op === "DELETE") {
    const expectedNext = nextDate;
    if (String(subscription.next_payment_date) !== expectedNext && String(subscription.next_payment_date) !== dueDate) {
      return rejected(op, "Only the most recently confirmed payment can be undone.");
    }
    if (payment) {
      const removed = await supabase.from("subscription_payments").delete()
        .eq("id", op.entityId).eq("user_id", userId).select("id").maybeSingle();
      if (removed.error) return fromDbError(op, removed.error, SUBSCRIPTION_MIGRATION_MESSAGES);
    }
    if (String(subscription.next_payment_date) !== dueDate) {
      const rolledBack = await supabase.from("subscriptions")
        .update({ next_payment_date: dueDate, updated_at: editedAt })
        .eq("id", subscriptionId).eq("user_id", userId).select("id").maybeSingle();
      if (rolledBack.error) return fromDbError(op, rolledBack.error, SUBSCRIPTION_MIGRATION_MESSAGES);
      if (!rolledBack.data) return rejected(op, SUBSCRIPTION_MISSING);
    }
    return done(op, { serverUpdatedAt: null });
  }

  if (String(subscription.lifecycle) !== "active") return rejected(op, "Resume this subscription before marking it paid.");
  if (!payment && String(subscription.next_payment_date) !== dueDate) {
    return rejected(op, "This billing cycle is no longer current.");
  }
  if (!payment) {
    const paidAt = resolveEditedAt(String(op.payload.paid_at ?? editedAt), new Date(editedAt));
    const inserted = await supabase.from("subscription_payments").insert({
      id: op.entityId,
      user_id: userId,
      subscription_id: subscriptionId,
      due_date: dueDate,
      paid_at: paidAt,
      created_at: paidAt,
      updated_at: editedAt,
    });
    if (inserted.error && inserted.error.code !== "23505") {
      return fromDbError(op, inserted.error, SUBSCRIPTION_MIGRATION_MESSAGES);
    }
  }
  if (String(subscription.next_payment_date) !== nextDate) {
    const advanced = await supabase.from("subscriptions")
      .update({ next_payment_date: nextDate, updated_at: editedAt })
      .eq("id", subscriptionId).eq("user_id", userId).select("id").maybeSingle();
    if (advanced.error) return fromDbError(op, advanced.error, SUBSCRIPTION_MIGRATION_MESSAGES);
    if (!advanced.data) return rejected(op, SUBSCRIPTION_MISSING);
  }
  return payment ? already(op, (payment.updated_at as string) ?? null) : done(op, { serverUpdatedAt: editedAt });
}

/* ------------------------------------------------------------------ bills tracker */

const BILL_MIGRATION_MESSAGE = "Run the Bills migration before using bills.";
const BILL_MIGRATION_MESSAGES = { "42P01": BILL_MIGRATION_MESSAGE, "42703": BILL_MIGRATION_MESSAGE, PGRST205: BILL_MIGRATION_MESSAGE };
const BILL_FIELDS = ["name", "category", "icon", "amount_type", "expected_amount", "currency", "billing_cycle", "billing_interval", "billing_anchor_day", "start_date", "next_due_date", "reminder_days", "lifecycle", "notes"] as const;
const BILL_SELECT = "id, user_id, name, category, icon, amount_type, expected_amount, currency, billing_cycle, billing_interval, billing_anchor_day, start_date, next_due_date, reminder_days, lifecycle, notes, created_at, updated_at";
const BILL_PAYMENT_SELECT = "id, user_id, bill_id, due_date, expected_amount, actual_amount, payment_date, paid_at, status, created_at, updated_at";

function billColumns(source: Row) {
  const notes = typeof source.notes === "string" ? source.notes.trim() : "";
  const expected = source.expected_amount === null || source.expected_amount === undefined || source.expected_amount === "" ? null : roundAmount(Number(source.expected_amount));
  return {
    name: typeof source.name === "string" ? source.name.trim() : "",
    category: String(source.category ?? ""), icon: String(source.icon ?? ""), amount_type: String(source.amount_type ?? ""),
    expected_amount: expected, currency: String(source.currency ?? "").toUpperCase(), billing_cycle: String(source.billing_cycle ?? ""),
    billing_interval: Number(source.billing_interval), billing_anchor_day: Number(source.billing_anchor_day),
    start_date: String(source.start_date ?? ""), next_due_date: String(source.next_due_date ?? ""),
    reminder_days: Number(source.reminder_days), lifecycle: String(source.lifecycle ?? ""), notes: notes || null,
  };
}
type BillColumns = ReturnType<typeof billColumns>;

function billError(cols: BillColumns) {
  if (!isBillCategory(cols.category)) return "Choose a valid bill category.";
  if (!isBillIcon(cols.icon)) return "Choose a valid bill icon.";
  if (!isBillAmountType(cols.amount_type)) return "Choose a valid amount type.";
  if (!isBillCycle(cols.billing_cycle)) return "Choose a valid billing frequency.";
  if (!isBillLifecycle(cols.lifecycle)) return "Choose a valid bill state.";
  if (!Number.isInteger(cols.billing_anchor_day) || cols.billing_anchor_day < 1 || cols.billing_anchor_day > 31) return "Choose a valid billing date.";
  return validateBillInput({
    name: cols.name, category: cols.category, icon: cols.icon, amountType: cols.amount_type,
    expectedAmount: cols.expected_amount, currency: cols.currency, billingCycle: cols.billing_cycle,
    billingInterval: cols.billing_interval, startDate: cols.start_date, nextDueDate: cols.next_due_date,
    reminderDays: cols.reminder_days, notes: cols.notes ?? "",
  });
}

function sameBill(a: BillColumns, b: BillColumns) {
  return a.name === b.name && a.category === b.category && a.icon === b.icon && a.amount_type === b.amount_type &&
    sameBillMoney(a.expected_amount, b.expected_amount) && a.currency === b.currency && a.billing_cycle === b.billing_cycle &&
    a.billing_interval === b.billing_interval && a.billing_anchor_day === b.billing_anchor_day && a.start_date === b.start_date &&
    a.next_due_date === b.next_due_date && a.reminder_days === b.reminder_days && a.lifecycle === b.lifecycle && a.notes === b.notes;
}

async function applyBill(supabase: ServerClient, userId: string, op: SyncOperation, editedAt: string): Promise<SyncOpResult> {
  const { row, error } = await loadOwnRow(supabase, "bills", BILL_SELECT, userId, op.entityId);
  if (error) return fromDbError(op, error, BILL_MIGRATION_MESSAGES);
  if (op.op === "CREATE") {
    if (row) return already(op, (row.updated_at as string) ?? null);
    const cols = billColumns(pick(op.payload, BILL_FIELDS));
    const invalid = billError(cols);
    if (invalid) return rejected(op, invalid);
    const createdAt = resolveEditedAt(String(op.payload.created_at ?? editedAt), new Date(editedAt));
    const inserted = await supabase.from("bills").insert({ id: op.entityId, user_id: userId, ...cols, created_at: createdAt, updated_at: editedAt });
    if (inserted.error) {
      if (inserted.error.code === "23505") {
        const again = await loadOwnRow(supabase, "bills", "id, updated_at", userId, op.entityId);
        if (again.row) return already(op, (again.row.updated_at as string) ?? null);
      }
      return fromDbError(op, inserted.error, BILL_MIGRATION_MESSAGES);
    }
    return done(op, { serverUpdatedAt: editedAt });
  }
  if (op.op === "UPDATE") {
    if (!row) return rejected(op, "This bill no longer exists.");
    const current = billColumns(row);
    const next = billColumns({ ...row, ...pick(op.payload, BILL_FIELDS) });
    if (sameBill(current, next)) return already(op, (row.updated_at as string) ?? null);
    const invalid = billError(next);
    if (invalid) return rejected(op, invalid);
    const lww = lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
    if (!lww.apply) return done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
    const updated = await supabase.from("bills").update({ ...next, updated_at: editedAt }).eq("id", op.entityId).eq("user_id", userId).select("id").maybeSingle();
    if (updated.error) return fromDbError(op, updated.error, BILL_MIGRATION_MESSAGES);
    if (!updated.data) return rejected(op, "This bill no longer exists.");
    return done(op, { conflict: lww.conflict, serverUpdatedAt: editedAt });
  }
  if (!row) return already(op, null);
  const lww = lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
  if (!lww.apply) return done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
  const removed = await supabase.from("bills").delete().eq("id", op.entityId).eq("user_id", userId).select("id").maybeSingle();
  if (removed.error) return fromDbError(op, removed.error, BILL_MIGRATION_MESSAGES);
  return done(op, { conflict: lww.conflict, serverUpdatedAt: null });
}

async function applyBillPayment(supabase: ServerClient, userId: string, op: SyncOperation, editedAt: string): Promise<SyncOpResult> {
  const existingResult = await loadOwnRow(supabase, "bill_payments", BILL_PAYMENT_SELECT, userId, op.entityId);
  if (existingResult.error) return fromDbError(op, existingResult.error, BILL_MIGRATION_MESSAGES);
  const payment = existingResult.row;

  if (op.op === "UPDATE") {
    if (!payment) return rejected(op, "This bill payment no longer exists.");
    const actual = roundAmount(Number(op.payload.actual_amount ?? payment.actual_amount));
    const paymentDate = String(op.payload.payment_date ?? payment.payment_date);
    const invalid = validateBillPayment(actual, paymentDate, String(payment.due_date));
    if (invalid) return rejected(op, invalid);
    if (toCents(actual) === toCents(Number(payment.actual_amount)) && paymentDate === payment.payment_date) return already(op, (payment.updated_at as string) ?? null);
    const lww = lastWriteWins(payment.updated_at, op.baseUpdatedAt, editedAt);
    if (!lww.apply) return done(op, { conflict: lww.conflict, serverUpdatedAt: (payment.updated_at as string) ?? null });
    const updated = await supabase.from("bill_payments").update({ actual_amount: actual, payment_date: paymentDate, updated_at: editedAt })
      .eq("id", op.entityId).eq("user_id", userId).select("id").maybeSingle();
    if (updated.error) return fromDbError(op, updated.error, BILL_MIGRATION_MESSAGES);
    return done(op, { conflict: lww.conflict, serverUpdatedAt: editedAt });
  }

  const billId = String(op.payload.bill_id ?? payment?.bill_id ?? "");
  if (!UUID.test(billId)) return rejected(op, "This bill payment is invalid.");
  const billResult = await loadOwnRow(supabase, "bills", BILL_SELECT, userId, billId);
  if (billResult.error) return fromDbError(op, billResult.error, BILL_MIGRATION_MESSAGES);
  const bill = billResult.row;

  if (op.op === "DELETE") {
    const dueDate = String(payment?.due_date ?? op.payload.due_date ?? "");
    if (!payment) {
      if (bill && isDateKey(dueDate) && isBillCycle(bill.billing_cycle)) {
        const expectedNext = addBillCycle(dueDate, bill.billing_cycle, Number(bill.billing_interval), Number(bill.billing_anchor_day));
        if (String(bill.next_due_date) === expectedNext) {
          const rollback = await supabase.from("bills").update({ next_due_date: dueDate, updated_at: editedAt })
            .eq("id", billId).eq("user_id", userId).select("id").maybeSingle();
          if (rollback.error) return fromDbError(op, rollback.error, BILL_MIGRATION_MESSAGES);
        }
      }
      return already(op, null);
    }
    const lww = lastWriteWins(payment.updated_at, op.baseUpdatedAt, editedAt);
    if (!lww.apply) return done(op, { conflict: lww.conflict, serverUpdatedAt: (payment.updated_at as string) ?? null });
    const removed = await supabase.from("bill_payments").delete().eq("id", op.entityId).eq("user_id", userId).select("id").maybeSingle();
    if (removed.error) return fromDbError(op, removed.error, BILL_MIGRATION_MESSAGES);
    if (bill && isBillCycle(bill.billing_cycle)) {
      const expectedNext = addBillCycle(String(payment.due_date), bill.billing_cycle, Number(bill.billing_interval), Number(bill.billing_anchor_day));
      if (String(bill.next_due_date) === expectedNext) {
        const rollback = await supabase.from("bills").update({ next_due_date: payment.due_date, updated_at: editedAt })
          .eq("id", billId).eq("user_id", userId).select("id").maybeSingle();
        if (rollback.error) return fromDbError(op, rollback.error, BILL_MIGRATION_MESSAGES);
      }
    }
    return done(op, { conflict: lww.conflict, serverUpdatedAt: null });
  }

  if (payment) {
    if (bill && isBillCycle(bill.billing_cycle) && String(bill.next_due_date) === String(payment.due_date)) {
      const nextDue = addBillCycle(String(payment.due_date), bill.billing_cycle, Number(bill.billing_interval), Number(bill.billing_anchor_day));
      const advanced = await supabase.from("bills").update({ next_due_date: nextDue, updated_at: editedAt })
        .eq("id", billId).eq("user_id", userId).select("id").maybeSingle();
      if (advanced.error) return fromDbError(op, advanced.error, BILL_MIGRATION_MESSAGES);
    }
    return already(op, (payment.updated_at as string) ?? null);
  }
  if (!bill) return rejected(op, "This bill no longer exists.");
  if (bill.lifecycle !== "active") return rejected(op, "Resume this bill before marking it paid.");
  if (!isBillCycle(bill.billing_cycle)) return rejected(op, "This bill has an invalid billing frequency.");
  const dueDate = String(op.payload.due_date ?? "");
  const paymentDate = String(op.payload.payment_date ?? "");
  const actual = roundAmount(Number(op.payload.actual_amount));
  const invalid = validateBillPayment(actual, paymentDate, dueDate);
  if (invalid) return rejected(op, invalid);
  const duplicate = await supabase.from("bill_payments").select("id").eq("user_id", userId).eq("bill_id", billId).eq("due_date", dueDate).maybeSingle();
  if (duplicate.error) return fromDbError(op, duplicate.error, BILL_MIGRATION_MESSAGES);
  if (duplicate.data) return rejected(op, "This billing cycle is already paid.");
  const paidAt = resolveEditedAt(String(op.payload.paid_at ?? editedAt), new Date(editedAt));
  const inserted = await supabase.from("bill_payments").insert({
    id: op.entityId, user_id: userId, bill_id: billId, due_date: dueDate,
    expected_amount: bill.expected_amount, actual_amount: actual, payment_date: paymentDate,
    paid_at: paidAt, status: "paid", created_at: paidAt, updated_at: editedAt,
  });
  if (inserted.error) return fromDbError(op, inserted.error, BILL_MIGRATION_MESSAGES);
  if (String(bill.next_due_date) === dueDate) {
    const nextDue = addBillCycle(dueDate, bill.billing_cycle, Number(bill.billing_interval), Number(bill.billing_anchor_day));
    const advanced = await supabase.from("bills").update({ next_due_date: nextDue, updated_at: editedAt })
      .eq("id", billId).eq("user_id", userId).select("id").maybeSingle();
    if (advanced.error) return fromDbError(op, advanced.error, BILL_MIGRATION_MESSAGES);
  }
  return done(op, { serverUpdatedAt: editedAt });
}

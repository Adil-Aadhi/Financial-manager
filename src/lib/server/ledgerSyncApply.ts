import {
  LEDGER_COLUMNS,
  normalizeExpense,
  normalizeGroup,
  normalizeMember,
  normalizeObligation,
  normalizePayment,
  normalizePerson,
  normalizeRate,
  normalizeSpan,
  type LedgerEntity,
  type LedgerShare,
  type Normalized,
} from "@/lib/ledger";
import type { createClient } from "@/lib/supabase/server";
import type { SyncConflict, SyncOperation, SyncOpResult } from "@/lib/sync/types";

type ServerClient = Awaited<ReturnType<typeof createClient>>;
type Row = Record<string, unknown>;
type DbError = { code?: string; message: string } | null;

/** The result helpers and row loader of the main sync applier, passed in to avoid a circular import. */
export interface LedgerApplyHelpers {
  done: (op: SyncOperation, extra?: Partial<SyncOpResult>) => SyncOpResult;
  already: (op: SyncOperation, serverUpdatedAt?: string | null) => SyncOpResult;
  rejected: (op: SyncOperation, error: string) => SyncOpResult;
  fromDbError: (op: SyncOperation, error: NonNullable<DbError>, messages?: Record<string, string>) => SyncOpResult;
  lastWriteWins: (
    serverUpdatedAt: unknown,
    base: string | null,
    editedAt: string
  ) => { apply: boolean; conflict: SyncConflict | undefined };
  loadOwnRow: (
    supabase: ServerClient,
    table: string,
    select: string,
    userId: string,
    id: string
  ) => Promise<{ row: Row | null; error: DbError }>;
}

const MIGRATION_MESSAGE = "Run the Personal Ledger migration before using the ledger.";
const MIGRATION_MESSAGES: Record<string, string> = {
  "42P01": MIGRATION_MESSAGE,
  "42703": MIGRATION_MESSAGE,
  "42883": MIGRATION_MESSAGE,
  PGRST202: MIGRATION_MESSAGE,
  PGRST205: MIGRATION_MESSAGE,
};

interface RowEntityConfig {
  table: string;
  select: string;
  fields: readonly string[];
  normalize: (source: Row) => Normalized;
  label: string;
  messages: Record<string, string>;
}

const ROW_ENTITIES: Partial<Record<LedgerEntity, RowEntityConfig>> = {
  ledger_person: {
    table: "ledger_people",
    select: LEDGER_COLUMNS.ledger_people,
    fields: ["name", "phone", "notes", "archived_at"],
    normalize: normalizePerson,
    label: "person",
    messages: {
      ...MIGRATION_MESSAGES,
      "23505": "You already have someone with this name. Choose them instead of adding again.",
      "23503": "This person has history, so archive them instead of deleting.",
    },
  },
  ledger_group: {
    table: "ledger_groups",
    select: LEDGER_COLUMNS.ledger_groups,
    fields: ["name", "description", "frequency", "frequency_interval", "start_date", "due_offset_days", "is_active", "currency"],
    normalize: normalizeGroup,
    label: "group",
    // 23503 here means something was added to the group while it was being deleted; the delete was
    // rolled back as a whole, so nothing was lost. Retrying shows the group's current state.
    messages: { ...MIGRATION_MESSAGES, "23503": "Something was added to this group while it was being deleted, so nothing was deleted. Check the group and try again." },
  },
  ledger_member: {
    table: "ledger_members",
    select: LEDGER_COLUMNS.ledger_members,
    fields: ["group_id", "person_id", "joined_on"],
    normalize: normalizeMember,
    label: "member",
    messages: {
      ...MIGRATION_MESSAGES,
      "23505": "This person is already in the group.",
      "23503": "This member has dues, or their group or person no longer exists.",
    },
  },
  ledger_rate: {
    table: "ledger_member_rates",
    select: LEDGER_COLUMNS.ledger_member_rates,
    fields: ["member_id", "effective_from", "amount"],
    normalize: normalizeRate,
    label: "contribution",
    messages: { ...MIGRATION_MESSAGES, "23505": "This member already has an amount starting that day.", "23503": "This member no longer exists." },
  },
  ledger_span: {
    table: "ledger_member_spans",
    select: LEDGER_COLUMNS.ledger_member_spans,
    fields: ["member_id", "from_date", "to_date", "end_reason"],
    normalize: normalizeSpan,
    label: "membership period",
    messages: { ...MIGRATION_MESSAGES, "23505": "This member is already active.", "23503": "This member no longer exists." },
  },
};

const OBLIGATION_FIELDS = ["person_id", "source", "origin", "group_id", "member_id", "period_start", "title", "amount", "due_date", "currency", "note"] as const;
const EXPENSE_FIELDS = ["title", "description", "total_amount", "expense_date", "category", "allow_unallocated", "currency", "shares"] as const;
const PAYMENT_FIELDS = ["obligation_id", "amount", "paid_on", "note", "voided_at"] as const;

/* ------------------------------------------------------------------ small helpers */

function pickFields(source: Row, fields: readonly string[]) {
  const out: Row = {};
  for (const field of fields) if (Object.prototype.hasOwnProperty.call(source, field)) out[field] = source[field];
  return out;
}

/** A client timestamp, never later than the moment the change was edited. */
function clampIso(value: unknown, ceiling: string) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  const max = Date.parse(ceiling);
  return new Date(Number.isFinite(parsed) ? Math.min(parsed, max) : max).toISOString();
}

function sameColumns(a: Row, b: Row) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key] ?? null;
    const right = b[key] ?? null;
    if (key.endsWith("_at") && typeof left === "string" && typeof right === "string") {
      if (Date.parse(left) !== Date.parse(right)) return false;
    } else if (JSON.stringify(left) !== JSON.stringify(right)) {
      return false;
    }
  }
  return true;
}

function normalizedOrNull(normalize: (source: Row) => Normalized, source: Row) {
  const result = normalize(source);
  return result.ok ? result.columns : null;
}

/* ------------------------------------------------------------------ entry point */

export async function applyLedgerOperation(
  supabase: ServerClient,
  userId: string,
  op: SyncOperation,
  editedAt: string,
  helpers: LedgerApplyHelpers
): Promise<SyncOpResult> {
  switch (op.entity as LedgerEntity) {
    case "ledger_obligation":
      return applyObligation(supabase, userId, op, editedAt, helpers);
    case "ledger_expense":
      return applyExpense(supabase, userId, op, editedAt, helpers);
    case "ledger_payment":
      return applyPayment(supabase, userId, op, editedAt, helpers);
    default:
      return applyRowEntity(supabase, userId, op, editedAt, helpers);
  }
}

/* ------------------------------------------------------------------ people, groups, members, rates, spans */

async function applyRowEntity(
  supabase: ServerClient,
  userId: string,
  op: SyncOperation,
  editedAt: string,
  h: LedgerApplyHelpers
): Promise<SyncOpResult> {
  const config = ROW_ENTITIES[op.entity as LedgerEntity];
  if (!config) return h.rejected(op, "Unknown ledger record.");
  const { row, error } = await h.loadOwnRow(supabase, config.table, config.select, userId, op.entityId);
  if (error) return h.fromDbError(op, error, config.messages);

  if (op.op === "CREATE") {
    if (row) return h.already(op, (row.updated_at as string) ?? null);
    const normalized = config.normalize(pickFields(op.payload, config.fields));
    if (!normalized.ok) return h.rejected(op, normalized.error);
    const inserted = await supabase.from(config.table).insert({
      id: op.entityId,
      user_id: userId,
      ...normalized.columns,
      created_at: clampIso(op.payload.created_at, editedAt),
      updated_at: editedAt,
    });
    if (inserted.error) {
      if (inserted.error.code === "23505") {
        const again = await h.loadOwnRow(supabase, config.table, "id, updated_at", userId, op.entityId);
        if (again.row) return h.already(op, (again.row.updated_at as string) ?? null);
      }
      return h.fromDbError(op, inserted.error, config.messages);
    }
    return h.done(op, { serverUpdatedAt: editedAt });
  }

  if (op.op === "UPDATE") {
    if (!row) return h.rejected(op, `This ${config.label} no longer exists.`);
    const next = config.normalize({ ...row, ...pickFields(op.payload, config.fields) });
    if (!next.ok) return h.rejected(op, next.error);
    const current = normalizedOrNull(config.normalize, row);
    if (current && sameColumns(current, next.columns)) return h.already(op, (row.updated_at as string) ?? null);
    const lww = h.lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
    if (!lww.apply) return h.done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
    const updated = await supabase
      .from(config.table)
      .update({ ...next.columns, updated_at: editedAt })
      .eq("id", op.entityId)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();
    if (updated.error) return h.fromDbError(op, updated.error, config.messages);
    if (!updated.data) return h.rejected(op, `This ${config.label} no longer exists.`);
    return h.done(op, { conflict: lww.conflict, serverUpdatedAt: editedAt });
  }

  if (op.entity === "ledger_rate" || op.entity === "ledger_span") {
    return h.rejected(op, "This history entry can't be deleted.");
  }
  if (!row) return h.already(op, null);
  const lww = h.lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
  if (!lww.apply) return h.done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
  if (op.entity === "ledger_group") {
    // The group, its members and its dues are removed together, and only without payment history.
    const groupRemoved = await supabase.rpc("ledger_delete_group", { p_id: op.entityId });
    if (groupRemoved.error) return h.fromDbError(op, groupRemoved.error as NonNullable<DbError>, config.messages);
    return h.done(op, { conflict: lww.conflict, serverUpdatedAt: null });
  }
  const removed = await supabase.from(config.table).delete().eq("id", op.entityId).eq("user_id", userId).select("id").maybeSingle();
  if (removed.error) return h.fromDbError(op, removed.error, config.messages);
  return h.done(op, { conflict: lww.conflict, serverUpdatedAt: null });
}

/* ------------------------------------------------------------------ obligations */

async function applyObligation(
  supabase: ServerClient,
  userId: string,
  op: SyncOperation,
  editedAt: string,
  h: LedgerApplyHelpers
): Promise<SyncOpResult> {
  const { row, error } = await h.loadOwnRow(supabase, "ledger_obligations", LEDGER_COLUMNS.ledger_obligations, userId, op.entityId);
  if (error) return h.fromDbError(op, error, MIGRATION_MESSAGES);

  if (op.op === "DELETE") {
    if (!row) return h.already(op, null);
    const lww = h.lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
    if (!lww.apply) return h.done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
    const removed = await supabase.rpc("ledger_delete_obligation", { p_id: op.entityId });
    if (removed.error) return h.fromDbError(op, removed.error as NonNullable<DbError>, MIGRATION_MESSAGES);
    return h.done(op, { conflict: lww.conflict, serverUpdatedAt: null });
  }

  let normalized: Normalized;
  if (op.op === "CREATE") {
    if (row) return h.already(op, (row.updated_at as string) ?? null);
    normalized = normalizeObligation(pickFields(op.payload, OBLIGATION_FIELDS));
  } else {
    if (!row) return h.rejected(op, "This due no longer exists.");
    if (row.source === "shared") return h.rejected(op, "Edit the expense to change a shared due.");
    normalized = normalizeObligation({ ...row, ...pickFields(op.payload, OBLIGATION_FIELDS) });
  }
  if (!normalized.ok) return h.rejected(op, normalized.error);

  let conflict: SyncConflict | undefined;
  if (op.op === "UPDATE" && row) {
    const current = normalizedOrNull(normalizeObligation, row);
    if (current && sameColumns(current, normalized.columns)) return h.already(op, (row.updated_at as string) ?? null);
    const lww = h.lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
    if (!lww.apply) return h.done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
    conflict = lww.conflict;
  }

  const c = normalized.columns;
  const saved = await supabase.rpc("ledger_save_obligation", {
    p_id: op.entityId,
    p_person_id: c.person_id,
    p_source: c.source,
    p_group_id: c.group_id,
    p_member_id: c.member_id,
    p_period_start: c.period_start,
    p_title: c.title,
    p_amount: c.amount,
    p_due_date: c.due_date,
    p_currency: c.currency,
    p_note: c.note,
    p_created_at: clampIso(op.payload.created_at, editedAt),
    p_edited_at: editedAt,
    // null lets the database work the origin out (older queued changes carry none).
    p_origin: c.origin ?? null,
  });
  if (saved.error) return h.fromDbError(op, saved.error as NonNullable<DbError>, MIGRATION_MESSAGES);
  return h.done(op, { conflict, serverUpdatedAt: editedAt });
}

/* ------------------------------------------------------------------ shared expenses */

async function applyExpense(
  supabase: ServerClient,
  userId: string,
  op: SyncOperation,
  editedAt: string,
  h: LedgerApplyHelpers
): Promise<SyncOpResult> {
  const { row, error } = await h.loadOwnRow(supabase, "ledger_expenses", LEDGER_COLUMNS.ledger_expenses, userId, op.entityId);
  if (error) return h.fromDbError(op, error, MIGRATION_MESSAGES);

  if (op.op === "DELETE") {
    if (!row) return h.already(op, null);
    const lww = h.lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
    if (!lww.apply) return h.done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
    const removed = await supabase.rpc("ledger_delete_expense", { p_id: op.entityId });
    if (removed.error) return h.fromDbError(op, removed.error as NonNullable<DbError>, MIGRATION_MESSAGES);
    return h.done(op, { conflict: lww.conflict, serverUpdatedAt: null });
  }

  let conflict: SyncConflict | undefined;
  if (op.op === "CREATE") {
    if (row) return h.already(op, (row.updated_at as string) ?? null);
  } else {
    if (!row) return h.rejected(op, "This expense no longer exists.");
    const lww = h.lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
    if (!lww.apply) return h.done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
    conflict = lww.conflict;
  }
  const normalized = normalizeExpense({ ...(row ?? {}), ...pickFields(op.payload, EXPENSE_FIELDS) });
  if (!normalized.ok) return h.rejected(op, normalized.error);

  const c = normalized.columns;
  const saved = await supabase.rpc("ledger_save_expense", {
    p_id: op.entityId,
    p_title: c.title,
    p_description: c.description,
    p_total: c.total_amount,
    p_date: c.expense_date,
    p_category: c.category,
    p_allow_unallocated: c.allow_unallocated,
    p_currency: c.currency,
    p_shares: (c.shares as LedgerShare[]).map((share) => ({ id: share.id, person_id: share.person_id, amount: share.amount })),
    p_created_at: clampIso(op.payload.created_at, editedAt),
    p_edited_at: editedAt,
  });
  if (saved.error) return h.fromDbError(op, saved.error as NonNullable<DbError>, MIGRATION_MESSAGES);
  return h.done(op, { conflict, serverUpdatedAt: editedAt });
}

/* ------------------------------------------------------------------ payments */

async function applyPayment(
  supabase: ServerClient,
  userId: string,
  op: SyncOperation,
  editedAt: string,
  h: LedgerApplyHelpers
): Promise<SyncOpResult> {
  if (op.op === "DELETE") return h.rejected(op, "Payments are never deleted. Void the payment instead.");
  const { row, error } = await h.loadOwnRow(supabase, "ledger_payments", LEDGER_COLUMNS.ledger_payments, userId, op.entityId);
  if (error) return h.fromDbError(op, error, MIGRATION_MESSAGES);

  let normalized: Normalized;
  let conflict: SyncConflict | undefined;
  if (op.op === "CREATE") {
    // The payment id is the idempotency key: a resend after a lost response finds the row.
    if (row) return h.already(op, (row.updated_at as string) ?? null);
    normalized = normalizePayment(pickFields(op.payload, PAYMENT_FIELDS));
  } else {
    if (!row) return h.rejected(op, "This payment no longer exists.");
    normalized = normalizePayment({ ...row, ...pickFields(op.payload, PAYMENT_FIELDS) });
    if (normalized.ok) {
      const current = normalizedOrNull(normalizePayment, row);
      if (current && sameColumns(current, normalized.columns)) return h.already(op, (row.updated_at as string) ?? null);
      const lww = h.lastWriteWins(row.updated_at, op.baseUpdatedAt, editedAt);
      if (!lww.apply) return h.done(op, { conflict: lww.conflict, serverUpdatedAt: (row.updated_at as string) ?? null });
      conflict = lww.conflict;
    }
  }
  if (!normalized.ok) return h.rejected(op, normalized.error);

  const c = normalized.columns;
  // The database refuses a payment above the remaining balance (guard trigger, obligation locked).
  const saved = await supabase.rpc("ledger_save_payment", {
    p_id: op.entityId,
    p_obligation_id: c.obligation_id,
    p_amount: c.amount,
    p_paid_on: c.paid_on,
    p_note: c.note,
    p_voided: c.voided_at !== null,
    p_created_at: clampIso(op.payload.created_at, editedAt),
    p_edited_at: editedAt,
  });
  if (saved.error) return h.fromDbError(op, saved.error as NonNullable<DbError>, MIGRATION_MESSAGES);
  return h.done(op, { conflict, serverUpdatedAt: editedAt });
}

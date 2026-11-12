import {
  isLedgerEntity,
  type LedgerExpenseRecord,
  type LedgerGroupRecord,
  type LedgerMemberRecord,
  type LedgerObligationRecord,
  type LedgerOperation,
  type LedgerPaymentRecord,
  type LedgerPersonRecord,
  type LedgerRateRecord,
  type LedgerShare,
  type LedgerSpanRecord,
} from "@/lib/ledger";

type Owned<T> = T & { ownerId: string };

/** The device's copy of every ledger table, each row tagged with its owner. */
export interface LedgerLocalRows {
  people: Array<Owned<LedgerPersonRecord>>;
  groups: Array<Owned<LedgerGroupRecord>>;
  members: Array<Owned<LedgerMemberRecord>>;
  rates: Array<Owned<LedgerRateRecord>>;
  spans: Array<Owned<LedgerSpanRecord>>;
  expenses: Array<Owned<LedgerExpenseRecord>>;
  obligations: Array<Owned<LedgerObligationRecord>>;
  payments: Array<Owned<LedgerPaymentRecord>>;
}

export const EMPTY_LEDGER_LOCAL_ROWS: LedgerLocalRows = {
  people: [],
  groups: [],
  members: [],
  rates: [],
  spans: [],
  expenses: [],
  obligations: [],
  payments: [],
};

export interface LedgerOverlayEntry {
  seq?: number;
  entity: string;
  entityId: string;
  op: LedgerOperation;
  payload: Record<string, unknown>;
}

type Row = { id: string };
const byId = <T extends Row>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));

/**
 * Replays queued ledger changes over a set of rows, in order, without creating outbox entries.
 * Used when a server snapshot replaces the device copy and, with a single entry, to apply a new
 * local change. It mirrors what the server will do once the change syncs.
 */
export function overlayLedger(
  ownerId: string,
  server: LedgerLocalRows,
  previous: LedgerLocalRows,
  entries: LedgerOverlayEntry[]
): LedgerLocalRows {
  const people = byId(server.people);
  const groups = byId(server.groups);
  const members = byId(server.members);
  const rates = byId(server.rates);
  const spans = byId(server.spans);
  const expenses = byId(server.expenses);
  const obligations = byId(server.obligations);
  const payments = byId(server.payments);
  const before = {
    people: byId(previous.people),
    groups: byId(previous.groups),
    members: byId(previous.members),
    rates: byId(previous.rates),
    spans: byId(previous.spans),
    expenses: byId(previous.expenses),
    obligations: byId(previous.obligations),
    payments: byId(previous.payments),
  };

  const merge = <T extends Row>(table: Map<string, Owned<T>>, fallback: Map<string, Owned<T>>, entry: LedgerOverlayEntry, extra: Record<string, unknown> = {}) => {
    const base = table.get(entry.entityId) ?? fallback.get(entry.entityId);
    if (!base && entry.op !== "CREATE") return null;
    const next = { ...(base ?? {}), ...entry.payload, ...extra, ownerId, id: entry.entityId, user_id: ownerId } as unknown as Owned<T>;
    table.set(entry.entityId, next);
    return next;
  };

  const removeMember = (memberId: string) => {
    members.delete(memberId);
    for (const [id, rate] of rates) if (rate.member_id === memberId) rates.delete(id);
    for (const [id, span] of spans) if (span.member_id === memberId) spans.delete(id);
  };

  for (const entry of [...entries].sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0))) {
    if (!isLedgerEntity(entry.entity)) continue;

    switch (entry.entity) {
      case "ledger_person":
        if (entry.op === "DELETE") people.delete(entry.entityId);
        else merge(people, before.people, entry);
        break;

      case "ledger_group":
        if (entry.op === "DELETE") {
          groups.delete(entry.entityId);
          for (const [id, member] of [...members]) if (member.group_id === entry.entityId) removeMember(id);
          // The group's dues go with it (the database function removes them in the same step).
          for (const [id, obligation] of [...obligations]) if (obligation.group_id === entry.entityId) obligations.delete(id);
        } else merge(groups, before.groups, entry);
        break;

      case "ledger_member":
        if (entry.op === "DELETE") removeMember(entry.entityId);
        else merge(members, before.members, entry);
        break;

      case "ledger_rate":
        if (entry.op !== "DELETE") merge(rates, before.rates, entry);
        break;

      case "ledger_span":
        if (entry.op !== "DELETE") merge(spans, before.spans, entry);
        break;

      case "ledger_expense": {
        if (entry.op === "DELETE") {
          expenses.delete(entry.entityId);
          for (const [id, obligation] of obligations) if (obligation.expense_id === entry.entityId) obligations.delete(id);
          break;
        }
        const { shares: rawShares, ...columns } = entry.payload;
        const expense = merge(expenses, before.expenses, { ...entry, payload: columns });
        if (!expense || !Array.isArray(rawShares)) break;
        const shares = rawShares as LedgerShare[];
        const keep = new Set(shares.map((share) => share.id));
        for (const [id, obligation] of obligations) {
          if (obligation.expense_id === entry.entityId && !keep.has(id)) obligations.delete(id);
        }
        for (const share of shares) {
          const existing = obligations.get(share.id) ?? before.obligations.get(share.id);
          obligations.set(share.id, {
            created_at: expense.created_at,
            note: null,
            ...(existing ?? {}),
            ownerId,
            id: share.id,
            user_id: ownerId,
            person_id: share.person_id,
            source: "shared",
            origin: "shared",
            group_id: null,
            member_id: null,
            period_start: null,
            expense_id: entry.entityId,
            title: expense.title,
            amount: share.amount,
            due_date: expense.expense_date,
            currency: expense.currency,
            updated_at: expense.updated_at,
          } as Owned<LedgerObligationRecord>);
        }
        break;
      }

      case "ledger_obligation":
        if (entry.op === "DELETE") obligations.delete(entry.entityId);
        else merge(obligations, before.obligations, entry);
        break;

      case "ledger_payment":
        if (entry.op !== "DELETE") merge(payments, before.payments, entry);
        break;
    }
  }

  return {
    people: [...people.values()],
    groups: [...groups.values()],
    members: [...members.values()],
    rates: [...rates.values()],
    spans: [...spans.values()],
    expenses: [...expenses.values()],
    obligations: [...obligations.values()],
    payments: [...payments.values()],
  };
}

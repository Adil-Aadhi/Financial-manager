import type {
  LocalAccount,
  LocalCategory,
  LocalDailyBudgetExpense,
  LocalDailyBudgetLimit,
  LocalMonthlyBudget,
  LocalTransaction,
  OutboxEntry,
} from "./db";
import { isAmbiguousLegacyTransactionDateUpdate } from "@/lib/transactions";

export interface LocalSnapshotRows {
  accounts: LocalAccount[];
  categories: LocalCategory[];
  transactions: LocalTransaction[];
  budget: LocalMonthlyBudget | null;
  /** Daily Budget Tracker rows. Optional so callers written before the feature still work. */
  dailyLimits?: LocalDailyBudgetLimit[];
  dailyExpenses?: LocalDailyBudgetExpense[];
}

function byId<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

/** Replays durable local intent over a complete server snapshot without creating new outbox rows. */
export function overlayOutbox(
  ownerId: string,
  server: LocalSnapshotRows,
  previous: LocalSnapshotRows,
  entries: OutboxEntry[]
): LocalSnapshotRows {
  const accounts = byId(server.accounts);
  const previousAccounts = byId(previous.accounts);
  const categories = byId(server.categories);
  const previousCategories = byId(previous.categories);
  const transactions = byId(server.transactions);
  const previousTransactions = byId(previous.transactions);
  let budget = server.budget;
  const dailyLimits = new Map((server.dailyLimits ?? []).map((row) => [row.effective_date, row]));
  const previousDailyLimits = new Map(
    (previous.dailyLimits ?? []).map((row) => [row.effective_date, row])
  );
  const dailyExpenses = byId(server.dailyExpenses ?? []);
  const previousDailyExpenses = byId(previous.dailyExpenses ?? []);

  for (const entry of [...entries].sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0))) {
    if (entry.ownerId !== ownerId) continue;

    if (entry.entity === "account") {
      if (entry.op === "DELETE") {
        accounts.delete(entry.entityId);
        continue;
      }
      const base = accounts.get(entry.entityId) ?? previousAccounts.get(entry.entityId);
      if (base || entry.op === "CREATE") {
        accounts.set(entry.entityId, {
          ...(base ?? ({} as LocalAccount)),
          ...entry.payload,
          ownerId,
          id: entry.entityId,
          user_id: ownerId,
        } as LocalAccount);
      }
      continue;
    }

    if (entry.entity === "category") {
      if (entry.op === "DELETE") {
        categories.delete(entry.entityId);
        continue;
      }
      const base = categories.get(entry.entityId) ?? previousCategories.get(entry.entityId);
      if (base || entry.op === "CREATE") {
        categories.set(entry.entityId, {
          ...(base ?? ({} as LocalCategory)),
          ...entry.payload,
          ownerId,
          id: entry.entityId,
          user_id: ownerId,
        } as LocalCategory);
      }
      continue;
    }

    if (entry.entity === "transaction") {
      if (entry.op === "DELETE") {
        transactions.delete(entry.entityId);
        continue;
      }
      const base =
        transactions.get(entry.entityId) ?? previousTransactions.get(entry.entityId);
      if (base || entry.op === "CREATE") {
        const payload = { ...entry.payload };
        if (
          entry.op === "UPDATE" &&
          (entry.transactionDateIntent === "unchanged" ||
            (entry.transactionDateIntent === undefined &&
              isAmbiguousLegacyTransactionDateUpdate(
                base?.transaction_date,
                payload.transaction_date
              )))
        ) {
          delete payload.transaction_date;
        }
        transactions.set(entry.entityId, {
          ...(base ?? ({} as LocalTransaction)),
          ...payload,
          ownerId,
          id: entry.entityId,
          user_id: ownerId,
        } as LocalTransaction);
      }
      continue;
    }

    if (entry.entity === "daily_expense") {
      if (entry.op === "DELETE") {
        dailyExpenses.delete(entry.entityId);
        continue;
      }
      const base = dailyExpenses.get(entry.entityId) ?? previousDailyExpenses.get(entry.entityId);
      if (base || entry.op === "CREATE") {
        dailyExpenses.set(entry.entityId, {
          ...(base ?? ({} as LocalDailyBudgetExpense)),
          ...entry.payload,
          ownerId,
          id: entry.entityId,
          user_id: ownerId,
        } as LocalDailyBudgetExpense);
      }
      continue;
    }

    if (entry.entity === "daily_limit") {
      // Keyed by effective date: CREATE and UPDATE both set that day's limit.
      if (entry.op === "DELETE") {
        dailyLimits.delete(entry.entityId);
        continue;
      }
      const base = dailyLimits.get(entry.entityId) ?? previousDailyLimits.get(entry.entityId);
      dailyLimits.set(entry.entityId, {
        ...(base ?? ({} as LocalDailyBudgetLimit)),
        ...entry.payload,
        ownerId,
        effective_date: entry.entityId,
        user_id: ownerId,
      } as LocalDailyBudgetLimit);
      continue;
    }

    if (entry.op === "DELETE") {
      budget = null;
    } else {
      budget = {
        ...(budget ?? previous.budget ?? ({} as LocalMonthlyBudget)),
        ...entry.payload,
        ownerId,
        id: budget?.id ?? previous.budget?.id ?? entry.entityId,
        user_id: ownerId,
      } as LocalMonthlyBudget;
    }
  }

  return {
    accounts: [...accounts.values()],
    categories: [...categories.values()],
    transactions: [...transactions.values()],
    budget,
    dailyLimits: [...dailyLimits.values()],
    dailyExpenses: [...dailyExpenses.values()],
  };
}

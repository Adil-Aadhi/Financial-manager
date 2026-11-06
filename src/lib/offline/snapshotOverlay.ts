import type {
  LocalAccount,
  LocalCategory,
  LocalMonthlyBudget,
  LocalTransaction,
  OutboxEntry,
} from "./db";

export interface LocalSnapshotRows {
  accounts: LocalAccount[];
  categories: LocalCategory[];
  transactions: LocalTransaction[];
  budget: LocalMonthlyBudget | null;
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
        transactions.set(entry.entityId, {
          ...(base ?? ({} as LocalTransaction)),
          ...entry.payload,
          ownerId,
          id: entry.entityId,
          user_id: ownerId,
        } as LocalTransaction);
      }
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
  };
}

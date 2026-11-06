import { beforeEach, describe, expect, it } from "vitest";
import { runSyncBatch } from "@/lib/server/syncApply";
import { offlineDb, type OutboxEntry } from "@/lib/offline/db";
import {
  createAccountLocally,
  createTransactionLocally,
  deleteTransactionLocally,
  updateAccountLocally,
  updateTransactionLocally,
} from "@/lib/offline/mutations";
import { canCoalesce, selectRunnableEntries } from "@/lib/offline/queuePolicy";
import { coordinateSignOut, shouldIsolateOwner } from "@/lib/offline/signOutCoordinator";
import { overlayOutbox, type LocalSnapshotRows } from "@/lib/offline/snapshotOverlay";
import type { SyncOperation } from "@/lib/sync/types";
import { updateSession } from "@/lib/supabase/proxy";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;

class FakeSupabase {
  tables = new Map<string, Map<string, Row>>();

  from(table: string) {
    return new FakeQuery(this, table);
  }

  rows(table: string) {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = new Map();
      this.tables.set(table, rows);
    }
    return rows;
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null; count?: number }> {
  private action: "select" | "insert" | "update" | "delete" = "select";
  private values: Row | null = null;
  private filters: Array<(row: Row) => boolean> = [];
  private countOnly = false;

  constructor(private db: FakeSupabase, private table: string) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    if (options?.count === "exact" && options.head) this.countOnly = true;
    return this;
  }

  insert(values: Row) {
    this.action = "insert";
    this.values = values;
    return this;
  }

  update(values: Row) {
    this.action = "update";
    this.values = values;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value);
    return this;
  }

  is(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value);
    return this;
  }

  or(expression: string) {
    const userId = expression.split("user_id.eq.")[1];
    this.filters.push((row) => row.is_default === true || row.user_id === userId);
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.execute(true));
  }

  single() {
    return Promise.resolve(this.execute(true));
  }

  then<TResult1 = { data: unknown; error: null; count?: number }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute(false)).then(onfulfilled, onrejected);
  }

  private execute(single: boolean) {
    const rows = this.db.rows(this.table);
    if (this.action === "insert") {
      const row = { ...this.values } as Row;
      if (this.table === "accounts" && row.deleted_at === undefined) row.deleted_at = null;
      rows.set(String(row.id ?? row.user_id), row);
      return { data: null, error: null };
    }

    const matches = [...rows.values()].filter((row) => this.filters.every((filter) => filter(row)));
    if (this.action === "update") {
      for (const row of matches) Object.assign(row, this.values);
    } else if (this.action === "delete") {
      for (const row of matches) rows.delete(String(row.id ?? row.user_id));
    }

    if (this.countOnly) return { data: null, error: null, count: matches.length };
    return { data: single ? matches[0] ?? null : matches, error: null };
  }
}

const ownerId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";

function wire(entry: OutboxEntry): SyncOperation {
  return {
    opId: entry.opId,
    seq: entry.seq!,
    ownerId: entry.ownerId,
    entity: entry.entity,
    entityId: entry.entityId,
    op: entry.op,
    payload: entry.payload,
    baseUpdatedAt: entry.baseUpdatedAt,
    editedAt: entry.updatedAt,
  };
}

async function seedSnapshot() {
  await offlineDb.syncMeta.put({
    ownerId,
    completedAt: new Date().toISOString(),
    budgetAvailable: true,
    server: { accounts: 1, transactions: 0, income: 0, expense: 0 },
    local: { accounts: 1, transactions: 0, income: 0, expense: 0 },
    totalsMatch: true,
  });
  await offlineDb.accounts.put({
    ownerId,
    id: accountId,
    user_id: ownerId,
    name: "Cash",
    account_type: "other",
    opening_balance: 10,
    currency: "INR",
    deleted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  await offlineDb.categories.put({
    ownerId,
    id: categoryId,
    user_id: ownerId,
    name: "Food",
    type: "expense",
    icon: "utensils",
    is_default: false,
  });
}

function seedServer() {
  const server = new FakeSupabase();
  server.rows("accounts").set(accountId, {
    id: accountId,
    user_id: ownerId,
    name: "Cash",
    opening_balance: 10,
    deleted_at: null,
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  server.rows("categories").set(categoryId, {
    id: categoryId,
    user_id: ownerId,
    name: "Food",
    type: "expense",
    icon: "utensils",
    is_default: false,
  });
  return server;
}

beforeEach(async () => {
  await offlineDb.delete();
  await offlineDb.open();
  await seedSnapshot();
});

describe("lost CREATE response regressions", () => {
  it("keeps a later transaction UPDATE separate and applies the latest amount", async () => {
    const server = seedServer();
    await createTransactionLocally(ownerId, {
      type: "expense",
      amount: 25,
      accountId,
      categoryId,
      transactionDate: "2026-11-06",
      transactionTime: "10:00",
    });
    const create = (await offlineDb.outbox.toArray())[0];
    await runSyncBatch(server as never, ownerId, [wire(create)]); // committed; response is lost
    await offlineDb.outbox.update(create.seq!, { attempts: 1, status: "pending" });

    await updateTransactionLocally(ownerId, {
      transactionId: create.entityId,
      type: "expense",
      amount: 30,
      accountId,
      categoryId,
      transactionDate: "2026-11-06",
      transactionTime: "10:00",
    });
    const queued = await offlineDb.outbox.orderBy("seq").toArray();
    expect(queued.map((entry) => entry.op)).toEqual(["CREATE", "UPDATE"]);
    await runSyncBatch(server as never, ownerId, queued.map(wire));
    expect(server.rows("transactions").get(create.entityId)?.amount).toBe(30);
  });

  it("keeps a later transaction DELETE separate and removes the server row", async () => {
    const server = seedServer();
    await createTransactionLocally(ownerId, {
      type: "expense",
      amount: 25,
      accountId,
      categoryId,
      transactionDate: "2026-11-06",
      transactionTime: "10:00",
    });
    const create = (await offlineDb.outbox.toArray())[0];
    await runSyncBatch(server as never, ownerId, [wire(create)]);
    await offlineDb.outbox.update(create.seq!, { attempts: 1, status: "pending" });
    await deleteTransactionLocally(ownerId, create.entityId);

    const queued = await offlineDb.outbox.orderBy("seq").toArray();
    expect(queued.map((entry) => entry.op)).toEqual(["CREATE", "DELETE"]);
    await runSyncBatch(server as never, ownerId, queued.map(wire));
    expect(server.rows("transactions").has(create.entityId)).toBe(false);
  });

  it("keeps a later account rename separate and applies the latest values", async () => {
    const server = new FakeSupabase();
    await createAccountLocally(ownerId, { name: "Wallet", startingAmount: 10 });
    const create = (await offlineDb.outbox.toArray())[0];
    await runSyncBatch(server as never, ownerId, [wire(create)]);
    await offlineDb.outbox.update(create.seq!, { attempts: 1, status: "pending" });
    await updateAccountLocally(ownerId, {
      accountId: create.entityId,
      name: "Cash box",
      openingAmount: 99,
    });

    const queued = await offlineDb.outbox.orderBy("seq").toArray();
    expect(queued.map((entry) => entry.op)).toEqual(["CREATE", "UPDATE"]);
    const response = await runSyncBatch(server as never, ownerId, queued.map(wire));
    expect(response.results).toMatchObject([{ status: "already-applied" }, { status: "applied" }]);
    expect(server.rows("accounts").get(create.entityId)).toMatchObject({
      name: "Cash box",
      opening_balance: 99,
    });
  });

  it("never coalesces an operation that may already be on the server", () => {
    expect(canCoalesce([{ status: "pending", attempts: 0 }])).toBe(true);
    expect(canCoalesce([{ status: "pending", attempts: 1 }])).toBe(false);
  });
});

describe("sign-out privacy ordering", () => {
  it("reproduces the protected POST redirect that broke the old Server Action flow", async () => {
    const response = await updateSession(
      new NextRequest("https://finance.example/settings", { method: "POST" })
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://finance.example/login");
  });

  it("clears owner/cache before a full login navigation and preserves local data by default", async () => {
    const calls: string[] = [];
    await coordinateSignOut({
      clearActiveOwner: () => calls.push("owner"),
      clearPrivateCache: async () => void calls.push("cache"),
      signOutBrowser: async () => void calls.push("browser"),
      navigateToLogin: () => void calls.push("navigate"),
    });
    expect(calls).toEqual(["owner", "cache", "browser", "navigate"]);
  });

  it("continues cleanup for an expired browser session and removes data only when explicit", async () => {
    const calls: string[] = [];
    await coordinateSignOut({
      clearActiveOwner: () => calls.push("owner"),
      clearPrivateCache: async () => void calls.push("cache"),
      signOutBrowser: async () => {
        calls.push("expired");
        throw new Error("no session");
      },
      removeLocalData: async () => void calls.push("remove"),
      navigateToLogin: () => void calls.push("navigate"),
    });
    expect(calls).toEqual(["owner", "cache", "expired", "remove", "navigate"]);
    expect(shouldIsolateOwner("user-a", "user-b")).toBe(true);
    expect(shouldIsolateOwner("user-a", "user-a")).toBe(false);
  });
});

describe("failed-operation isolation and refresh overlay", () => {
  const failedAccount: OutboxEntry = {
    seq: 1,
    opId: "failed-account",
    ownerId,
    entity: "account",
    entityId: accountId,
    op: "CREATE",
    payload: { name: "Cash" },
    baseUpdatedAt: null,
    createdAt: "2026-11-06T00:00:00.000Z",
    updatedAt: "2026-11-06T00:00:00.000Z",
    status: "failed",
    attempts: 1,
    error: "rejected",
  };

  it("runs independent operations but holds dependent operations", () => {
    const dependent = { ...failedAccount, seq: 2, opId: "dependent", entity: "transaction" as const, entityId: "44444444-4444-4444-8444-444444444444", op: "CREATE" as const, payload: { account_id: accountId, category_id: categoryId }, status: "pending" as const, attempts: 0 };
    const independent = { ...dependent, seq: 3, opId: "independent", entityId: "55555555-5555-4555-8555-555555555555", payload: { account_id: "66666666-6666-4666-8666-666666666666", category_id: categoryId } };
    expect(selectRunnableEntries([failedAccount, dependent, independent], Date.now(), 25).map((entry) => entry.opId)).toEqual(["independent"]);
  });

  it("reapplies failed and pending intent over a fresh snapshot", () => {
    const server: LocalSnapshotRows = {
      accounts: [],
      categories: [],
      transactions: [],
      budget: null,
    };
    const previous: LocalSnapshotRows = {
      accounts: [{ ownerId, id: accountId, user_id: ownerId, name: "Phone value", account_type: "other", opening_balance: 20, currency: "INR", deleted_at: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-11-06T00:00:00.000Z" }],
      categories: [],
      transactions: [],
      budget: null,
    };
    const update = { ...failedAccount, op: "UPDATE" as const, payload: { name: "Phone value", opening_balance: 20 } };
    const overlaid = overlayOutbox(ownerId, server, previous, [update]);
    expect(overlaid.accounts[0]).toMatchObject({ name: "Phone value", opening_balance: 20 });
  });
});

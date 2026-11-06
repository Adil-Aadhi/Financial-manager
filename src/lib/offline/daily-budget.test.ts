import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateDailyBudgetMonth,
  calculateDailyBudgetToday,
  type DailyExpenseRecord,
  type DailyLimitRecord,
} from "@/lib/dailyBudget";
import { runSyncBatch } from "@/lib/server/syncApply";
import { offlineDb, type OutboxEntry } from "@/lib/offline/db";
import {
  addDailyExpenseLocally,
  deleteDailyExpenseLocally,
  deleteDailyLimitLocally,
  setDailyLimitLocally,
  updateDailyExpenseLocally,
} from "@/lib/offline/mutations";
import { removeLocalOwnerData } from "@/lib/offline/privacy";
import type { SyncOperation } from "@/lib/sync/types";

/**
 * Daily Budget Tracker: offline writes, outbox replay, snapshot hydration and isolation.
 * The fake Supabase returns only the selected columns, enforces primary keys and the
 * (user_id, effective_date) key, and can pretend the migration hasn't been applied.
 */

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: { code: string; message: string } | null };

class FakeStore {
  tables = new Map<string, Map<string, Row>>();
  missing = new Set<string>();
  rows(table: string) {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = new Map();
      this.tables.set(table, rows);
    }
    return rows;
  }
  from(table: string) {
    return new FakeQuery(this, table);
  }
}

class FakeQuery implements PromiseLike<QueryResult> {
  private action: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private values: Row | null = null;
  private conflictKeys: string[] = [];
  private filters: Array<(row: Row) => boolean> = [];
  private columns: string[] | null = null;
  private window: [number, number] | null = null;

  constructor(private store: FakeStore, private table: string) {}

  select(columns?: string) {
    if (this.action === "select") {
      this.columns = columns && columns !== "*" ? columns.split(",").map((column) => column.trim()) : null;
    }
    return this;
  }
  insert(values: Row) {
    this.action = "insert";
    this.values = values;
    return this;
  }
  upsert(values: Row, options: { onConflict: string }) {
    this.action = "upsert";
    this.values = values;
    this.conflictKeys = options.onConflict.split(",");
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
    this.filters.push((row) => (row[field] ?? null) === value);
    return this;
  }
  gte(field: string, value: string) {
    this.filters.push((row) => String(row[field]) >= value);
    return this;
  }
  or(expression: string) {
    const userId = expression.split("user_id.eq.")[1];
    this.filters.push((row) => row.is_default === true || row.user_id === userId);
    return this;
  }
  order() {
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  maybeSingle() {
    return Promise.resolve(this.execute(true));
  }
  single() {
    return Promise.resolve(this.execute(true));
  }
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute(false)).then(onfulfilled, onrejected);
  }

  private project(row: Row) {
    if (!this.columns) return { ...row };
    const out: Row = {};
    for (const column of this.columns) if (column in row) out[column] = row[column];
    return out;
  }

  private execute(single: boolean): QueryResult {
    if (this.store.missing.has(this.table)) {
      return {
        data: null,
        error: { code: "PGRST205", message: `Could not find the table 'public.${this.table}' in the schema cache` },
      };
    }
    const rows = this.store.rows(this.table);
    if (this.action === "insert") {
      const row = { ...this.values } as Row;
      const key = String(row.id ?? row.user_id);
      if (rows.has(key)) return { data: null, error: { code: "23505", message: "duplicate key" } };
      rows.set(key, row);
      return { data: null, error: null };
    }
    if (this.action === "upsert") {
      const values = { ...this.values } as Row;
      const existing = [...rows.values()].find((row) => this.conflictKeys.every((key) => row[key] === values[key]));
      if (existing) Object.assign(existing, values);
      else rows.set(String(values.id ?? crypto.randomUUID()), { id: crypto.randomUUID(), created_at: values.updated_at, ...values });
      const saved = existing ?? values;
      return { data: { updated_at: saved.updated_at }, error: null };
    }
    let matches = [...rows.entries()].filter(([, row]) => this.filters.every((filter) => filter(row)));
    if (this.action === "update") for (const [, row] of matches) Object.assign(row, this.values);
    if (this.action === "delete") for (const [key] of matches) rows.delete(key);
    if (this.window) matches = matches.slice(this.window[0], this.window[1] + 1);
    const data = matches.map(([, row]) => (this.action === "select" ? this.project(row) : { id: row.id }));
    return { data: single ? data[0] ?? null : data, error: null };
  }
}

const holder = vi.hoisted(() => ({ store: null as unknown, userId: "" }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const store = holder.store as FakeStore;
    return {
      auth: { getUser: async () => ({ data: { user: { id: holder.userId, user_metadata: {} } }, error: null }) },
      from: (table: string) => store.from(table),
    };
  },
}));

const { ensureOfflineBootstrap } = await import("@/lib/offline/bootstrap");

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherUser = "99999999-9999-4999-8999-999999999999";
const accountId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const transactionId = "44444444-4444-4444-8444-444444444444";
const BASE = "2026-11-01T00:00:00.000Z";
// 11:30 IST on Dec 10 2026: today is Dec 10, November is a closed month.
const NOW = new Date("2026-12-10T06:00:00.000Z");
const TODAY = "2026-12-10";

function wire(entry: OutboxEntry): SyncOperation {
  return {
    opId: entry.opId,
    seq: entry.seq!,
    ownerId: entry.ownerId,
    entity: entry.entity,
    entityId: entry.entityId,
    op: entry.op,
    payload: entry.payload,
    transactionDateIntent: entry.transactionDateIntent,
    baseUpdatedAt: entry.baseUpdatedAt,
    editedAt: entry.updatedAt,
  };
}

/** Server: an account with one transaction, a 300/day limit since Nov 1 and one expense. */
function seedServer({ migrated = true } = {}) {
  const store = new FakeStore();
  if (!migrated) {
    store.missing.add("daily_budget_limits");
    store.missing.add("daily_budget_expenses");
  }
  store.rows("profiles").set(ownerId, { id: ownerId, full_name: "Test", avatar_url: null, default_currency: "INR" });
  store.rows("accounts").set(accountId, {
    id: accountId, user_id: ownerId, name: "Cash", account_type: "other", opening_balance: 10, currency: "INR",
    account_group: "general", include_in_summary: true, deleted_at: null, created_at: BASE, updated_at: BASE,
  });
  store.rows("categories").set(categoryId, { id: categoryId, user_id: ownerId, name: "Food", type: "expense", icon: "utensils", is_default: false });
  store.rows("transactions").set(transactionId, {
    id: transactionId, user_id: ownerId, account_id: accountId, category_id: categoryId, type: "expense", amount: 40,
    description: null, transaction_date: "2026-11-30", transaction_time: null, created_at: BASE, updated_at: BASE,
  });
  if (migrated) {
    store.rows("daily_budget_limits").set("limit-1", {
      id: "limit-1", user_id: ownerId, effective_date: "2026-11-01", amount: 300, created_at: BASE, updated_at: BASE,
    });
    store.rows("daily_budget_expenses").set("55555555-5555-4555-8555-555555555555", {
      id: "55555555-5555-4555-8555-555555555555", user_id: ownerId, expense_date: "2026-11-02", amount: 100,
      description: "Lunch", created_at: BASE, updated_at: BASE,
    });
    // Another user's data, which must never reach this device or be changed by it.
    store.rows("daily_budget_limits").set("limit-other", {
      id: "limit-other", user_id: otherUser, effective_date: "2026-11-01", amount: 999, created_at: BASE, updated_at: BASE,
    });
    store.rows("daily_budget_expenses").set("66666666-6666-4666-8666-666666666666", {
      id: "66666666-6666-4666-8666-666666666666", user_id: otherUser, expense_date: "2026-11-02", amount: 5000,
      description: "Not yours", created_at: BASE, updated_at: BASE,
    });
  }
  holder.store = store;
  holder.userId = ownerId;
  return store;
}

async function syncAll(store: FakeStore) {
  const queued = await offlineDb.outbox.where("ownerId").equals(ownerId).sortBy("seq");
  if (queued.length === 0) return { status: "ok", results: [] };
  const response = await runSyncBatch(store as never, ownerId, queued.map(wire), new Date());
  for (const [index, result] of response.results.entries()) {
    if (result.status === "applied" || result.status === "already-applied") {
      await offlineDb.outbox.delete(queued[index].seq!);
    }
  }
  return response;
}

async function localData() {
  const [limits, expenses] = await Promise.all([
    offlineDb.dailyBudgetLimits.where("ownerId").equals(ownerId).toArray(),
    offlineDb.dailyBudgetExpenses.where("ownerId").equals(ownerId).toArray(),
  ]);
  return { limits: limits as DailyLimitRecord[], expenses: expenses as DailyExpenseRecord[] };
}

function serverData(store: FakeStore, userId = ownerId) {
  return {
    limits: [...store.rows("daily_budget_limits").values()].filter((row) => row.user_id === userId) as unknown as DailyLimitRecord[],
    expenses: [...store.rows("daily_budget_expenses").values()].filter((row) => row.user_id === userId) as unknown as DailyExpenseRecord[],
  };
}

const closing = (data: { limits: DailyLimitRecord[]; expenses: DailyExpenseRecord[] }, month: string) =>
  calculateDailyBudgetMonth(data.limits, data.expenses, month, TODAY).totals.closing;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await offlineDb.delete();
  await offlineDb.open();
});

describe("daily budget: hydration", () => {
  it("downloads only this user's limits and expenses and marks the feature available", async () => {
    seedServer();
    const meta = await ensureOfflineBootstrap(ownerId, true);
    expect(meta.dailyBudgetAvailable).toBe(true);
    const local = await localData();
    expect(local.limits).toHaveLength(1);
    expect(local.limits[0]).toMatchObject({ effective_date: "2026-11-01", amount: 300 });
    expect(local.expenses.map((row) => row.description)).toEqual(["Lunch"]);
    // November: 30 x 300 - 100
    expect(closing(local, "2026-11")).toBe(8900);
  });

  it("keeps every existing feature working before the migration is applied", async () => {
    seedServer({ migrated: false });
    const meta = await ensureOfflineBootstrap(ownerId, true);
    expect(meta).toMatchObject({ dailyBudgetAvailable: false, totalsMatch: true });
    expect(await offlineDb.transactions.count()).toBe(1);
    await expect(
      addDailyExpenseLocally(ownerId, { amount: 10, expenseDate: TODAY, description: "Tea" })
    ).rejects.toThrow(/isn't ready/);
    expect(await offlineDb.outbox.count()).toBe(0);
  });
});

describe("daily budget: offline changes", () => {
  it("records an expense offline, persists it and computes today's balance locally", async () => {
    seedServer();
    await ensureOfflineBootstrap(ownerId, true);
    await addDailyExpenseLocally(ownerId, { amount: 120, expenseDate: TODAY, description: "Groceries " });
    const [entry] = await offlineDb.outbox.toArray();
    expect(entry).toMatchObject({ entity: "daily_expense", op: "CREATE" });
    expect(entry.payload).toMatchObject({ expense_date: TODAY, amount: 120, description: "Groceries" });
    const local = await localData();
    // December: 10 days x 300 - 120
    expect(calculateDailyBudgetToday(local.limits, local.expenses, TODAY)).toMatchObject({
      carried: 2700, allowance: 300, expenses: 120, available: 2880,
    });
  });

  it("adds a forgotten expense to a closed previous month offline, then syncs it", async () => {
    const store = seedServer();
    await ensureOfflineBootstrap(ownerId, true);
    const before = await localData();
    const decemberBefore = closing(before, "2026-12");

    await addDailyExpenseLocally(ownerId, { amount: 500, expenseDate: "2026-11-30", description: "Forgot this" });
    const after = await localData();
    expect(closing(after, "2026-11")).toBe(closing(before, "2026-11") - 500);
    expect(closing(after, "2026-12")).toBe(decemberBefore);

    const response = await syncAll(store);
    expect(response.results.map((result) => result.status)).toEqual(["applied"]);
    expect(closing(serverData(store), "2026-11")).toBe(8400);
    expect(closing(serverData(store), "2026-12")).toBe(decemberBefore);
  });

  it("edits and deletes a late entry offline and the server follows", async () => {
    const store = seedServer();
    await ensureOfflineBootstrap(ownerId, true);
    const id = "77777777-7777-4777-8777-777777777777";
    await addDailyExpenseLocally(ownerId, { id, amount: 500, expenseDate: "2026-11-30", description: "Forgot" });
    await syncAll(store);

    await updateDailyExpenseLocally(ownerId, { expenseId: id, amount: 50, expenseDate: "2026-11-29", description: "Smaller" });
    expect(await syncAll(store)).toMatchObject({ results: [{ status: "applied" }] });
    expect(store.rows("daily_budget_expenses").get(id)).toMatchObject({ amount: 50, expense_date: "2026-11-29", description: "Smaller" });
    expect(closing(serverData(store), "2026-11")).toBe(8850);

    await deleteDailyExpenseLocally(ownerId, id);
    expect(await syncAll(store)).toMatchObject({ results: [{ status: "applied" }] });
    expect(store.rows("daily_budget_expenses").has(id)).toBe(false);
    expect(closing(serverData(store), "2026-11")).toBe(8900);
  });

  it("changes the daily limit offline from an effective date without touching earlier days", async () => {
    const store = seedServer();
    await ensureOfflineBootstrap(ownerId, true);
    const novemberBefore = closing(await localData(), "2026-11");
    await setDailyLimitLocally(ownerId, { amount: 500, effectiveDate: "2026-12-05" });

    const local = await localData();
    const december = calculateDailyBudgetMonth(local.limits, local.expenses, "2026-12", TODAY);
    expect(december.days.find((day) => day.date === "2026-12-04")?.allowance).toBe(300);
    expect(december.days.find((day) => day.date === "2026-12-05")?.allowance).toBe(500);
    expect(closing(local, "2026-11")).toBe(novemberBefore);

    await syncAll(store);
    const limits = serverData(store).limits.map((row) => [row.effective_date, Number(row.amount)]);
    expect(limits.sort()).toEqual([["2026-11-01", 300], ["2026-12-05", 500]]);
  });

  it("removes a limit change so the previous limit applies again", async () => {
    const store = seedServer();
    await ensureOfflineBootstrap(ownerId, true);
    await setDailyLimitLocally(ownerId, { amount: 500, effectiveDate: "2026-12-05" });
    await syncAll(store);
    await deleteDailyLimitLocally(ownerId, "2026-12-05");
    await syncAll(store);
    expect(serverData(store).limits).toHaveLength(1);
    expect(calculateDailyBudgetMonth(serverData(store).limits, [], "2026-12", TODAY).totals.allowance).toBe(3000);
  });

  it("survives a snapshot refresh while changes are still queued (stale server copy)", async () => {
    seedServer();
    await ensureOfflineBootstrap(ownerId, true);
    await addDailyExpenseLocally(ownerId, { amount: 75, expenseDate: "2026-11-15", description: "Pending" });
    await setDailyLimitLocally(ownerId, { amount: 400, effectiveDate: TODAY });
    // The server doesn't have these yet; a refresh must replay them over its snapshot.
    await ensureOfflineBootstrap(ownerId, true);
    const local = await localData();
    expect(local.expenses.map((row) => row.description).sort()).toEqual(["Lunch", "Pending"]);
    expect(local.limits.find((row) => row.effective_date === TODAY)?.amount).toBe(400);
  });

  it("matches the server exactly after reconnecting and refreshing", async () => {
    const store = seedServer();
    await ensureOfflineBootstrap(ownerId, true);
    await addDailyExpenseLocally(ownerId, { amount: 10, expenseDate: "2026-12-01", description: "Bus" });
    await addDailyExpenseLocally(ownerId, { amount: 20, expenseDate: "2026-12-01", description: "Tea" });
    await setDailyLimitLocally(ownerId, { amount: 250, effectiveDate: "2026-12-08" });
    await syncAll(store);
    expect(await offlineDb.outbox.count()).toBe(0);
    const meta = await ensureOfflineBootstrap(ownerId, true);
    expect(meta.totalsMatch).toBe(true);
    const local = await localData();
    const server = serverData(store);
    for (const month of ["2026-11", "2026-12"]) {
      expect(calculateDailyBudgetMonth(local.limits, local.expenses, month, TODAY)).toEqual(
        calculateDailyBudgetMonth(server.limits, server.expenses, month, TODAY)
      );
    }
    // Existing financial data is untouched by the daily budget.
    expect(store.rows("transactions").size).toBe(1);
    expect(store.rows("accounts").get(accountId)).toMatchObject({ opening_balance: 10, updated_at: BASE });
    expect(await offlineDb.transactions.count()).toBe(1);
  });
});

describe("daily budget: duplicate prevention", () => {
  it("treats a resent create as already applied (lost response)", async () => {
    const store = seedServer();
    await ensureOfflineBootstrap(ownerId, true);
    await addDailyExpenseLocally(ownerId, { amount: 30, expenseDate: TODAY, description: "Snack" });
    const queued = (await offlineDb.outbox.toArray()).map(wire);
    expect((await runSyncBatch(store as never, ownerId, queued)).results[0].status).toBe("applied");
    expect((await runSyncBatch(store as never, ownerId, queued)).results[0].status).toBe("already-applied");
    expect(serverData(store).expenses.filter((row) => row.description === "Snack")).toHaveLength(1);
  });

  it("ignores a second local save of the same entry id", async () => {
    seedServer();
    await ensureOfflineBootstrap(ownerId, true);
    const id = "88888888-8888-4888-8888-888888888888";
    await addDailyExpenseLocally(ownerId, { id, amount: 30, expenseDate: TODAY, description: "Snack" });
    await addDailyExpenseLocally(ownerId, { id, amount: 30, expenseDate: TODAY, description: "Snack" });
    expect(await offlineDb.dailyBudgetExpenses.where("ownerId").equals(ownerId).count()).toBe(2); // Lunch + Snack
    expect(await offlineDb.outbox.count()).toBe(1);
  });

  it("keeps one limit per date, however often it is changed", async () => {
    const store = seedServer();
    await ensureOfflineBootstrap(ownerId, true);
    await setDailyLimitLocally(ownerId, { amount: 350, effectiveDate: TODAY });
    await setDailyLimitLocally(ownerId, { amount: 450, effectiveDate: TODAY });
    const queued = await offlineDb.outbox.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0].payload.amount).toBe(450);
    await syncAll(store);
    await syncAll(store);
    const forToday = serverData(store).limits.filter((row) => row.effective_date === TODAY);
    expect(forToday).toHaveLength(1);
    expect(Number(forToday[0].amount)).toBe(450);
    // Allowance for today is counted once.
    const december = calculateDailyBudgetMonth(serverData(store).limits, [], "2026-12", TODAY);
    expect(december.days.filter((day) => day.date === TODAY)).toHaveLength(1);
  });

  it("sends nothing for an entry added and deleted before syncing", async () => {
    seedServer();
    await ensureOfflineBootstrap(ownerId, true);
    const id = "12121212-1212-4121-8121-121212121212";
    await addDailyExpenseLocally(ownerId, { id, amount: 5, expenseDate: TODAY, description: "Oops" });
    await deleteDailyExpenseLocally(ownerId, id);
    expect(await offlineDb.outbox.count()).toBe(0);
  });
});

describe("daily budget: validation and isolation", () => {
  it("rejects future dates and empty descriptions locally and on the server", async () => {
    const store = seedServer();
    await ensureOfflineBootstrap(ownerId, true);
    await expect(
      addDailyExpenseLocally(ownerId, { amount: 5, expenseDate: "2026-12-11", description: "Later" })
    ).rejects.toThrow(/future/);
    const forged: SyncOperation = {
      opId: "op-1", seq: 1, ownerId, entity: "daily_expense", entityId: "13131313-1313-4131-8131-131313131313",
      op: "CREATE", payload: { expense_date: "2026-12-11", amount: 5, description: "" }, baseUpdatedAt: null, editedAt: NOW.toISOString(),
    };
    expect((await runSyncBatch(store as never, ownerId, [forged])).results[0].status).toBe("rejected");
  });

  it("never reads or changes another user's daily budget", async () => {
    const store = seedServer();
    await ensureOfflineBootstrap(ownerId, true);
    // A batch claiming another owner is refused outright.
    const foreign: SyncOperation = {
      opId: "op-2", seq: 1, ownerId: otherUser, entity: "daily_limit", entityId: TODAY,
      op: "UPDATE", payload: { effective_date: TODAY, amount: 1 }, baseUpdatedAt: null, editedAt: NOW.toISOString(),
    };
    expect((await runSyncBatch(store as never, ownerId, [foreign])).status).toBe("wrong-user");
    // Editing or deleting the other user's expense id from this account changes nothing.
    const otherId = "66666666-6666-4666-8666-666666666666";
    const edit: SyncOperation = {
      opId: "op-3", seq: 1, ownerId, entity: "daily_expense", entityId: otherId, op: "UPDATE",
      payload: { expense_date: TODAY, amount: 1, description: "Mine now" }, baseUpdatedAt: null, editedAt: NOW.toISOString(),
    };
    const remove: SyncOperation = { ...edit, opId: "op-4", op: "DELETE", payload: { id: otherId } };
    const reuse: SyncOperation = { ...edit, opId: "op-5", op: "CREATE" };
    expect((await runSyncBatch(store as never, ownerId, [edit])).results[0].status).toBe("rejected");
    expect((await runSyncBatch(store as never, ownerId, [remove])).results[0].status).toBe("already-applied");
    expect((await runSyncBatch(store as never, ownerId, [reuse])).results[0].status).toBe("rejected");
    expect(store.rows("daily_budget_expenses").get(otherId)).toMatchObject({ user_id: otherUser, amount: 5000, description: "Not yours" });
    expect(serverData(store, otherUser).limits[0]).toMatchObject({ amount: 999 });
    // This device holds none of the other user's rows, and removing one owner's copy leaves
    // nothing behind.
    expect((await localData()).expenses.some((row) => row.description === "Not yours")).toBe(false);
    await removeLocalOwnerData(ownerId);
    expect(await offlineDb.dailyBudgetExpenses.count()).toBe(0);
    expect(await offlineDb.dailyBudgetLimits.count()).toBe(0);
  });
});

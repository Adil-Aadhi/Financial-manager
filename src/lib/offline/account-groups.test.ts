import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAccountGroup } from "@/lib/accounts";
import { normalizeIncludeInSummary } from "@/lib/accountSummary";
import { runSyncBatch } from "@/lib/server/syncApply";
import { offlineDb, type OutboxEntry } from "@/lib/offline/db";
import {
  createAccountLocally,
  createTransactionLocally,
  deleteTransactionLocally,
  loadLocalTransactionOptions,
  restoreAccountLocally,
  setAccountArchivedLocally,
  trashAccountLocally,
  updateAccountLocally,
  updateTransactionLocally,
} from "@/lib/offline/mutations";
import { ARCHIVED_ACCOUNT_ERROR, archivedAccountBlocks, isAccountArchived } from "@/lib/accounts";
import { overlayOutbox } from "@/lib/offline/snapshotOverlay";
import type { SyncOperation } from "@/lib/sync/types";

/**
 * Account-group regressions. The fake Supabase below returns only the columns each query
 * selects, so a column missing from a select list (the cause of the old "moved to Primary,
 * then disappeared" bug) is lost here exactly as it is in production.
 */

type Row = Record<string, unknown>;

class FakeStore {
  tables = new Map<string, Map<string, Row>>();
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

class FakeQuery implements PromiseLike<{ data: unknown; error: null; count?: number }> {
  private action: "select" | "insert" | "update" | "delete" = "select";
  private values: Row | null = null;
  private filters: Array<(row: Row) => boolean> = [];
  private columns: string[] | null = null;
  private window: [number, number] | null = null;

  constructor(private store: FakeStore, private table: string) {}

  select(columns?: string) {
    this.columns = columns && columns !== "*" ? columns.split(",").map((column) => column.trim()) : null;
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
    this.filters.push((row) => (row[field] ?? null) === value);
    return this;
  }
  gt(field: string, value: string) {
    this.filters.push((row) => typeof row[field] === "string" && (row[field] as string) > value);
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
  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
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

  private execute(single: boolean) {
    const rows = this.store.rows(this.table);
    if (this.action === "insert") {
      const row = { ...this.values } as Row;
      if (this.table === "accounts") {
        // Mirrors the real column defaults.
        if (row.deleted_at === undefined) row.deleted_at = null;
        if (row.account_group === undefined) row.account_group = "general";
        if (row.include_in_summary === undefined) row.include_in_summary = true;
        if (row.currency === undefined) row.currency = "INR";
      }
      rows.set(String(row.id ?? row.user_id), row);
      return { data: null, error: null };
    }
    let matches = [...rows.values()].filter((row) => this.filters.every((filter) => filter(row)));
    if (this.action === "update") for (const row of matches) Object.assign(row, this.values);
    if (this.action === "delete") for (const row of matches) rows.delete(String(row.id ?? row.user_id));
    if (this.window) matches = matches.slice(this.window[0], this.window[1] + 1);
    const data = matches.map((row) => this.project(row));
    return { data: single ? data[0] ?? null : data, error: null };
  }
}

const holder = vi.hoisted(() => ({ store: null as unknown }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const store = holder.store as FakeStore;
    return {
      auth: { getUser: async () => ({ data: { user: { id: ownerId, user_metadata: {} } }, error: null }) },
      from: (table: string) => store.from(table),
    };
  },
}));

// Imported after the mock so the snapshot download uses the fake client.
const { ensureOfflineBootstrap } = await import("@/lib/offline/bootstrap");

const ownerId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const transactionId = "44444444-4444-4444-8444-444444444444";
const BASE = "2026-01-01T00:00:00.000Z";

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

/** Server state: one General account with one income transaction (balance 10 + 5). */
function seedServer(
  group: "primary" | "general" = "general",
  includeInSummary = true
) {
  const store = new FakeStore();
  store.rows("profiles").set(ownerId, { id: ownerId, full_name: "Test", avatar_url: null, default_currency: "INR" });
  store.rows("accounts").set(accountId, {
    id: accountId,
    user_id: ownerId,
    name: "Cash",
    account_type: "other",
    opening_balance: 10,
    currency: "INR",
    account_group: group,
    include_in_summary: includeInSummary,
    deleted_at: null,
    created_at: BASE,
    updated_at: BASE,
  });
  store.rows("categories").set(categoryId, {
    id: categoryId,
    user_id: ownerId,
    name: "Salary",
    type: "income",
    icon: "wallet",
    is_default: false,
  });
  store.rows("transactions").set(transactionId, {
    id: transactionId,
    user_id: ownerId,
    account_id: accountId,
    category_id: categoryId,
    type: "income",
    amount: 5,
    description: null,
    transaction_date: "2026-11-01",
    transaction_time: null,
    created_at: BASE,
    updated_at: BASE,
  });
  holder.store = store;
  return store;
}

/** The device's copy before this feature: the account row has no account_group at all. */
async function seedDevice() {
  await offlineDb.syncMeta.put({
    ownerId,
    completedAt: new Date().toISOString(),
    budgetAvailable: true,
    server: { accounts: 1, transactions: 1, income: 5, expense: 0 },
    local: { accounts: 1, transactions: 1, income: 5, expense: 0 },
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
    created_at: BASE,
    updated_at: BASE,
  });
  await offlineDb.categories.put({ ownerId, id: categoryId, user_id: ownerId, name: "Salary", type: "income", icon: "wallet", is_default: false });
  await offlineDb.transactions.put({
    ownerId,
    id: transactionId,
    user_id: ownerId,
    account_id: accountId,
    category_id: categoryId,
    type: "income",
    amount: 5,
    description: null,
    transaction_date: "2026-11-01",
    transaction_time: null,
    created_at: BASE,
    updated_at: BASE,
  });
}

/** What the sync engine's settle() does for an applied result: remove the confirmed entries. */
async function syncAll(store: FakeStore) {
  const queued = await offlineDb.outbox.orderBy("seq").toArray();
  const response = await runSyncBatch(store as never, ownerId, queued.map(wire));
  for (const [index, result] of response.results.entries()) {
    if (result.status === "applied" || result.status === "already-applied") {
      await offlineDb.outbox.delete(queued[index].seq!);
    }
  }
  return response;
}

async function localGroup(id = accountId) {
  return normalizeAccountGroup((await offlineDb.accounts.get([ownerId, id]))?.account_group);
}

async function localSummaryInclusion(id = accountId) {
  return normalizeIncludeInSummary(
    (await offlineDb.accounts.get([ownerId, id]))?.include_in_summary
  );
}

beforeEach(async () => {
  await offlineDb.delete();
  await offlineDb.open();
  await seedDevice();
});

describe("account groups: defaults and legacy rows", () => {
  it("reads cached rows without a group as General", async () => {
    seedServer();
    expect((await offlineDb.accounts.get([ownerId, accountId]))?.account_group).toBeUndefined();
    expect(await localGroup()).toBe("general");
    expect(normalizeAccountGroup(null)).toBe("general");
    expect(normalizeAccountGroup("bogus")).toBe("general");
    expect(normalizeAccountGroup("primary")).toBe("primary");
  });

  it("hydrates the server's group, including an account already moved to Primary", async () => {
    seedServer("primary");
    await ensureOfflineBootstrap(ownerId, true);
    expect(await localGroup()).toBe("primary");
  });

  it("creates offline accounts in Primary by default and syncs that group", async () => {
    const store = seedServer();
    await createAccountLocally(ownerId, { name: "Wallet", startingAmount: 3 });
    const [entry] = await offlineDb.outbox.toArray();
    expect(entry.payload.account_group).toBe("primary");
    expect(await localGroup(entry.entityId)).toBe("primary");

    await syncAll(store);
    expect(store.rows("accounts").get(entry.entityId)?.account_group).toBe("primary");
    await ensureOfflineBootstrap(ownerId, true);
    expect(await localGroup(entry.entityId)).toBe("primary");
  });

  it("creates offline accounts in General when chosen", async () => {
    const store = seedServer();
    await createAccountLocally(ownerId, { name: "Savings", accountGroup: "general" });
    const [entry] = await offlineDb.outbox.toArray();
    await syncAll(store);
    expect(store.rows("accounts").get(entry.entityId)?.account_group).toBe("general");
  });

  it("lets a CREATE queued before groups existed fall back to the database default", async () => {
    const store = seedServer();
    await createAccountLocally(ownerId, { name: "Old queue" });
    const [entry] = await offlineDb.outbox.toArray();
    const { account_group: _dropped, ...legacyPayload } = entry.payload;
    void _dropped;
    await offlineDb.outbox.update(entry.seq!, { payload: legacyPayload });
    await syncAll(store);
    expect(store.rows("accounts").get(entry.entityId)?.account_group).toBe("general");
  });
});

describe("account groups: switching (disappearing-account regression)", () => {
  it("applies a group-only change instead of skipping it as already applied", async () => {
    const store = seedServer();
    await updateAccountLocally(ownerId, { accountId, name: "Cash", openingAmount: 10, accountGroup: "primary" });
    expect(await localGroup()).toBe("primary");

    const queued = await offlineDb.outbox.toArray();
    const response = await runSyncBatch(store as never, ownerId, queued.map(wire));
    expect(response.results).toMatchObject([{ status: "applied" }]);
    expect(store.rows("accounts").get(accountId)).toMatchObject({
      id: accountId,
      account_group: "primary",
      opening_balance: 10,
      name: "Cash",
    });

    // A resend after a lost response is recognised, not applied twice.
    const again = await runSyncBatch(store as never, ownerId, queued.map(wire));
    expect(again.results).toMatchObject([{ status: "already-applied" }]);
  });

  it("keeps Primary through sync and the post-sync snapshot refresh, with balance and transactions intact", async () => {
    const store = seedServer();
    await updateAccountLocally(ownerId, { accountId, name: "Cash", openingAmount: 10, accountGroup: "primary" });
    await syncAll(store);
    expect(await offlineDb.outbox.count()).toBe(0);

    const meta = await ensureOfflineBootstrap(ownerId, true);
    expect(meta.totalsMatch).toBe(true);
    const account = await offlineDb.accounts.get([ownerId, accountId]);
    expect(account).toMatchObject({ id: accountId, account_group: "primary", opening_balance: 10 });
    const transactions = await offlineDb.transactions.where("[ownerId+account_id]").equals([ownerId, accountId]).toArray();
    expect(transactions.map((row) => row.id)).toEqual([transactionId]);
    expect(meta.local).toMatchObject({ accounts: 1, transactions: 1, income: 5 });
  });

  it("never lets a stale snapshot overwrite a pending group change", async () => {
    seedServer("general");
    await updateAccountLocally(ownerId, { accountId, name: "Cash", openingAmount: 10, accountGroup: "primary" });
    await ensureOfflineBootstrap(ownerId, true); // server still says general
    expect(await localGroup()).toBe("primary");
    expect((await offlineDb.outbox.toArray())[0].payload.account_group).toBe("primary");
  });

  it("replays queued group changes in order so the latest choice wins", async () => {
    const store = seedServer();
    await updateAccountLocally(ownerId, { accountId, name: "Cash", openingAmount: 10, accountGroup: "primary" });
    const [first] = await offlineDb.outbox.toArray();
    // The first change was sent and its response lost; it can no longer be merged.
    await runSyncBatch(store as never, ownerId, [wire(first)]);
    await offlineDb.outbox.update(first.seq!, { attempts: 1 });
    await updateAccountLocally(ownerId, { accountId, name: "Cash", openingAmount: 10, accountGroup: "general" });

    const queued = await offlineDb.outbox.orderBy("seq").toArray();
    expect(queued.map((entry) => entry.payload.account_group)).toEqual(["primary", "general"]);

    // A refresh while both are still queued shows the latest choice.
    const overlaid = overlayOutbox(
      ownerId,
      { accounts: [{ ...(store.rows("accounts").get(accountId) as Row), ownerId } as never], categories: [], transactions: [], budget: null },
      { accounts: [], categories: [], transactions: [], budget: null },
      queued
    );
    expect(overlaid.accounts[0].account_group).toBe("general");

    await syncAll(store);
    expect(store.rows("accounts").get(accountId)?.account_group).toBe("general");
    await ensureOfflineBootstrap(ownerId, true);
    expect(await localGroup()).toBe("general");
  });

  it("merges unsent edits so the outbox carries only the latest group", async () => {
    const store = seedServer();
    await updateAccountLocally(ownerId, { accountId, name: "Cash", openingAmount: 10, accountGroup: "primary" });
    await updateAccountLocally(ownerId, { accountId, name: "Cash", openingAmount: 10, accountGroup: "general" });
    await updateAccountLocally(ownerId, { accountId, name: "Cash", openingAmount: 10, accountGroup: "primary" });
    const queued = await offlineDb.outbox.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0].payload.account_group).toBe("primary");
    await syncAll(store);
    expect(store.rows("accounts").get(accountId)?.account_group).toBe("primary");
  });

  it("keeps the stored group when an edit doesn't include one", async () => {
    const store = seedServer("primary");
    await ensureOfflineBootstrap(ownerId, true);
    await updateAccountLocally(ownerId, { accountId, name: "Cash box", openingAmount: 10 });
    await syncAll(store);
    expect(store.rows("accounts").get(accountId)).toMatchObject({ name: "Cash box", account_group: "primary" });
  });

  it("rejects an invalid group on the device and on the server", async () => {
    const store = seedServer();
    await expect(
      updateAccountLocally(ownerId, { accountId, name: "Cash", openingAmount: 10, accountGroup: "vip" as never })
    ).rejects.toThrow(/Primary or General/);

    const response = await runSyncBatch(store as never, ownerId, [
      {
        opId: "bad-group",
        seq: 1,
        ownerId,
        entity: "account",
        entityId: accountId,
        op: "UPDATE",
        payload: { account_group: "vip" },
        baseUpdatedAt: BASE,
        editedAt: new Date().toISOString(),
      },
    ]);
    expect(response.results).toMatchObject([{ status: "rejected" }]);
    expect(store.rows("accounts").get(accountId)?.account_group).toBe("general");
  });
});

describe("account summary inclusion: offline and sync", () => {
  it("defaults new offline accounts to included and persists the default", async () => {
    const store = seedServer();
    await createAccountLocally(ownerId, { name: "Wallet" });
    const [entry] = await offlineDb.outbox.toArray();

    expect(entry.payload.include_in_summary).toBe(true);
    expect(await localSummaryInclusion(entry.entityId)).toBe(true);

    await syncAll(store);
    expect(store.rows("accounts").get(entry.entityId)?.include_in_summary).toBe(true);
  });

  it("lets a queued CREATE from an older app use the database default", async () => {
    const store = seedServer();
    await createAccountLocally(ownerId, { name: "Old queued account" });
    const [entry] = await offlineDb.outbox.toArray();
    const { include_in_summary: _dropped, ...legacyPayload } = entry.payload;
    void _dropped;
    await offlineDb.outbox.update(entry.seq!, { payload: legacyPayload });

    await syncAll(store);

    expect(store.rows("accounts").get(entry.entityId)?.include_in_summary).toBe(true);
  });

  it("treats an existing cached account without the setting as included", async () => {
    seedServer();
    expect(
      (await offlineDb.accounts.get([ownerId, accountId]))?.include_in_summary
    ).toBeUndefined();
    expect(await localSummaryInclusion()).toBe(true);
  });

  it("updates the local account immediately and synchronizes an opt-out", async () => {
    const store = seedServer();
    await updateAccountLocally(ownerId, {
      accountId,
      name: "Cash",
      openingAmount: 10,
      includeInSummary: false,
    });

    expect(await localSummaryInclusion()).toBe(false);
    expect((await offlineDb.outbox.toArray())[0].payload.include_in_summary).toBe(false);

    await syncAll(store);
    expect(store.rows("accounts").get(accountId)?.include_in_summary).toBe(false);
    await ensureOfflineBootstrap(ownerId, true);
    expect(await localSummaryInclusion()).toBe(false);
  });

  it("keeps an offline opt-out after the local database is reopened", async () => {
    seedServer();
    await updateAccountLocally(ownerId, {
      accountId,
      name: "Cash",
      openingAmount: 10,
      includeInSummary: false,
    });

    offlineDb.close();
    await offlineDb.open();

    expect(await localSummaryInclusion()).toBe(false);
    expect((await offlineDb.outbox.toArray())[0].payload.include_in_summary).toBe(false);
  });

  it("keeps a pending local opt-out over an older server snapshot", async () => {
    seedServer("general", true);
    await updateAccountLocally(ownerId, {
      accountId,
      name: "Cash",
      openingAmount: 10,
      includeInSummary: false,
    });

    await ensureOfflineBootstrap(ownerId, true);

    expect(await localSummaryInclusion()).toBe(false);
    expect((await offlineDb.outbox.toArray())[0].payload.include_in_summary).toBe(false);
  });

  it("replays a retried change followed by a newer choice so the latest value wins", async () => {
    const store = seedServer("general", true);
    await updateAccountLocally(ownerId, {
      accountId,
      name: "Cash",
      openingAmount: 10,
      includeInSummary: false,
    });
    const [first] = await offlineDb.outbox.toArray();

    // The server applied the first operation but its response was lost.
    await runSyncBatch(store as never, ownerId, [wire(first)]);
    await offlineDb.outbox.update(first.seq!, { attempts: 1 });
    await updateAccountLocally(ownerId, {
      accountId,
      name: "Cash",
      openingAmount: 10,
      includeInSummary: true,
    });

    const queued = await offlineDb.outbox.orderBy("seq").toArray();
    expect(queued.map((entry) => entry.payload.include_in_summary)).toEqual([
      false,
      true,
    ]);

    const overlaid = overlayOutbox(
      ownerId,
      {
        accounts: [
          { ...(store.rows("accounts").get(accountId) as Row), ownerId } as never,
        ],
        categories: [],
        transactions: [],
        budget: null,
      },
      { accounts: [], categories: [], transactions: [], budget: null },
      queued
    );
    expect(overlaid.accounts[0].include_in_summary).toBe(true);

    await syncAll(store);
    expect(store.rows("accounts").get(accountId)?.include_in_summary).toBe(true);
  });

  it("coalesces unsent toggles so only the latest value is synchronized", async () => {
    const store = seedServer("general", true);
    await updateAccountLocally(ownerId, {
      accountId,
      name: "Cash",
      openingAmount: 10,
      includeInSummary: false,
    });
    await updateAccountLocally(ownerId, {
      accountId,
      name: "Cash",
      openingAmount: 10,
      includeInSummary: true,
    });
    await updateAccountLocally(ownerId, {
      accountId,
      name: "Cash",
      openingAmount: 10,
      includeInSummary: false,
    });

    const queued = await offlineDb.outbox.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0].payload.include_in_summary).toBe(false);

    await syncAll(store);
    expect(store.rows("accounts").get(accountId)?.include_in_summary).toBe(false);
  });

  it("does not let a stale cached name edit restore an older setting", async () => {
    const store = seedServer("general", false);
    // The device still has the legacy/missing value, which normalizes to true,
    // while another device has already opted this account out on the server.
    expect(await localSummaryInclusion()).toBe(true);
    await updateAccountLocally(ownerId, {
      accountId,
      name: "Cash box",
      openingAmount: 10,
    });
    const [entry] = await offlineDb.outbox.toArray();

    expect(entry.payload).not.toHaveProperty("include_in_summary");
    await syncAll(store);

    expect(store.rows("accounts").get(accountId)).toMatchObject({
      name: "Cash box",
      include_in_summary: false,
    });
  });

  it("does not let a stale cached opening-balance edit restore an older setting", async () => {
    const store = seedServer("general", false);
    expect(await localSummaryInclusion()).toBe(true);
    await updateAccountLocally(ownerId, {
      accountId,
      name: "Cash",
      openingAmount: 25,
    });
    const [entry] = await offlineDb.outbox.toArray();

    expect(entry.payload).toMatchObject({ opening_balance: 25 });
    expect(entry.payload).not.toHaveProperty("include_in_summary");
    await syncAll(store);

    expect(store.rows("accounts").get(accountId)).toMatchObject({
      opening_balance: 25,
      include_in_summary: false,
    });
  });
});

describe("account groups: Trash and restore", () => {
  it("keeps the group through Trash and restore", async () => {
    const store = seedServer("primary");
    await ensureOfflineBootstrap(ownerId, true);
    await trashAccountLocally(ownerId, accountId, "CONFIRM");
    await syncAll(store);
    expect(store.rows("accounts").get(accountId)?.deleted_at).not.toBeNull();

    await restoreAccountLocally(ownerId, accountId);
    await syncAll(store);
    await ensureOfflineBootstrap(ownerId, true);
    expect(store.rows("accounts").get(accountId)).toMatchObject({ deleted_at: null, account_group: "primary" });
    expect(await localGroup()).toBe("primary");
  });

  it("rejects a group change for an account that is in Trash on the server", async () => {
    const store = seedServer();
    await updateAccountLocally(ownerId, { accountId, name: "Cash", openingAmount: 10, accountGroup: "primary" });
    store.rows("accounts").get(accountId)!.deleted_at = new Date().toISOString();
    const response = await syncAll(store);
    expect(response.results).toMatchObject([{ status: "rejected" }]);
    expect(store.rows("accounts").get(accountId)?.account_group).toBe("general");
  });
});

describe("account archive", () => {
  const income = {
    type: "income" as const,
    amount: 7,
    accountId,
    categoryId,
    transactionDate: "2026-11-02",
    transactionTime: "10:00",
  };

  /** Server with the archive migration applied (archived_at exists, null). */
  function seedArchiveServer() {
    const store = seedServer();
    store.rows("accounts").get(accountId)!.archived_at = null;
    return store;
  }

  it("helpers: only a new account for a transaction is blocked by archiving", () => {
    expect(isAccountArchived({ archived_at: null })).toBe(false);
    expect(isAccountArchived({})).toBe(false);
    expect(isAccountArchived({ archived_at: BASE })).toBe(true);
    expect(archivedAccountBlocks({ id: "a", archived_at: BASE })).toBe(true);
    expect(archivedAccountBlocks({ id: "a", archived_at: BASE }, "a")).toBe(false);
    expect(archivedAccountBlocks({ id: "a", archived_at: BASE }, "b")).toBe(true);
    expect(archivedAccountBlocks({ id: "a", archived_at: null }, "b")).toBe(false);
  });

  it("offline: hides the account from the add form, blocks adds, still allows editing its history", async () => {
    await setAccountArchivedLocally(ownerId, accountId, true);
    expect(isAccountArchived(await offlineDb.accounts.get([ownerId, accountId]))).toBe(true);

    const options = await loadLocalTransactionOptions(ownerId);
    expect(options.accounts.map((account) => account.id)).not.toContain(accountId);

    await expect(createTransactionLocally(ownerId, income)).rejects.toThrow(ARCHIVED_ACCOUNT_ERROR);
    // The existing transaction in the archived account can still be corrected.
    await expect(
      updateTransactionLocally(ownerId, { ...income, transactionId, amount: 6 })
    ).resolves.toBeUndefined();
    expect(Number((await offlineDb.transactions.get([ownerId, transactionId]))?.amount)).toBe(6);
  });

  it("still deletes a transaction from an archived account, locally and on the server", async () => {
    const store = seedArchiveServer();
    store.rows("accounts").get(accountId)!.archived_at = BASE;
    await setAccountArchivedLocally(ownerId, accountId, true);
    await offlineDb.outbox.clear();
    await deleteTransactionLocally(ownerId, transactionId);
    expect(await offlineDb.transactions.get([ownerId, transactionId])).toBeUndefined();
    const response = await syncAll(store);
    expect(response.results).toMatchObject([{ status: "applied" }]);
    expect(store.rows("transactions").has(transactionId)).toBe(false);
  });

  it("blocks moving an existing transaction into an archived account", async () => {
    const other = "55555555-5555-4555-8555-555555555555";
    await offlineDb.accounts.put({
      ownerId,
      id: other,
      user_id: ownerId,
      name: "Old wallet",
      account_type: "other",
      opening_balance: 0,
      currency: "INR",
      archived_at: BASE,
      deleted_at: null,
      created_at: BASE,
      updated_at: BASE,
    });
    await expect(
      updateTransactionLocally(ownerId, { ...income, transactionId, accountId: other, amount: 5 })
    ).rejects.toThrow(ARCHIVED_ACCOUNT_ERROR);
  });

  it("syncs archive and unarchive; the server stamps its own time and the snapshot keeps it", async () => {
    const store = seedArchiveServer();
    await ensureOfflineBootstrap(ownerId, true);
    await setAccountArchivedLocally(ownerId, accountId, true);
    const response = await syncAll(store);
    expect(response.results).toMatchObject([{ status: "applied" }]);
    expect(store.rows("accounts").get(accountId)?.archived_at).toEqual(expect.any(String));

    await ensureOfflineBootstrap(ownerId, true);
    expect(isAccountArchived(await offlineDb.accounts.get([ownerId, accountId]))).toBe(true);
    // Balance inputs are untouched: still counted everywhere except the Transactions page.
    expect(await offlineDb.transactions.get([ownerId, transactionId])).toBeTruthy();

    await setAccountArchivedLocally(ownerId, accountId, false);
    await syncAll(store);
    expect(store.rows("accounts").get(accountId)?.archived_at).toBeNull();
    await ensureOfflineBootstrap(ownerId, true);
    await expect(createTransactionLocally(ownerId, income)).resolves.toBeUndefined();
  });

  it("the server rejects a queued add for an account archived on another device", async () => {
    const store = seedArchiveServer();
    await createTransactionLocally(ownerId, income);
    store.rows("accounts").get(accountId)!.archived_at = BASE;
    const response = await syncAll(store);
    expect(response.results[0]).toMatchObject({ status: "rejected", error: ARCHIVED_ACCOUNT_ERROR });
  });

  it("rejects archiving an account that is in Trash on the server", async () => {
    const store = seedArchiveServer();
    await setAccountArchivedLocally(ownerId, accountId, true);
    store.rows("accounts").get(accountId)!.deleted_at = new Date().toISOString();
    const response = await syncAll(store);
    expect(response.results).toMatchObject([{ status: "rejected" }]);
    expect(store.rows("accounts").get(accountId)?.archived_at).toBeNull();
  });

  it("explains that the migration is needed when the server has no archived_at column", async () => {
    const store = seedServer(); // no archived_at key, like the database before the migration
    await setAccountArchivedLocally(ownerId, accountId, true);
    const response = await syncAll(store);
    expect(response.results[0]).toMatchObject({ status: "rejected", error: expect.stringMatching(/archive database migration/) });
  });
});

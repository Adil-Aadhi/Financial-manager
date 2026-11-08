import { beforeEach, describe, expect, it } from "vitest";
import { offlineDb } from "./db";
import {
  createInstallmentPlanLocally,
  deleteInstallmentPaymentLocally,
  deleteTransactionLocally,
  saveInstallmentPaymentLocally,
  updateTransactionLocally,
  type LocalInstallmentPaymentInput,
} from "./mutations";
import { runSyncBatch } from "@/lib/server/syncApply";
import { FakeInstallmentsDb } from "@/lib/server/fakeInstallmentsDb";
import type { SyncOperation } from "@/lib/sync/types";

/**
 * Offline → reconnect, end to end on the TypeScript side: real local mutations write IndexedDB and
 * the outbox, the real sync apply replays that outbox against an in-memory server, and the result
 * is compared with the device. The server's SQL functions are simulated here; they are executed
 * against real Postgres separately.
 */
const ownerId = "11111111-1111-4111-8111-111111111111";
const planId = "22222222-2222-4222-8222-222222222222";
const savings = "44444444-4444-4444-8444-444444444444";
const hdfc = "55555555-5555-4555-8555-555555555555";
const categoryId = "66666666-6666-4666-8666-666666666666";
const synced = "77777777-7777-4777-8777-777777777777";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let server: FakeInstallmentsDb;

const pay = (number: number, overrides: Partial<LocalInstallmentPaymentInput> = {}): LocalInstallmentPaymentInput => ({
  paymentId: uuid(100 + number), planId, installmentNumber: number, kind: "installment", coversThrough: number,
  actualAmount: 5_000, paymentDate: "2026-01-05", paymentMethod: "account", accountId: savings,
  transactionOrigin: "created", transactionId: uuid(200 + number), notes: "", transactionTime: "", ...overrides,
});
const cash = (number: number, overrides: Partial<LocalInstallmentPaymentInput> = {}) =>
  pay(number, { paymentMethod: "cash", accountId: null, transactionOrigin: null, transactionId: null, ...overrides });

async function outboxOperations(): Promise<SyncOperation[]> {
  const entries = await offlineDb.outbox.orderBy("seq").toArray();
  return entries.map((entry) => ({
    opId: entry.opId, seq: entry.seq!, ownerId: entry.ownerId, entity: entry.entity, entityId: entry.entityId, op: entry.op,
    payload: entry.payload, transactionDateIntent: entry.transactionDateIntent, baseUpdatedAt: entry.baseUpdatedAt, editedAt: entry.updatedAt,
  }));
}

const client = () => server as unknown as Parameters<typeof runSyncBatch>[0];

function serverBalance(accountId: string) {
  return server.tables.transactions.filter((row) => row.account_id === accountId).reduce((sum, row) => sum - Number(row.amount), 100_000);
}
async function localBalance(accountId: string) {
  const rows = await offlineDb.transactions.where("[ownerId+account_id]").equals([ownerId, accountId]).toArray();
  return rows.reduce((sum, row) => sum - Number(row.amount), 100_000);
}
const serverTransactions = () => server.tables.transactions.map((row) => [row.id, Number(row.amount), row.account_id]).sort();
async function localTransactions() {
  return (await offlineDb.transactions.toArray()).map((row) => [row.id, Number(row.amount), row.account_id]).sort();
}

beforeEach(async () => {
  await offlineDb.delete();
  await offlineDb.open();
  const now = new Date().toISOString();
  await offlineDb.syncMeta.put({
    ownerId, completedAt: now, budgetAvailable: true, dailyBudgetAvailable: true, subscriptionsAvailable: true, billsAvailable: true,
    installmentsAvailable: true, server: { accounts: 0, transactions: 0, income: 0, expense: 0 }, local: { accounts: 0, transactions: 0, income: 0, expense: 0 }, totalsMatch: true,
  });
  server = new FakeInstallmentsDb(ownerId);
  for (const [id, name] of [[savings, "Savings"], [hdfc, "HDFC"]]) {
    await offlineDb.accounts.add({ ownerId, id, user_id: ownerId, name, account_type: "bank", opening_balance: 100_000, currency: "INR", deleted_at: null, created_at: now, updated_at: now });
    server.tables.accounts.push({ id, user_id: ownerId, deleted_at: null });
  }
  await offlineDb.categories.add({ ownerId, id: categoryId, user_id: null, name: "Installment Payment", type: "expense", icon: "calendar-clock", is_default: true });
  server.tables.categories.push({ id: categoryId, user_id: null, name: "Installment Payment", type: "expense", is_default: true });
  // A user-recorded expense that already exists on both sides (to be linked offline).
  const existing = { id: synced, user_id: ownerId, account_id: hdfc, category_id: categoryId, type: "expense", amount: 5_000, description: "EMI via bank app", transaction_date: "2026-03-05", transaction_time: null, created_at: now, updated_at: now };
  await offlineDb.transactions.add({ ownerId, ...existing });
  server.tables.transactions.push({ ...existing });

  await createInstallmentPlanLocally(ownerId, {
    id: planId, name: "iPhone EMI", description: "", planType: "product_emi", provider: "Bank EMI", productCategory: "mobile", icon: "smartphone",
    originalAmount: 60_000, downPayment: 0, interestAmount: 0, additionalFees: 0, currency: "INR", installmentCount: 12,
    defaultInstallmentAmount: 5_000, billingCycle: "monthly", billingInterval: 1, startDate: "2026-01-01", firstDueDate: "2026-01-05", reminderDays: 3, notes: "",
  });
});

describe("offline installment editing and deletion sync", () => {
  it("replays a full offline session so the server matches the device, with correct balances", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));                                              // account, created
    await saveInstallmentPaymentLocally(ownerId, pay(1, { actualAmount: 5_250, paymentDate: "2026-01-09", accountId: hdfc })); // edit amount, date, account
    await saveInstallmentPaymentLocally(ownerId, cash(2));                                             // cash
    await saveInstallmentPaymentLocally(ownerId, pay(2, { transactionId: uuid(302) }));                // cash → account
    await saveInstallmentPaymentLocally(ownerId, pay(3));                                              // account …
    await saveInstallmentPaymentLocally(ownerId, cash(3, { paymentMethod: "manual" }));               // … → manual
    await saveInstallmentPaymentLocally(ownerId, pay(4, { accountId: hdfc, transactionOrigin: "linked", transactionId: synced }));
    await deleteInstallmentPaymentLocally(ownerId, uuid(104));                                         // undo linked: keep it
    await saveInstallmentPaymentLocally(ownerId, pay(5));
    await deleteInstallmentPaymentLocally(ownerId, uuid(105));                                         // undo generated

    const operations = await outboxOperations();
    expect(operations.filter((operation) => operation.entity === "transaction")).toHaveLength(0);
    const response = await runSyncBatch(client(), ownerId, operations);
    expect(response.results.map((result) => result.status).every((status) => status === "applied" || status === "already-applied")).toBe(true);
    expect(response.results).toHaveLength(operations.length);

    expect(serverTransactions()).toEqual(await localTransactions());
    expect(server.tables.transactions.find((row) => row.id === uuid(201))).toMatchObject({ amount: 5_250, account_id: hdfc, transaction_date: "2026-01-09" });
    expect(server.tables.transactions.find((row) => row.id === synced)).toMatchObject({ amount: 5_000, description: "EMI via bank app", transaction_date: "2026-03-05" });
    for (const account of [savings, hdfc]) expect(serverBalance(account)).toBe(await localBalance(account));
    expect([serverBalance(savings), serverBalance(hdfc)]).toEqual([95_000, 89_750]);

    const serverPayments = server.tables.installment_payments.map((row) => [row.id, row.payment_method, row.transaction_id ?? null]).sort();
    const localPayments = (await offlineDb.installmentPayments.toArray()).map((row) => [row.id, row.payment_method, row.transaction_id ?? null]).sort();
    expect(serverPayments).toEqual(localPayments);
    expect(serverPayments).toEqual([[uuid(101), "account", uuid(201)], [uuid(102), "account", uuid(302)], [uuid(103), "manual", null]]);
  });

  it("re-sending the same outbox (lost response, retry, second device wake) never duplicates expenses", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    await saveInstallmentPaymentLocally(ownerId, cash(2));
    await saveInstallmentPaymentLocally(ownerId, pay(3, { accountId: hdfc }));
    const operations = await outboxOperations();
    await runSyncBatch(client(), ownerId, operations);
    const afterFirst = serverTransactions();
    const second = await runSyncBatch(client(), ownerId, operations);
    const third = await runSyncBatch(client(), ownerId, operations);
    for (const response of [second, third]) {
      expect(response.results.every((result) => result.status === "already-applied")).toBe(true);
    }
    expect(serverTransactions()).toEqual(afterFirst);
    expect(server.tables.transactions).toHaveLength(3); // synced + 2 generated
    expect(server.tables.installment_payments).toHaveLength(3);
    expect([serverBalance(savings), serverBalance(hdfc)]).toEqual([95_000, 90_000]);
  });

  it("a stale queued edit of a generated expense is refused instead of overwriting it", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    await runSyncBatch(client(), ownerId, await outboxOperations());
    const stale: SyncOperation = {
      opId: "stale", seq: 999, ownerId, entity: "transaction", entityId: uuid(201), op: "UPDATE",
      payload: { amount: 1 }, transactionDateIntent: "unchanged", baseUpdatedAt: null, editedAt: new Date().toISOString(),
    };
    const result = await runSyncBatch(client(), ownerId, [stale]);
    expect(result.results[0]).toMatchObject({ status: "rejected", error: expect.stringMatching(/managed by Installments/) });
    expect(server.tables.transactions.find((row) => row.id === uuid(201))?.amount).toBe(5_000);
  });

  it("linked transaction edited and deleted offline: server ends identical to the device", async () => {
    // Link the already-synced expense, sync, then go offline.
    await saveInstallmentPaymentLocally(ownerId, pay(1, { accountId: hdfc, transactionOrigin: "linked", transactionId: synced }));
    await runSyncBatch(client(), ownerId, await outboxOperations());
    await offlineDb.outbox.clear();

    const edit = (overrides: Record<string, unknown>) => updateTransactionLocally(ownerId, {
      transactionId: synced, type: "expense", amount: 5_000, accountId: hdfc, categoryId, transactionDate: "2026-03-05", transactionTime: "", remark: "EMI via bank app", ...overrides,
    });
    await edit({ amount: 5_100 });                                                         // Transactions edit
    await saveInstallmentPaymentLocally(ownerId, pay(1, { accountId: hdfc, transactionOrigin: "linked", transactionId: synced, notes: "noted" })); // payment edit
    await edit({ amount: 5_200, accountId: savings, transactionDate: "2026-03-07" });      // merges and moves behind the payment edit
    const kinds = (await outboxOperations()).map((operation) => operation.entity);
    expect(kinds).toEqual(["installment_payment", "transaction"]);

    const response = await runSyncBatch(client(), ownerId, await outboxOperations());
    expect(response.results.every((result) => result.status === "applied" || result.status === "already-applied")).toBe(true);
    const local = (await offlineDb.installmentPayments.get([ownerId, uuid(101)]))!;
    const remote = server.tables.installment_payments.find((row) => row.id === uuid(101))!;
    const view = (row: Record<string, unknown>) => [Number(row.actual_amount), row.payment_date, row.account_id, row.transaction_id, row.notes];
    expect(view(remote)).toEqual(view(local as unknown as Record<string, unknown>));
    expect(remote).toMatchObject({ actual_amount: 5_200, payment_date: "2026-03-07", account_id: savings, notes: "noted" });
    expect(serverTransactions()).toEqual(await localTransactions());
    for (const account of [savings, hdfc]) expect(serverBalance(account)).toBe(await localBalance(account));

    // Delete it offline, then replay twice.
    await offlineDb.outbox.clear();
    await deleteTransactionLocally(ownerId, synced);
    const deletion = await outboxOperations();
    await runSyncBatch(client(), ownerId, deletion);
    expect((await runSyncBatch(client(), ownerId, deletion)).results[0].status).toBe("already-applied");
    expect(server.tables.installment_payments.find((row) => row.id === uuid(101))).toMatchObject({ transaction_id: null, account_id: null, actual_amount: 5_200, payment_date: "2026-03-07", payment_method: "account" });
    expect(await offlineDb.installmentPayments.get([ownerId, uuid(101)])).toMatchObject({ transaction_id: null, account_id: null, actual_amount: 5_200, payment_date: "2026-03-07" });
    expect([serverBalance(savings), serverBalance(hdfc)]).toEqual([100_000, 100_000]);
    expect([await localBalance(savings), await localBalance(hdfc)]).toEqual([100_000, 100_000]);
  });
});

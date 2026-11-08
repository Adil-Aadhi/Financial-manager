import { beforeEach, describe, expect, it } from "vitest";
import { runSyncBatch } from "./syncApply";
import type { SyncOperation } from "@/lib/sync/types";
import { FakeInstallmentsDb as FakeDb } from "./fakeInstallmentsDb";

type Row = Record<string, unknown>;
const USER = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";
const SAVINGS = "44444444-4444-4444-8444-444444444444";
const HDFC = "55555555-5555-4555-8555-555555555555";
const CATEGORY = "66666666-6666-4666-8666-666666666666";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let db: FakeDb;
let seq = 0;
const client = () => db as unknown as Parameters<typeof runSyncBatch>[0];

function op(entity: SyncOperation["entity"], entityId: string, kind: SyncOperation["op"], payload: Row, opId = `op-${++seq}`): SyncOperation {
  return { opId, seq, ownerId: USER, entity, entityId, op: kind, payload, baseUpdatedAt: null, editedAt: "2026-01-05T10:00:00.000Z" };
}

const planPayload = {
  name: "iPhone EMI", description: "", plan_type: "product_emi", provider: "Bank EMI", product_category: "mobile", icon: "smartphone",
  original_amount: 80_000, down_payment: 20_000, interest_amount: 0, additional_fees: 0, currency: "INR", installment_count: 12,
  default_installment_amount: 5_000, billing_cycle: "monthly", billing_interval: 1, start_date: "2026-01-01", first_due_date: "2026-01-05",
  reminder_days: 3, notes: "",
};

const accountPayment = (number: number, extra: Row = {}) => ({
  installment_plan_id: PLAN, installment_number: number, kind: "installment", covers_through: number, actual_amount: 5_000,
  payment_date: "2026-01-05", payment_method: "account", account_id: SAVINGS, transaction_id: uuid(200 + number),
  transaction_origin: "created", notes: "", transaction_time: "10:00", ...extra,
});
const cashPayment = (number: number, extra: Row = {}) =>
  accountPayment(number, { payment_method: "cash", account_id: null, transaction_id: null, transaction_origin: null, ...extra });

beforeEach(async () => {
  db = new FakeDb(USER);
  db.tables.accounts.push({ id: SAVINGS, user_id: USER, deleted_at: null }, { id: HDFC, user_id: USER, deleted_at: null });
  db.tables.categories.push({ id: CATEGORY, user_id: null, name: "Installment Payment", type: "expense", is_default: true });
  const created = await runSyncBatch(client(), USER, [op("installment_plan", PLAN, "CREATE", { ...planPayload, financed_amount: 1, total_repayment_amount: 1 })]);
  expect(created.results[0].status).toBe("applied");
});

describe("installment plan sync", () => {
  it("recomputes financed and total amounts on the server instead of trusting the payload", () => {
    expect(db.tables.installment_plans[0]).toMatchObject({ financed_amount: 60_000, total_repayment_amount: 60_000, lifecycle: "active", user_id: USER });
  });

  it("treats a replayed create as already applied", async () => {
    const replay = await runSyncBatch(client(), USER, [op("installment_plan", PLAN, "CREATE", planPayload)]);
    expect(replay.results[0].status).toBe("already-applied");
    expect(db.tables.installment_plans).toHaveLength(1);
  });

  it("rejects a batch for a different user", async () => {
    const foreign = { ...op("installment_plan", uuid(1), "CREATE", planPayload), ownerId: "99999999-9999-4999-8999-999999999999" };
    expect((await runSyncBatch(client(), USER, [foreign])).status).toBe("wrong-user");
  });
});

describe("installment payment sync", () => {
  it("creates the payment and exactly one expense with the server-resolved category", async () => {
    const result = await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "CREATE", accountPayment(1))]);
    expect(result.results[0].status).toBe("applied");
    expect(db.rpcCalls).toHaveLength(1);
    // Due date, expected amount, category and description are not sent: the database computes them.
    expect(db.rpcCalls[0].args).toMatchObject({ p_transaction_origin: "created", p_transaction_time: "10:00:00" });
    for (const key of ["p_category_id", "p_description", "p_expected_amount", "p_due_date", "p_covers_through"]) expect(db.rpcCalls[0].args).not.toHaveProperty(key);
    expect(db.tables.transactions).toHaveLength(1);
    expect(db.tables.transactions[0]).toMatchObject({ category_id: CATEGORY, description: "iPhone EMI – Installment 1/12", amount: 5_000 });
    expect(db.tables.installment_payments[0]).toMatchObject({ expected_amount: 5_000, due_date: "2026-01-05" });
  });

  it("replaying the same payment (retry, refresh or offline replay) never creates a second expense", async () => {
    const first = op("installment_payment", uuid(101), "CREATE", accountPayment(1));
    await runSyncBatch(client(), USER, [first]);
    const retry = await runSyncBatch(client(), USER, [first]);
    const replayWithNewOpId = await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "CREATE", accountPayment(1))]);
    expect(retry.results[0].status).toBe("already-applied");
    expect(replayWithNewOpId.results[0].status).toBe("already-applied");
    expect(db.rpcCalls).toHaveLength(1);
    expect(db.tables.transactions).toHaveLength(1);
  });

  it("cash and manual payments never pass an account or transaction", async () => {
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "CREATE", cashPayment(1))]);
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(102), "CREATE", cashPayment(2, { payment_method: "manual" }))]);
    expect(db.rpcCalls.map((call) => [call.args.p_account_id, call.args.p_transaction_id, call.args.p_transaction_origin])).toEqual([[null, null, null], [null, null, null]]);
    expect(db.tables.transactions).toHaveLength(0);
    const smuggled = await runSyncBatch(client(), USER, [op("installment_payment", uuid(103), "CREATE", cashPayment(3, { account_id: SAVINGS }))]);
    expect(smuggled.results[0]).toMatchObject({ status: "rejected" });
    expect(db.rpcCalls).toHaveLength(2);
  });

  it("switching Linked Account → Cash removes the created expense; undo removes it too", async () => {
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "CREATE", accountPayment(1))]);
    const toCash = await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "UPDATE", cashPayment(1))]);
    expect(toCash.results[0].status).toBe("applied");
    expect(db.tables.transactions).toHaveLength(0);
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(102), "CREATE", accountPayment(2, { account_id: HDFC }))]);
    expect(db.tables.transactions).toHaveLength(1);
    const undo = await runSyncBatch(client(), USER, [op("installment_payment", uuid(102), "DELETE", {})]);
    expect(undo.results[0].status).toBe("applied");
    expect(db.tables.transactions).toHaveLength(0);
    const undoAgain = await runSyncBatch(client(), USER, [op("installment_payment", uuid(102), "DELETE", {})]);
    expect(undoAgain.results[0].status).toBe("already-applied");
  });

  it("an unchanged update is recognised as already applied", async () => {
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "CREATE", accountPayment(1))]);
    const same = await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "UPDATE", accountPayment(1))]);
    expect(same.results[0].status).toBe("already-applied");
    expect(db.rpcCalls).toHaveLength(1);
  });

  it("validates linked transactions: ownership, account and amount", async () => {
    db.tables.transactions.push(
      { id: uuid(500), user_id: USER, account_id: HDFC, type: "expense", amount: 4_000 },
      { id: uuid(501), user_id: "99999999-9999-4999-8999-999999999999", account_id: HDFC, type: "expense", amount: 5_000 },
      { id: uuid(502), user_id: USER, account_id: HDFC, type: "expense", amount: 5_000 }
    );
    const linked = (txId: string) => accountPayment(1, { account_id: HDFC, transaction_origin: "linked", transaction_id: txId });
    expect((await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "CREATE", linked(uuid(500)))])).results[0].error).toMatch(/must match/);
    expect((await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "CREATE", linked(uuid(501)))])).results[0].error).toMatch(/no longer exists/);
    expect(db.rpcCalls).toHaveLength(0);
    const ok = await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "CREATE", linked(uuid(502)))]);
    expect(ok.results[0].status).toBe("applied");
    expect(db.tables.transactions).toHaveLength(3);
  });

  it("rejects a second payment for the same installment and an account payment without an account", async () => {
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "CREATE", cashPayment(1))]);
    expect((await runSyncBatch(client(), USER, [op("installment_payment", uuid(109), "CREATE", cashPayment(1))])).results[0].error).toMatch(/already has a payment/);
    expect((await runSyncBatch(client(), USER, [op("installment_payment", uuid(110), "CREATE", accountPayment(2, { account_id: null }))])).results[0].status).toBe("rejected");
  });

  it("rejects an account payment when the Installment Payment category is missing", async () => {
    db.tables.categories = [];
    const result = await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "CREATE", accountPayment(1))]);
    expect(result.results[0].error).toMatch(/category is missing/);
    expect(db.tables.transactions).toHaveLength(0);
  });

  it("stops the batch at a rejected payment so later changes never overtake it", async () => {
    const response = await runSyncBatch(client(), USER, [
      op("installment_payment", uuid(101), "CREATE", accountPayment(1, { account_id: null })),
      op("installment_payment", uuid(102), "CREATE", cashPayment(2)),
    ]);
    expect(response.results).toHaveLength(1);
    expect(db.tables.installment_payments).toHaveLength(0);
  });
});

describe("generated expenses are managed by Installments", () => {
  const txUpdate = (id: string, payload: Row) => op("transaction", id, "UPDATE", payload);
  const regular = { id: uuid(900), user_id: USER, account_id: SAVINGS, category_id: CATEGORY, type: "expense", amount: 300, description: "Lunch", transaction_date: "2026-01-04", transaction_time: null, updated_at: null };

  it("refuses direct edits and deletes of the generated expense, from any device's queue", async () => {
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "CREATE", accountPayment(1))]);
    const edit = await runSyncBatch(client(), USER, [txUpdate(uuid(201), { amount: 1, account_id: HDFC, category_id: CATEGORY, type: "expense", transaction_date: "2026-01-05" })]);
    expect(edit.results[0]).toMatchObject({ status: "rejected", error: expect.stringMatching(/managed by Installments/) });
    const remove = await runSyncBatch(client(), USER, [op("transaction", uuid(201), "DELETE", {})]);
    expect(remove.results[0]).toMatchObject({ status: "rejected", error: expect.stringMatching(/managed by Installments/) });
    expect(db.tables.transactions[0]).toMatchObject({ id: uuid(201), amount: 5_000, account_id: SAVINGS });
  });

  it("leaves regular and manually linked transactions editable and deletable", async () => {
    db.tables.transactions.push({ ...regular }, { ...regular, id: uuid(901), amount: 5_000 });
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "CREATE", accountPayment(1, { transaction_origin: "linked", transaction_id: uuid(901) }))]);
    const edit = await runSyncBatch(client(), USER, [txUpdate(uuid(900), { amount: 350 })]);
    expect(edit.results[0].status).toBe("applied");
    expect((await runSyncBatch(client(), USER, [txUpdate(uuid(901), { description: "EMI (bank app)" })])).results[0].status).toBe("applied");
    expect((await runSyncBatch(client(), USER, [op("transaction", uuid(900), "DELETE", {})])).results[0].status).toBe("applied");
    expect(db.tables.transactions.map((row) => row.id)).toEqual([uuid(901)]);
  });

  it("edits amount, date and account on the same generated transaction (never a second one)", async () => {
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "CREATE", accountPayment(1))]);
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "UPDATE", accountPayment(1, { actual_amount: 5_250 }))]);
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "UPDATE", accountPayment(1, { actual_amount: 5_250, payment_date: "2026-01-09" }))]);
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "UPDATE", accountPayment(1, { actual_amount: 5_250, payment_date: "2026-01-09", account_id: HDFC }))]);
    expect(db.tables.transactions).toHaveLength(1);
    expect(db.tables.transactions[0]).toMatchObject({ id: uuid(201), amount: 5_250, transaction_date: "2026-01-09", account_id: HDFC });
    expect(db.tables.installment_payments[0]).toMatchObject({ actual_amount: 5_250, payment_date: "2026-01-09", account_id: HDFC, transaction_id: uuid(201) });
  });

  it("Linked Account → Cash deletes only the generated expense and keeps the payment history", async () => {
    db.tables.transactions.push({ ...regular });
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "CREATE", accountPayment(1))]);
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "UPDATE", cashPayment(1))]);
    expect(db.tables.transactions.map((row) => row.id)).toEqual([uuid(900)]);
    expect(db.tables.installment_payments[0]).toMatchObject({ payment_method: "cash", account_id: null, transaction_id: null, transaction_origin: null, actual_amount: 5_000 });
  });
});

describe("manually linked transactions stay in step with their payment", () => {
  const base = { id: uuid(950), user_id: USER, account_id: SAVINGS, category_id: CATEGORY, type: "expense", amount: 5_000, description: "Bank app EMI", transaction_date: "2026-01-04", transaction_time: null, updated_at: null };
  const linkedPayment = (extra: Row = {}) => accountPayment(1, { transaction_origin: "linked", transaction_id: uuid(950), notes: "via app", ...extra });
  const balance = (account: string) => db.tables.transactions.filter((row) => row.account_id === account).reduce((sum, row) => sum - Number(row.amount), 100_000);

  beforeEach(async () => {
    db.tables.transactions.push({ ...base });
    const linked = await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "CREATE", linkedPayment())]);
    expect(linked.results[0].status).toBe("applied");
  });

  it("a new link takes the transaction's date", () => {
    expect(db.tables.installment_payments[0]).toMatchObject({ payment_date: "2026-01-04", actual_amount: 5_000, account_id: SAVINGS });
  });

  it("editing amount, date and account in Transactions (synced) updates the payment", async () => {
    const edit = await runSyncBatch(client(), USER, [
      op("transaction", uuid(950), "UPDATE", { amount: 5_250, transaction_date: "2026-01-09", account_id: HDFC, category_id: CATEGORY, type: "expense" }),
    ]);
    expect(edit.results[0].status).toBe("applied");
    expect(db.tables.installment_payments[0]).toMatchObject({ actual_amount: 5_250, payment_date: "2026-01-09", account_id: HDFC, transaction_id: uuid(950), transaction_origin: "linked", notes: "via app" });
    expect([balance(SAVINGS), balance(HDFC)]).toEqual([100_000, 94_750]);
  });

  it("deleting it in Transactions clears only the references and keeps amount and date", async () => {
    expect((await runSyncBatch(client(), USER, [op("transaction", uuid(950), "DELETE", {})])).results[0].status).toBe("applied");
    expect(db.tables.installment_payments[0]).toMatchObject({ payment_method: "account", transaction_id: null, account_id: null, actual_amount: 5_000, payment_date: "2026-01-04", transaction_origin: "linked" });
    expect(balance(SAVINGS)).toBe(100_000);
  });

  it("a payment edit queued before a Transactions edit is applied without reverting it", async () => {
    await runSyncBatch(client(), USER, [op("transaction", uuid(950), "UPDATE", { amount: 5_300, account_id: HDFC, category_id: CATEGORY, type: "expense", transaction_date: "2026-01-04" })]);
    const stale = await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "UPDATE", linkedPayment({ notes: "edited" }))]);
    expect(stale.results[0].status).toBe("applied");
    expect(db.tables.installment_payments[0]).toMatchObject({ actual_amount: 5_300, account_id: HDFC, notes: "edited" });
    expect(db.tables.transactions.find((row) => row.id === uuid(950))).toMatchObject({ amount: 5_300, account_id: HDFC });
  });

  it("switching to Cash or undoing only unlinks — the transaction is never touched", async () => {
    const before = { ...db.tables.transactions.find((row) => row.id === uuid(950)) };
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "UPDATE", cashPayment(1))]);
    expect(db.tables.transactions.find((row) => row.id === uuid(950))).toEqual(before);
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "UPDATE", linkedPayment())]);
    await runSyncBatch(client(), USER, [op("installment_payment", uuid(101), "DELETE", {})]);
    expect(db.tables.transactions.find((row) => row.id === uuid(950))).toEqual(before);
    expect(balance(SAVINGS)).toBe(95_000);
  });
});

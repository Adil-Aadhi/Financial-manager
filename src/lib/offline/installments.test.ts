import { beforeEach, describe, expect, it } from "vitest";
import { offlineDb, type OutboxEntry } from "./db";
import { overlayOutbox, type LocalSnapshotRows } from "./snapshotOverlay";
import { dependsOn, selectRunnableEntries } from "./queuePolicy";
import {
  createInstallmentPlanLocally,
  deleteInstallmentPaymentLocally,
  deleteInstallmentPlanLocally,
  deleteTransactionLocally,
  updateTransactionLocally,
  saveInstallmentPaymentLocally,
  setInstallmentPlanLifecycleLocally,
  updateInstallmentPlanLocally,
  type LocalInstallmentPaymentInput,
  type LocalInstallmentPlanInput,
} from "./mutations";

const ownerId = "11111111-1111-4111-8111-111111111111";
const planId = "22222222-2222-4222-8222-222222222222";
const savings = "44444444-4444-4444-8444-444444444444";
const hdfc = "55555555-5555-4555-8555-555555555555";
const categoryId = "66666666-6666-4666-8666-666666666666";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const planInput: LocalInstallmentPlanInput = {
  id: planId,
  name: "iPhone EMI",
  description: "",
  planType: "product_emi",
  provider: "Bank EMI",
  productCategory: "mobile",
  icon: "smartphone",
  originalAmount: 80_000,
  downPayment: 20_000,
  interestAmount: 0,
  additionalFees: 0,
  currency: "INR",
  installmentCount: 12,
  defaultInstallmentAmount: 5_000,
  billingCycle: "monthly",
  billingInterval: 1,
  startDate: "2026-01-01",
  firstDueDate: "2026-01-05",
  reminderDays: 3,
  notes: "",
};

function pay(number: number, overrides: Partial<LocalInstallmentPaymentInput> = {}): LocalInstallmentPaymentInput {
  return {
    paymentId: uuid(100 + number),
    planId,
    installmentNumber: number,
    kind: "installment",
    coversThrough: number,
    actualAmount: 5_000,
    paymentDate: "2026-01-05",
    paymentMethod: "account",
    accountId: savings,
    transactionOrigin: "created",
    transactionId: uuid(200 + number),
    notes: "",
    transactionTime: "",
    ...overrides,
  };
}

const cash = (number: number, overrides: Partial<LocalInstallmentPaymentInput> = {}) =>
  pay(number, { paymentMethod: "cash", accountId: null, transactionOrigin: null, transactionId: null, ...overrides });

async function balance(accountId: string) {
  const account = await offlineDb.accounts.get([ownerId, accountId]);
  const rows = await offlineDb.transactions.where("[ownerId+account_id]").equals([ownerId, accountId]).toArray();
  return rows.reduce((sum, row) => sum + (row.type === "income" ? 1 : -1) * Number(row.amount), Number(account?.opening_balance ?? 0));
}

async function seedAccounts() {
  const now = new Date().toISOString();
  for (const [id, name] of [[savings, "Savings"], [hdfc, "HDFC"]]) {
    await offlineDb.accounts.add({ ownerId, id, user_id: ownerId, name, account_type: "bank", opening_balance: 100_000, currency: "INR", deleted_at: null, created_at: now, updated_at: now });
  }
  await offlineDb.categories.add({ ownerId, id: categoryId, user_id: null, name: "Installment Payment", type: "expense", icon: "calendar-clock", is_default: true });
}

beforeEach(async () => {
  await offlineDb.delete();
  await offlineDb.open();
  await offlineDb.syncMeta.put({
    ownerId,
    completedAt: new Date().toISOString(),
    budgetAvailable: true,
    dailyBudgetAvailable: true,
    subscriptionsAvailable: true,
    billsAvailable: true,
    installmentsAvailable: true,
    server: { accounts: 0, transactions: 0, income: 0, expense: 0 },
    local: { accounts: 0, transactions: 0, income: 0, expense: 0 },
    totalsMatch: true,
  });
  await seedAccounts();
  await createInstallmentPlanLocally(ownerId, planInput);
});

describe("installment plans offline", () => {
  it("creates, edits, pauses and resumes without touching any financial table", async () => {
    await updateInstallmentPlanLocally(ownerId, { ...planInput, name: "iPhone 16 EMI" });
    await setInstallmentPlanLifecycleLocally(ownerId, planId, "paused");
    const row = await offlineDb.installmentPlans.get([ownerId, planId]);
    expect(row).toMatchObject({ name: "iPhone 16 EMI", lifecycle: "paused", financed_amount: 60_000, total_repayment_amount: 60_000 });
    await setInstallmentPlanLifecycleLocally(ownerId, planId, "active");
    expect(await offlineDb.transactions.count()).toBe(0);
    expect(await balance(savings)).toBe(100_000);
    expect(await offlineDb.bills.count()).toBe(0);
    expect(await offlineDb.subscriptions.count()).toBe(0);
    expect(await offlineDb.dailyBudgetExpenses.count()).toBe(0);
  });

  it("refuses when the feature isn't on the device yet", async () => {
    await offlineDb.syncMeta.update(ownerId, { installmentsAvailable: false });
    await expect(createInstallmentPlanLocally(ownerId, { ...planInput, id: uuid(9) })).rejects.toThrow("aren't ready");
  });
});

describe("payment methods", () => {
  it("Linked Account creates exactly one Installment Payment expense and reduces only that account", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    const transactions = await offlineDb.transactions.toArray();
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ id: uuid(201), account_id: savings, category_id: categoryId, type: "expense", amount: 5_000, description: "iPhone EMI – Installment 1/12" });
    expect(await balance(savings)).toBe(95_000);
    expect(await balance(hdfc)).toBe(100_000);
    const payment = await offlineDb.installmentPayments.get([ownerId, uuid(101)]);
    expect(payment).toMatchObject({ payment_method: "account", account_id: savings, transaction_id: uuid(201), transaction_origin: "created", expected_amount: 5_000, due_date: "2026-01-05" });
    // One queued operation carries both: never a separate transaction op that could duplicate.
    const outbox = await offlineDb.outbox.toArray();
    expect(outbox.filter((entry) => entry.entity === "transaction")).toHaveLength(0);
    expect(outbox.filter((entry) => entry.entity === "installment_payment")).toHaveLength(1);
  });

  it("Cash and Other / Manual never create a transaction or change a balance", async () => {
    await saveInstallmentPaymentLocally(ownerId, cash(1));
    await saveInstallmentPaymentLocally(ownerId, cash(2, { paymentMethod: "manual" }));
    expect(await offlineDb.transactions.count()).toBe(0);
    expect(await balance(savings)).toBe(100_000);
    const queued = await offlineDb.outbox.toArray();
    for (const entry of queued.filter((item) => item.entity === "installment_payment")) {
      expect(entry.payload.transaction_row).toBeNull();
      expect(entry.payload.transaction_id).toBeNull();
    }
  });

  it("allows a different method and account for every installment", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    await saveInstallmentPaymentLocally(ownerId, pay(2, { accountId: hdfc }));
    await saveInstallmentPaymentLocally(ownerId, cash(3));
    await saveInstallmentPaymentLocally(ownerId, cash(4, { paymentMethod: "manual" }));
    expect(await balance(savings)).toBe(95_000);
    expect(await balance(hdfc)).toBe(95_000);
    expect(await offlineDb.transactions.count()).toBe(2);
    const history = await offlineDb.installmentPayments.orderBy("[ownerId+id]").toArray();
    expect(history.map((row) => [row.installment_number, row.payment_method, row.account_id])).toEqual([
      [1, "account", savings],
      [2, "account", hdfc],
      [3, "cash", null],
      [4, "manual", null],
    ]);
  });

  it("works with no accounts at all for cash/manual and rejects an account payment", async () => {
    await offlineDb.accounts.clear();
    await saveInstallmentPaymentLocally(ownerId, cash(1));
    await expect(saveInstallmentPaymentLocally(ownerId, pay(2))).rejects.toThrow("active accounts");
    await expect(saveInstallmentPaymentLocally(ownerId, pay(2, { accountId: null }))).rejects.toThrow("account");
  });

  it("blocks a second payment for the same installment and missing category", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    await expect(saveInstallmentPaymentLocally(ownerId, cash(1, { paymentId: uuid(999) }))).rejects.toThrow("already has a payment");
    await offlineDb.categories.clear();
    await expect(saveInstallmentPaymentLocally(ownerId, pay(2))).rejects.toThrow("Installment Payment category");
    expect(await offlineDb.transactions.count()).toBe(1);
  });

  it("re-saving the same payment (a retry) keeps exactly one transaction", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    expect(await offlineDb.transactions.count()).toBe(1);
    expect(await balance(savings)).toBe(95_000);
  });
});

describe("corrections and undo", () => {
  it("corrects the amount and date on the same transaction", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    await saveInstallmentPaymentLocally(ownerId, pay(1, { actualAmount: 5_250, paymentDate: "2026-01-09" }));
    const transactions = await offlineDb.transactions.toArray();
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ amount: 5_250, transaction_date: "2026-01-09" });
    expect(await balance(savings)).toBe(94_750);
  });

  it("moving to another account credits the first and debits the second", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    await saveInstallmentPaymentLocally(ownerId, pay(1, { accountId: hdfc }));
    expect(await balance(savings)).toBe(100_000);
    expect(await balance(hdfc)).toBe(95_000);
    expect(await offlineDb.transactions.count()).toBe(1);
  });

  it("Linked Account → Cash removes the expense; Cash → Linked Account creates exactly one", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    await saveInstallmentPaymentLocally(ownerId, cash(1));
    expect(await offlineDb.transactions.count()).toBe(0);
    expect(await balance(savings)).toBe(100_000);
    const last = (await offlineDb.outbox.toArray()).at(-1)!;
    expect(last.payload.previous_transaction_id).toBe(uuid(201));
    await saveInstallmentPaymentLocally(ownerId, pay(1, { transactionId: uuid(301) }));
    expect(await offlineDb.transactions.count()).toBe(1);
    expect(await balance(savings)).toBe(95_000);
  });

  it("undo restores the balance and reopens a completed plan", async () => {
    await updateInstallmentPlanLocally(ownerId, { ...planInput, installmentCount: 2, defaultInstallmentAmount: 30_000 });
    await saveInstallmentPaymentLocally(ownerId, pay(1, { actualAmount: 30_000 }));
    await saveInstallmentPaymentLocally(ownerId, pay(2, { actualAmount: 30_000 }));
    expect((await offlineDb.installmentPlans.get([ownerId, planId]))?.lifecycle).toBe("completed");
    await deleteInstallmentPaymentLocally(ownerId, uuid(102));
    expect(await balance(savings)).toBe(70_000);
    expect((await offlineDb.installmentPlans.get([ownerId, planId]))?.lifecycle).toBe("active");
  });

  it("links an existing expense without creating another, and never links it twice", async () => {
    const now = new Date().toISOString();
    const existing = uuid(500);
    await offlineDb.transactions.add({ ownerId, id: existing, user_id: ownerId, account_id: hdfc, category_id: categoryId, type: "expense", amount: 5_000, description: "EMI paid", transaction_date: "2026-01-04", transaction_time: null, created_at: now, updated_at: now });
    await saveInstallmentPaymentLocally(ownerId, pay(1, { accountId: hdfc, transactionOrigin: "linked", transactionId: existing }));
    expect(await offlineDb.transactions.count()).toBe(1);
    expect(await balance(hdfc)).toBe(95_000);
    await expect(saveInstallmentPaymentLocally(ownerId, pay(2, { accountId: hdfc, transactionOrigin: "linked", transactionId: existing }))).rejects.toThrow("another installment payment");
    const fromHdfc = uuid(501);
    await offlineDb.transactions.add({ ownerId, id: fromHdfc, user_id: ownerId, account_id: hdfc, category_id: categoryId, type: "expense", amount: 5_000, description: null, transaction_date: "2026-02-04", transaction_time: null, created_at: now, updated_at: now });
    await expect(saveInstallmentPaymentLocally(ownerId, pay(2, { accountId: savings, transactionOrigin: "linked", transactionId: fromHdfc }))).rejects.toThrow("different account");
    // Undo of a linked payment keeps the user's transaction.
    await deleteInstallmentPaymentLocally(ownerId, uuid(101));
    expect(await offlineDb.transactions.get([ownerId, existing])).toBeDefined();
  });

  it("rejects linking an unsynced transaction or a mismatched amount", async () => {
    const now = new Date().toISOString();
    const other = uuid(600);
    await offlineDb.transactions.add({ ownerId, id: other, user_id: ownerId, account_id: savings, category_id: categoryId, type: "expense", amount: 4_000, description: null, transaction_date: "2026-01-04", transaction_time: null, created_at: now, updated_at: now });
    await expect(saveInstallmentPaymentLocally(ownerId, pay(1, { transactionOrigin: "linked", transactionId: other }))).rejects.toThrow("must match");
  });

  it("records an early closure for the remaining installments", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    await saveInstallmentPaymentLocally(ownerId, pay(2, { kind: "closure", coversThrough: 12, actualAmount: 52_000, transactionId: uuid(700) }));
    const closure = await offlineDb.installmentPayments.get([ownerId, uuid(102)]);
    expect(closure).toMatchObject({ kind: "closure", covers_through: 12, expected_amount: 55_000 });
    expect((await offlineDb.transactions.get([ownerId, uuid(700)]))?.description).toBe("iPhone EMI – Early closure 2–12/12");
    expect((await offlineDb.installmentPlans.get([ownerId, planId]))?.lifecycle).toBe("completed");
    await expect(saveInstallmentPaymentLocally(ownerId, cash(5))).rejects.toThrow("early closure");
  });

  it("created expense → Manual → Linked Account keeps exactly one expense at each step", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    await saveInstallmentPaymentLocally(ownerId, cash(1, { paymentMethod: "manual" }));
    expect(await offlineDb.transactions.count()).toBe(0);
    expect(await balance(savings)).toBe(100_000);
    await saveInstallmentPaymentLocally(ownerId, pay(1, { accountId: hdfc, transactionId: uuid(301) }));
    expect(await offlineDb.transactions.count()).toBe(1);
    expect(await balance(hdfc)).toBe(95_000);
    expect(await balance(savings)).toBe(100_000);
  });

  it("created expense → existing linked transaction deletes only the created one", async () => {
    const now = new Date().toISOString();
    const userRecorded = uuid(800);
    await offlineDb.transactions.add({ ownerId, id: userRecorded, user_id: ownerId, account_id: savings, category_id: categoryId, type: "expense", amount: 5_000, description: "Paid EMI", transaction_date: "2026-01-05", transaction_time: null, created_at: now, updated_at: now });
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    expect(await balance(savings)).toBe(90_000); // the user's own entry plus the created expense
    await saveInstallmentPaymentLocally(ownerId, pay(1, { transactionOrigin: "linked", transactionId: userRecorded }));
    expect(await offlineDb.transactions.get([ownerId, uuid(201)])).toBeUndefined();
    expect(await offlineDb.transactions.get([ownerId, userRecorded])).toBeDefined();
    expect(await balance(savings)).toBe(95_000);
  });

  it("linked transaction → another account's new expense and → Cash never delete the linked transaction", async () => {
    const now = new Date().toISOString();
    const userRecorded = uuid(801);
    await offlineDb.transactions.add({ ownerId, id: userRecorded, user_id: ownerId, account_id: savings, category_id: categoryId, type: "expense", amount: 5_000, description: "Paid EMI", transaction_date: "2026-01-05", transaction_time: null, created_at: now, updated_at: now });
    await saveInstallmentPaymentLocally(ownerId, pay(1, { transactionOrigin: "linked", transactionId: userRecorded }));
    await saveInstallmentPaymentLocally(ownerId, pay(1, { accountId: hdfc, transactionId: uuid(302) }));
    expect(await offlineDb.transactions.get([ownerId, userRecorded])).toBeDefined();
    expect(await balance(hdfc)).toBe(95_000);
    await saveInstallmentPaymentLocally(ownerId, cash(1));
    expect(await offlineDb.transactions.get([ownerId, uuid(302)])).toBeUndefined();
    expect(await offlineDb.transactions.get([ownerId, userRecorded])).toBeDefined();
    expect(await balance(hdfc)).toBe(100_000);
  });

  it("won't relabel the payment's own created expense as linked (that would delete it)", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    await expect(saveInstallmentPaymentLocally(ownerId, pay(1, { transactionOrigin: "linked" }))).rejects.toThrow("recorded by this payment");
    expect(await offlineDb.transactions.count()).toBe(1);
  });

  it("an early closure must start at the first unpaid installment and can't overlap paid ones", async () => {
    await saveInstallmentPaymentLocally(ownerId, cash(1));
    await expect(saveInstallmentPaymentLocally(ownerId, cash(3, { kind: "closure", coversThrough: 12 }))).rejects.toThrow("first unpaid installment (2)");
    await saveInstallmentPaymentLocally(ownerId, cash(5));
    await expect(saveInstallmentPaymentLocally(ownerId, cash(2, { kind: "closure", coversThrough: 12 }))).rejects.toThrow("already paid");
    await expect(saveInstallmentPaymentLocally(ownerId, cash(2, { kind: "closure", coversThrough: 11 }))).rejects.toThrow("every remaining");
    expect((await offlineDb.installmentPlans.get([ownerId, planId]))?.lifecycle).toBe("active");
  });

  it("closure expected amount is the remaining balance after actual payments", async () => {
    await saveInstallmentPaymentLocally(ownerId, cash(1, { actualAmount: 6_000 }));
    await saveInstallmentPaymentLocally(ownerId, cash(2, { kind: "closure", coversThrough: 12, actualAmount: 50_000 }));
    expect((await offlineDb.installmentPayments.get([ownerId, uuid(102)]))?.expected_amount).toBe(54_000);
    expect((await offlineDb.installmentPlans.get([ownerId, planId]))?.lifecycle).toBe("completed");
    await deleteInstallmentPaymentLocally(ownerId, uuid(102));
    expect((await offlineDb.installmentPlans.get([ownerId, planId]))?.lifecycle).toBe("active");
  });

  it("records late historical payments with their own payment date", async () => {
    await saveInstallmentPaymentLocally(ownerId, cash(1, { paymentDate: "2026-02-20" }));
    expect((await offlineDb.installmentPayments.get([ownerId, uuid(101)]))).toMatchObject({ due_date: "2026-01-05", payment_date: "2026-02-20" });
  });

  it("deleting a plan keeps recorded expenses (balances unchanged) and its history goes", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    await deleteInstallmentPlanLocally(ownerId, planId);
    expect(await offlineDb.installmentPayments.count()).toBe(0);
    expect(await offlineDb.transactions.count()).toBe(1);
    expect(await balance(savings)).toBe(95_000);
  });

  it("plan edits can't drop paid installments", async () => {
    await saveInstallmentPaymentLocally(ownerId, cash(6));
    await expect(updateInstallmentPlanLocally(ownerId, { ...planInput, installmentCount: 5, defaultInstallmentAmount: 12_000 })).rejects.toThrow("at least 6");
  });
});

describe("generated expenses are read-only outside Installments (offline too)", () => {
  const input = (transactionId: string) => ({
    transactionId, type: "expense" as const, amount: 1, accountId: savings, categoryId, transactionDate: "2026-01-06", transactionTime: "", remark: "x",
  });

  it("the generated expense is a normal transaction row (shown in Transactions and balances)", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    const row = await offlineDb.transactions.get([ownerId, uuid(201)]);
    expect(row).toMatchObject({ account_id: savings, category_id: categoryId, type: "expense", amount: 5_000 });
    expect(await balance(savings)).toBe(95_000);
  });

  it("can't be edited or deleted from Transactions, and nothing is queued", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    const queued = await offlineDb.outbox.count();
    await expect(updateTransactionLocally(ownerId, input(uuid(201)))).rejects.toThrow("managed by Installments");
    await expect(deleteTransactionLocally(ownerId, uuid(201))).rejects.toThrow("managed by Installments");
    expect(await offlineDb.outbox.count()).toBe(queued);
    expect(await offlineDb.transactions.get([ownerId, uuid(201)])).toMatchObject({ amount: 5_000, account_id: savings });
    expect(await balance(savings)).toBe(95_000);
  });

  it("regular and manually linked transactions stay editable and deletable", async () => {
    const now = new Date().toISOString();
    for (const id of [uuid(900), uuid(901)]) {
      await offlineDb.transactions.add({ ownerId, id, user_id: ownerId, account_id: savings, category_id: categoryId, type: "expense", amount: 5_000, description: null, transaction_date: "2026-01-04", transaction_time: null, created_at: now, updated_at: now });
    }
    await saveInstallmentPaymentLocally(ownerId, pay(1, { transactionOrigin: "linked", transactionId: uuid(901) }));
    await updateTransactionLocally(ownerId, input(uuid(900)));
    await updateTransactionLocally(ownerId, { ...input(uuid(901)), amount: 5_000 });
    await deleteTransactionLocally(ownerId, uuid(900));
    expect(await offlineDb.transactions.get([ownerId, uuid(900)])).toBeUndefined();
    expect(await offlineDb.transactions.get([ownerId, uuid(901)])).toMatchObject({ description: "x", amount: 5_000 });
  });

  it("undoing a manually linked payment never modifies the original transaction", async () => {
    const now = new Date().toISOString();
    const original = { ownerId, id: uuid(902), user_id: ownerId, account_id: savings, category_id: categoryId, type: "expense", amount: 5_000, description: "Bank app EMI", transaction_date: "2026-01-04", transaction_time: "09:15:00", created_at: now, updated_at: now };
    await offlineDb.transactions.add(original);
    await saveInstallmentPaymentLocally(ownerId, pay(1, { transactionOrigin: "linked", transactionId: uuid(902) }));
    await deleteInstallmentPaymentLocally(ownerId, uuid(101));
    expect(await offlineDb.transactions.get([ownerId, uuid(902)])).toEqual(original);
    expect(await balance(savings)).toBe(95_000);
  });
});

describe("manually linked transactions follow edits made in Transactions (offline)", () => {
  const linkedId = uuid(960);
  const txInput = (overrides: Record<string, unknown> = {}) => ({
    transactionId: linkedId, type: "expense" as const, amount: 5_000, accountId: savings, categoryId,
    transactionDate: "2026-01-04", transactionTime: "", remark: "Bank app EMI", ...overrides,
  });

  beforeEach(async () => {
    const now = new Date().toISOString();
    await offlineDb.transactions.add({ ownerId, id: linkedId, user_id: ownerId, account_id: savings, category_id: categoryId, type: "expense", amount: 5_000, description: "Bank app EMI", transaction_date: "2026-01-04", transaction_time: null, created_at: now, updated_at: now });
    await saveInstallmentPaymentLocally(ownerId, pay(1, { transactionOrigin: "linked", transactionId: linkedId, notes: "via app" }));
  });

  it("a new link takes the transaction's date", async () => {
    expect(await offlineDb.installmentPayments.get([ownerId, uuid(101)])).toMatchObject({ payment_date: "2026-01-04", actual_amount: 5_000 });
  });

  it("amount, date and account edits update the payment, queueing only the transaction change", async () => {
    const queuedBefore = (await offlineDb.outbox.toArray()).filter((entry) => entry.entity === "installment_payment").length;
    await updateTransactionLocally(ownerId, txInput({ amount: 5_250, transactionDate: "2026-01-09", accountId: hdfc }));
    expect(await offlineDb.installmentPayments.get([ownerId, uuid(101)])).toMatchObject({
      actual_amount: 5_250, payment_date: "2026-01-09", account_id: hdfc, transaction_id: linkedId, transaction_origin: "linked", notes: "via app",
    });
    const outbox = await offlineDb.outbox.toArray();
    expect(outbox.filter((entry) => entry.entity === "installment_payment")).toHaveLength(queuedBefore);
    expect(outbox.filter((entry) => entry.entity === "transaction")).toHaveLength(1);
    expect([await balance(savings), await balance(hdfc)]).toEqual([100_000, 94_750]);
  });

  it("description-only edits leave the payment alone", async () => {
    const before = await offlineDb.installmentPayments.get([ownerId, uuid(101)]);
    await updateTransactionLocally(ownerId, txInput({ remark: "renamed" }));
    expect(await offlineDb.installmentPayments.get([ownerId, uuid(101)])).toEqual(before);
  });

  it("deleting it in Transactions clears only the references; amount and date stay", async () => {
    await updateTransactionLocally(ownerId, txInput({ amount: 5_100 }));
    await deleteTransactionLocally(ownerId, linkedId);
    expect(await offlineDb.installmentPayments.get([ownerId, uuid(101)])).toMatchObject({
      payment_method: "account", transaction_id: null, account_id: null, transaction_origin: "linked", actual_amount: 5_100, payment_date: "2026-01-04", notes: "via app",
    });
    expect(await balance(savings)).toBe(100_000);
  });

  it("re-saving the payment with stale values mirrors the edited transaction", async () => {
    await updateTransactionLocally(ownerId, txInput({ amount: 5_300, accountId: hdfc }));
    await saveInstallmentPaymentLocally(ownerId, pay(1, { transactionOrigin: "linked", transactionId: linkedId, notes: "edited" }));
    expect(await offlineDb.installmentPayments.get([ownerId, uuid(101)])).toMatchObject({ actual_amount: 5_300, account_id: hdfc, notes: "edited" });
    expect(await offlineDb.transactions.get([ownerId, linkedId])).toMatchObject({ amount: 5_300, account_id: hdfc });
  });

  it("unlinking (Manual, Cash, undo) never modifies the transaction", async () => {
    const before = await offlineDb.transactions.get([ownerId, linkedId]);
    await saveInstallmentPaymentLocally(ownerId, cash(1, { paymentMethod: "manual" }));
    expect(await offlineDb.transactions.get([ownerId, linkedId])).toEqual(before);
    await saveInstallmentPaymentLocally(ownerId, pay(1, { transactionOrigin: "linked", transactionId: linkedId }));
    await deleteInstallmentPaymentLocally(ownerId, uuid(101));
    expect(await offlineDb.transactions.get([ownerId, linkedId])).toEqual(before);
    expect(await balance(savings)).toBe(95_000);
  });

  it("a refreshed snapshot replays pending Transactions edits onto the linked payment", async () => {
    const serverPayment = (await offlineDb.installmentPayments.get([ownerId, uuid(101)]))!;
    const serverTx = (await offlineDb.transactions.get([ownerId, linkedId]))!;
    await offlineDb.outbox.clear(); // pretend the link already synced
    await updateTransactionLocally(ownerId, txInput({ amount: 5_400, accountId: hdfc, transactionDate: "2026-01-08" }));
    const snapshot = (): LocalSnapshotRows => ({ accounts: [], categories: [], transactions: [serverTx], budget: null, installmentPlans: [], installmentPayments: [serverPayment] });
    const edited = overlayOutbox(ownerId, snapshot(), snapshot(), await offlineDb.outbox.orderBy("seq").toArray());
    expect(edited.installmentPayments?.[0]).toMatchObject({ actual_amount: 5_400, account_id: hdfc, payment_date: "2026-01-08", transaction_id: linkedId });
    await deleteTransactionLocally(ownerId, linkedId);
    const deleted = overlayOutbox(ownerId, snapshot(), snapshot(), await offlineDb.outbox.orderBy("seq").toArray());
    expect(deleted.installmentPayments?.[0]).toMatchObject({ transaction_id: null, account_id: null });
    expect(deleted.transactions).toHaveLength(0);
  });
});

describe("overlay, queue order and replay protection", () => {
  const empty = (): LocalSnapshotRows => ({ accounts: [], categories: [], transactions: [], budget: null, installmentPlans: [], installmentPayments: [] });

  it("replays pending payments and their expense over a fresh snapshot (refresh while offline)", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    await saveInstallmentPaymentLocally(ownerId, cash(2));
    const outbox = await offlineDb.outbox.orderBy("seq").toArray();
    const overlaid = overlayOutbox(ownerId, empty(), empty(), outbox);
    expect(overlaid.installmentPlans).toHaveLength(1);
    expect(overlaid.installmentPayments).toHaveLength(2);
    expect(overlaid.transactions).toHaveLength(1);
    expect(overlaid.transactions[0]).toMatchObject({ id: uuid(201), amount: 5_000, account_id: savings });
    expect(overlaid.installmentPayments?.find((row) => row.installment_number === 1)).not.toHaveProperty("transaction_row");
  });

  it("an already-synced expense is not duplicated by the overlay and undo removes it", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    const server = empty();
    const stored = (await offlineDb.transactions.toArray())[0];
    server.transactions = [stored];
    const outbox = await offlineDb.outbox.orderBy("seq").toArray();
    expect(overlayOutbox(ownerId, server, empty(), outbox).transactions).toHaveLength(1);
    await deleteInstallmentPaymentLocally(ownerId, uuid(101));
    const afterUndo = overlayOutbox(ownerId, server, empty(), await offlineDb.outbox.orderBy("seq").toArray());
    expect(afterUndo.transactions).toHaveLength(0);
    expect(afterUndo.installmentPayments).toHaveLength(0);
  });

  it("payments wait for their plan and account; a pending payment blocks later ops on its expense", async () => {
    await saveInstallmentPaymentLocally(ownerId, pay(1));
    const [planOp, paymentOp] = await offlineDb.outbox.orderBy("seq").toArray();
    expect(dependsOn(paymentOp, planOp)).toBe(true);
    // Older clients could queue an edit of the generated expense; it still waits for the payment.
    const transactionOp = { seq: 99, entity: "transaction" as const, entityId: uuid(201), op: "UPDATE" as const, payload: {}, status: "pending" as const };
    expect(dependsOn(transactionOp, paymentOp)).toBe(true);
    const failed = { ...planOp, status: "failed" as const };
    expect(selectRunnableEntries([failed, paymentOp, transactionOp], Date.now(), 25)).toEqual([]);
    const account = { seq: 0, entity: "account" as const, entityId: savings, op: "CREATE" as const, payload: {}, status: "failed" as const };
    expect(dependsOn({ ...paymentOp, seq: 5 } as OutboxEntry, account)).toBe(true);
  });

  it("isolates users", async () => {
    const other = "99999999-9999-4999-8999-999999999999";
    await offlineDb.installmentPlans.add({ ...(await offlineDb.installmentPlans.get([ownerId, planId]))!, ownerId: other, user_id: other });
    await deleteInstallmentPlanLocally(ownerId, planId);
    expect(await offlineDb.installmentPlans.get([other, planId])).toBeDefined();
  });
});

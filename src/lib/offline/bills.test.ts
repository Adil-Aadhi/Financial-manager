import { beforeEach, describe, expect, it } from "vitest";
import { offlineDb } from "./db";
import { overlayOutbox, type LocalSnapshotRows } from "./snapshotOverlay";
import { selectRunnableEntries } from "./queuePolicy";
import {
  createBillLocally, createBillPaymentLocally, deleteBillLocally, deleteBillPaymentLocally,
  setBillLifecycleLocally, updateBillLocally, updateBillPaymentLocally,
} from "./mutations";

const ownerId = "11111111-1111-4111-8111-111111111111";
const billId = "22222222-2222-4222-8222-222222222222";
const paymentId = "33333333-3333-4333-8333-333333333333";
const input = { id: billId, name: "Electricity", category: "electricity" as const, icon: "zap" as const, amountType: "variable" as const, expectedAmount: 1100, currency: "INR", billingCycle: "monthly" as const, billingInterval: 1, startDate: "2026-10-18", nextDueDate: "2026-11-18", reminderDays: 3, notes: "Utility" };

beforeEach(async () => {
  await offlineDb.delete(); await offlineDb.open();
  await offlineDb.syncMeta.put({ ownerId, completedAt: new Date().toISOString(), budgetAvailable: true, dailyBudgetAvailable: true, subscriptionsAvailable: true, billsAvailable: true, server: { accounts: 0, transactions: 0, income: 0, expense: 0 }, local: { accounts: 0, transactions: 0, income: 0, expense: 0 }, totalsMatch: true });
});

describe("Bills offline isolation and history", () => {
  it("creates, edits and pauses without touching financial or subscription data", async () => {
    await createBillLocally(ownerId, input);
    await updateBillLocally(ownerId, { ...input, expectedAmount: 1200 });
    await setBillLifecycleLocally(ownerId, billId, "paused");
    expect(await offlineDb.bills.get([ownerId, billId])).toMatchObject({ expected_amount: 1200, lifecycle: "paused" });
    expect(await offlineDb.transactions.count()).toBe(0); expect(await offlineDb.accounts.count()).toBe(0);
    expect(await offlineDb.monthlyBudgets.count()).toBe(0); expect(await offlineDb.dailyBudgetExpenses.count()).toBe(0);
    expect(await offlineDb.subscriptions.count()).toBe(0); expect(await offlineDb.subscriptionPayments.count()).toBe(0);
  });

  it("records actual payment, advances current cycle, edits and undoes", async () => {
    await createBillLocally(ownerId, input);
    await createBillPaymentLocally(ownerId, { paymentId, billId, dueDate: "2026-11-18", actualAmount: 1180, paymentDate: "2026-11-20" });
    expect((await offlineDb.bills.get([ownerId, billId]))?.next_due_date).toBe("2026-12-18");
    expect(await offlineDb.billPayments.get([ownerId, paymentId])).toMatchObject({ expected_amount: 1100, actual_amount: 1180, payment_date: "2026-11-20" });
    await updateBillPaymentLocally(ownerId, { paymentId, billId, dueDate: "2026-11-18", actualAmount: 1175, paymentDate: "2026-11-19" });
    expect((await offlineDb.billPayments.get([ownerId, paymentId]))?.actual_amount).toBe(1175);
    await deleteBillPaymentLocally(ownerId, paymentId);
    expect((await offlineDb.bills.get([ownerId, billId]))?.next_due_date).toBe("2026-11-18");
  });

  it("records a past cycle without changing the current cycle and prevents duplicates", async () => {
    await createBillLocally(ownerId, input);
    await createBillPaymentLocally(ownerId, { paymentId, billId, dueDate: "2026-10-18", actualAmount: 1000, paymentDate: "2026-11-01" });
    expect((await offlineDb.bills.get([ownerId, billId]))?.next_due_date).toBe("2026-11-18");
    await expect(createBillPaymentLocally(ownerId, { paymentId: crypto.randomUUID(), billId, dueDate: "2026-10-18", actualAmount: 1000, paymentDate: "2026-11-01" })).rejects.toThrow("already paid");
  });

  it("deletes only the selected bill and its history", async () => {
    await createBillLocally(ownerId, input);
    await createBillPaymentLocally(ownerId, { paymentId, billId, dueDate: "2026-11-18", actualAmount: 1180, paymentDate: "2026-11-18" });
    await deleteBillLocally(ownerId, billId);
    expect(await offlineDb.bills.count()).toBe(0); expect(await offlineDb.billPayments.count()).toBe(0);
    expect(await offlineDb.transactions.count()).toBe(0); expect(await offlineDb.subscriptions.count()).toBe(0);
  });

  it("isolates users", async () => {
    const other = "99999999-9999-4999-8999-999999999999";
    await offlineDb.bills.add({ ownerId: other, id: billId, user_id: other, name: "Rent", category: "rent", icon: "house", amount_type: "fixed", expected_amount: 8000, currency: "INR", billing_cycle: "monthly", billing_interval: 1, billing_anchor_day: 1, start_date: "2026-11-01", next_due_date: "2026-12-01", reminder_days: 3, lifecycle: "active", notes: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    await createBillLocally(ownerId, input); await deleteBillLocally(ownerId, billId);
    expect((await offlineDb.bills.get([other, billId]))?.name).toBe("Rent");
  });
});

describe("Bills snapshot replay and queue ordering", () => {
  const row = { ownerId, id: billId, user_id: ownerId, name: "Electricity", category: "electricity" as const, icon: "zap" as const, amount_type: "variable" as const, expected_amount: 1100, currency: "INR", billing_cycle: "monthly" as const, billing_interval: 1, billing_anchor_day: 18, start_date: "2026-10-18", next_due_date: "2026-11-18", reminder_days: 3, lifecycle: "active" as const, notes: null, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z" };
  const snapshot = (bills = [row]): LocalSnapshotRows => ({ accounts: [], categories: [], transactions: [], budget: null, dailyLimits: [], dailyExpenses: [], subscriptions: [], subscriptionPayments: [], bills, billPayments: [] });

  it("replays a pending local bill edit over a downloaded snapshot", () => {
    const overlaid = overlayOutbox(ownerId, snapshot(), snapshot(), [{ opId: "op-1", ownerId, entity: "bill", entityId: billId, op: "UPDATE", payload: { expected_amount: 1250 }, baseUpdatedAt: row.updated_at, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", status: "pending", attempts: 0, error: null }]);
    expect(overlaid.bills?.[0].expected_amount).toBe(1250);
  });

  it("replays a pending payment and its next due date atomically", () => {
    const overlaid = overlayOutbox(ownerId, snapshot(), snapshot(), [{ opId: "op-2", ownerId, entity: "bill_payment", entityId: paymentId, op: "CREATE", payload: { bill_id: billId, due_date: "2026-11-18", expected_amount: 1100, actual_amount: 1180, payment_date: "2026-11-20", paid_at: "2026-11-20T00:00:00.000Z", status: "paid", created_at: "2026-11-20T00:00:00.000Z", updated_at: "2026-11-20T00:00:00.000Z", next_due_date: "2026-12-18" }, baseUpdatedAt: null, createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-20T00:00:00.000Z", status: "pending", attempts: 0, error: null }]);
    expect(overlaid.billPayments).toHaveLength(1);
    expect(overlaid.bills?.[0].next_due_date).toBe("2026-12-18");
  });

  it("keeps a bill payment behind its failed bill create while independent work continues", () => {
    const failed = { seq: 1, entity: "bill" as const, entityId: billId, op: "CREATE" as const, payload: {}, status: "failed" as const, attempts: 1 };
    const dependent = { seq: 2, entity: "bill_payment" as const, entityId: paymentId, op: "CREATE" as const, payload: { bill_id: billId }, status: "pending" as const, attempts: 0 };
    const independent = { seq: 3, entity: "bill" as const, entityId: crypto.randomUUID(), op: "UPDATE" as const, payload: {}, status: "pending" as const, attempts: 0 };
    expect(selectRunnableEntries([failed, dependent, independent], Date.now(), 25)).toEqual([independent]);
  });
});

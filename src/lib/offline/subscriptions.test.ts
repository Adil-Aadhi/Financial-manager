import { beforeEach, describe, expect, it } from "vitest";
import { offlineDb } from "./db";
import {
  createSubscriptionLocally,
  deleteSubscriptionLocally,
  markSubscriptionPaidLocally,
  setSubscriptionLifecycleLocally,
  undoSubscriptionPaymentLocally,
  updateSubscriptionLocally,
} from "./mutations";

const ownerId = "11111111-1111-4111-8111-111111111111";
const subscriptionId = "22222222-2222-4222-8222-222222222222";
const paymentId = "33333333-3333-4333-8333-333333333333";

const input = {
  id: subscriptionId,
  name: "Spotify",
  icon: "music-2" as const,
  amount: 119,
  currency: "INR",
  billingCycle: "monthly" as const,
  startDate: "2026-11-01",
  nextPaymentDate: "2026-11-11",
  notes: "Music",
};

beforeEach(async () => {
  await offlineDb.delete();
  await offlineDb.open();
  await offlineDb.syncMeta.put({
    ownerId,
    completedAt: new Date().toISOString(),
    budgetAvailable: true,
    dailyBudgetAvailable: true,
    subscriptionsAvailable: true,
    server: { accounts: 0, transactions: 0, income: 0, expense: 0 },
    local: { accounts: 0, transactions: 0, income: 0, expense: 0 },
    totalsMatch: true,
  });
});

describe("subscription offline mutations", () => {
  it("creates, edits and pauses without touching financial tables", async () => {
    await createSubscriptionLocally(ownerId, input);
    await updateSubscriptionLocally(ownerId, { ...input, amount: 129, notes: "Family" });
    await setSubscriptionLifecycleLocally(ownerId, subscriptionId, "paused");

    const row = await offlineDb.subscriptions.get([ownerId, subscriptionId]);
    expect(row).toMatchObject({ icon: "music-2", amount: 129, notes: "Family", lifecycle: "paused" });
    expect(await offlineDb.transactions.count()).toBe(0);
    expect(await offlineDb.accounts.count()).toBe(0);
    expect(await offlineDb.monthlyBudgets.count()).toBe(0);
    expect(await offlineDb.dailyBudgetExpenses.count()).toBe(0);
  });

  it("confirms one cycle idempotently and can undo the latest payment", async () => {
    await createSubscriptionLocally(ownerId, input);
    await markSubscriptionPaidLocally(ownerId, {
      paymentId,
      subscriptionId,
      dueDate: "2026-11-11",
      paidAt: "2026-11-08T10:00:00.000Z",
    });
    await markSubscriptionPaidLocally(ownerId, {
      paymentId,
      subscriptionId,
      dueDate: "2026-11-11",
      paidAt: "2026-11-08T10:00:00.000Z",
    });

    expect(await offlineDb.subscriptionPayments.count()).toBe(1);
    expect((await offlineDb.subscriptions.get([ownerId, subscriptionId]))?.next_payment_date).toBe("2026-12-11");

    await undoSubscriptionPaymentLocally(ownerId, { paymentId, subscriptionId, dueDate: "2026-11-11" });
    expect(await offlineDb.subscriptionPayments.count()).toBe(0);
    expect((await offlineDb.subscriptions.get([ownerId, subscriptionId]))?.next_payment_date).toBe("2026-11-11");
  });

  it("deletes only subscription data", async () => {
    await createSubscriptionLocally(ownerId, input);
    await deleteSubscriptionLocally(ownerId, subscriptionId);
    expect(await offlineDb.subscriptions.count()).toBe(0);
    expect(await offlineDb.transactions.count()).toBe(0);
    expect(await offlineDb.accounts.count()).toBe(0);
  });

  it("keeps owners isolated", async () => {
    const otherOwner = "99999999-9999-4999-8999-999999999999";
    await offlineDb.subscriptions.add({
      ownerId: otherOwner,
      id: subscriptionId,
      user_id: otherOwner,
      name: "Other",
      icon: "repeat-2",
      amount: 1,
      currency: "INR",
      billing_cycle: "monthly",
      billing_anchor_day: 1,
      start_date: "2026-11-01",
      next_payment_date: "2026-12-01",
      lifecycle: "active",
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await createSubscriptionLocally(ownerId, input);
    await deleteSubscriptionLocally(ownerId, subscriptionId);
    expect((await offlineDb.subscriptions.get([otherOwner, subscriptionId]))?.name).toBe("Other");
  });
});

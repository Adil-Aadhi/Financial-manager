import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBSCRIPTION_ICON,
  addBillingCycle,
  cycleProgress,
  daysRemaining,
  monthlyEquivalent,
  validateSubscriptionInput,
  subscriptionStatus,
  type SubscriptionIconName,
  type SubscriptionInput,
  type SubscriptionRecord,
} from "./subscriptions";

const subscription = (overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
  id: "00000000-0000-4000-8000-000000000001",
  user_id: "00000000-0000-4000-8000-000000000002",
  name: "Service",
  icon: "repeat-2",
  amount: 120,
  currency: "INR",
  billing_cycle: "monthly",
  billing_anchor_day: 11,
  start_date: "2026-10-11",
  next_payment_date: "2026-11-11",
  lifecycle: "active",
  notes: null,
  created_at: "2026-10-11T00:00:00.000Z",
  updated_at: "2026-10-11T00:00:00.000Z",
  ...overrides,
});

describe("subscription calculations", () => {
  it("requires a supported user-selected icon", () => {
    const input: SubscriptionInput = {
      name: "Service",
      icon: DEFAULT_SUBSCRIPTION_ICON,
      amount: 99,
      currency: "INR",
      billingCycle: "monthly" as const,
      nextPaymentDate: "2026-11-11",
      notes: "",
    };
    expect(validateSubscriptionInput(input)).toBeNull();
    expect(validateSubscriptionInput({ ...input, icon: "unknown" as SubscriptionIconName })).toBe("Choose a valid subscription icon.");
  });

  it("calculates countdown and bounded cycle progress", () => {
    const item = subscription();
    expect(daysRemaining(item, "2026-11-08")).toBe(3);
    expect(cycleProgress(item, "2026-11-08")).toBe(90);
    expect(cycleProgress(item, "2026-12-01")).toBe(100);
  });

  it("derives upcoming, pending, overdue and paused status", () => {
    expect(subscriptionStatus(subscription(), "2026-11-08")).toBe("upcoming");
    expect(subscriptionStatus(subscription(), "2026-11-11")).toBe("pending");
    expect(subscriptionStatus(subscription(), "2026-11-12")).toBe("overdue");
    expect(subscriptionStatus(subscription({ lifecycle: "paused" }), "2026-11-12")).toBe("paused");
  });

  it("supports every billing interval", () => {
    expect(addBillingCycle("2026-11-08", "weekly")).toBe("2026-11-15");
    expect(addBillingCycle("2026-11-08", "monthly")).toBe("2026-12-08");
    expect(addBillingCycle("2026-11-08", "quarterly")).toBe("2027-02-08");
    expect(addBillingCycle("2026-11-08", "half-yearly")).toBe("2027-05-08");
    expect(addBillingCycle("2026-11-08", "yearly")).toBe("2027-11-08");
  });

  it("preserves month-end anchors and leap years", () => {
    expect(addBillingCycle("2027-01-31", "monthly", 31)).toBe("2027-02-28");
    expect(addBillingCycle("2028-01-31", "monthly", 31)).toBe("2028-02-29");
    expect(addBillingCycle("2028-02-29", "monthly", 31)).toBe("2028-03-31");
  });

  it("normalizes informational monthly cost", () => {
    expect(monthlyEquivalent(120, "monthly")).toBe(120);
    expect(monthlyEquivalent(120, "quarterly")).toBe(40);
    expect(monthlyEquivalent(1200, "yearly")).toBe(100);
  });
});

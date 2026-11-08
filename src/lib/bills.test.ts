import { describe, expect, it } from "vitest";
import {
  addBillCycle, billMonthlyEstimate, billPaymentsForMonth, billProgress, billStatus, billToday,
  previousBillCycle, validateBillInput, validateBillPayment, type BillInput, type BillRecord,
} from "./bills";

const bill = (overrides: Partial<BillRecord> = {}): BillRecord => ({
  id: "11111111-1111-4111-8111-111111111111", user_id: "22222222-2222-4222-8222-222222222222",
  name: "Wi-Fi", category: "internet", icon: "wifi", amount_type: "fixed", expected_amount: 799,
  currency: "INR", billing_cycle: "monthly", billing_interval: 1, billing_anchor_day: 31,
  start_date: "2026-01-31", next_due_date: "2026-02-28", reminder_days: 3, lifecycle: "active",
  notes: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", ...overrides,
});

describe("Bills recurrence and status", () => {
  it("handles month ends, February, leap years and year boundaries", () => {
    expect(addBillCycle("2026-01-31", "monthly", 1, 31)).toBe("2026-02-28");
    expect(addBillCycle("2028-01-31", "monthly", 1, 31)).toBe("2028-02-29");
    expect(addBillCycle("2026-11-30", "quarterly", 1, 30)).toBe("2027-02-28");
    expect(addBillCycle("2026-12-31", "yearly", 1, 31)).toBe("2027-12-31");
    expect(previousBillCycle("2026-03-31", "monthly", 1, 31)).toBe("2026-02-28");
  });

  it("supports weekly and custom day/month intervals", () => {
    expect(addBillCycle("2026-11-08", "weekly")).toBe("2026-11-15");
    expect(addBillCycle("2026-11-08", "custom_days", 45)).toBe("2026-12-23");
    expect(addBillCycle("2026-11-30", "custom_months", 2, 30)).toBe("2027-01-30");
  });

  it("derives upcoming, pending, overdue, paused and cancelled", () => {
    expect(billStatus(bill({ next_due_date: "2026-11-09" }), "2026-11-08")).toBe("upcoming");
    expect(billStatus(bill({ next_due_date: "2026-11-08" }), "2026-11-08")).toBe("pending");
    expect(billStatus(bill({ next_due_date: "2026-11-07" }), "2026-11-08")).toBe("overdue");
    expect(billStatus(bill({ lifecycle: "paused" }), "2026-11-08")).toBe("paused");
    expect(billStatus(bill({ lifecycle: "cancelled" }), "2026-11-08")).toBe("cancelled");
  });

  it("keeps progress within zero and one hundred", () => {
    expect(billProgress(bill(), "2025-01-01")).toBe(0);
    expect(billProgress(bill(), "2027-01-01")).toBe(100);
  });

  it("calculates monthly estimates and excludes missing variable estimates", () => {
    expect(billMonthlyEstimate(bill())).toBe(799);
    expect(billMonthlyEstimate(bill({ billing_cycle: "yearly", expected_amount: 1200 }))).toBe(100);
    expect(billMonthlyEstimate(bill({ billing_cycle: "weekly", expected_amount: 120 }))).toBe(520);
    expect(billMonthlyEstimate(bill({ billing_cycle: "custom_days", billing_interval: 15, expected_amount: 300 }))).toBeCloseTo(608.33, 2);
    expect(billMonthlyEstimate(bill({ amount_type: "variable", expected_amount: null }))).toBe(0);
  });

  it("uses Asia/Kolkata for today's date", () => {
    expect(billToday(new Date("2026-11-07T19:00:00.000Z"))).toBe("2026-11-08");
  });

  it("keeps a late payment in its original billing-cycle month", () => {
    const payment = { id: "p", user_id: "u", bill_id: "b", due_date: "2026-11-18", expected_amount: 1100, actual_amount: 1180, payment_date: "2026-12-02", paid_at: "2026-12-02T00:00:00.000Z", status: "paid" as const, created_at: "2026-12-02T00:00:00.000Z" };
    expect(billPaymentsForMonth([payment], "2026-11")).toEqual([payment]);
    expect(billPaymentsForMonth([payment], "2026-12")).toEqual([]);
  });
});

describe("Bills validation", () => {
  const input: BillInput = { name: "Electricity", category: "electricity", icon: "zap", amountType: "variable", expectedAmount: null, currency: "INR", billingCycle: "monthly", billingInterval: 1, startDate: "2026-11-01", nextDueDate: "2026-11-18", reminderDays: 3, notes: "" };
  it("accepts variable bills without estimates and requires fixed estimates", () => {
    expect(validateBillInput(input)).toBeNull();
    expect(validateBillInput({ ...input, amountType: "fixed" })).toBe("A fixed bill needs an expected amount.");
  });
  it("validates custom intervals, money and reminders", () => {
    expect(validateBillInput({ ...input, billingCycle: "custom_days", billingInterval: 15 })).toBeNull();
    expect(validateBillInput({ ...input, billingCycle: "custom_months", billingInterval: 121 })).toContain("120");
    expect(validateBillInput({ ...input, expectedAmount: 1.111 })).toContain("two decimal");
    expect(validateBillInput({ ...input, reminderDays: 366 })).toContain("365");
  });
  it("validates actual paid amounts separately", () => {
    expect(validateBillPayment(1180, "2026-12-02", "2026-11-18")).toBeNull();
    expect(validateBillPayment(0, "2026-12-02", "2026-11-18")).toContain("valid amount");
  });
});

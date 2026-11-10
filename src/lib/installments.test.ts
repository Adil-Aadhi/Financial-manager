import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  closureExpectedCents,
  computeFinancials,
  coverageError,
  coveredInstallmentCount,
  isPlanSettled,
  expectedInstallmentAmount,
  installmentProgress,
  installmentDueDate,
  installmentTransactionDescription,
  settledLifecycle,
  suggestInstallmentAmount,
  summarizePlan,
  upcomingInstallments,
  validatePaymentFields,
  validatePlanAgainstPayments,
  validatePlanInput,
  type InstallmentPaymentRecord,
  type InstallmentPlanInput,
  type InstallmentPlanRecord,
} from "./installments";

const baseInput: InstallmentPlanInput = {
  name: "iPhone EMI",
  description: "",
  planType: "product_emi",
  provider: "Bank EMI",
  productCategory: "mobile",
  icon: "smartphone",
  originalAmount: 80_000,
  downPayment: 20_000,
  interestAmount: 5_000,
  additionalFees: 1_000,
  currency: "INR",
  installmentCount: 12,
  defaultInstallmentAmount: 5_500,
  billingCycle: "monthly",
  billingInterval: 1,
  startDate: "2026-01-01",
  firstDueDate: "2026-01-05",
  reminderDays: 3,
  notes: "",
};

function plan(overrides: Partial<InstallmentPlanRecord> = {}): InstallmentPlanRecord {
  return {
    id: "plan-1",
    user_id: "user",
    name: "iPhone EMI",
    description: null,
    plan_type: "product_emi",
    provider: "Bank EMI",
    product_category: "mobile",
    icon: "smartphone",
    original_amount: 60_000,
    down_payment: 0,
    financed_amount: 60_000,
    interest_amount: 0,
    additional_fees: 0,
    total_repayment_amount: 60_000,
    currency: "INR",
    installment_count: 12,
    default_installment_amount: 5_000,
    billing_cycle: "monthly",
    billing_interval: 1,
    start_date: "2026-01-01",
    first_due_date: "2026-01-05",
    reminder_days: 3,
    lifecycle: "active",
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function payment(number: number, overrides: Partial<InstallmentPaymentRecord> = {}): InstallmentPaymentRecord {
  return {
    id: `pay-${number}`,
    user_id: "user",
    installment_plan_id: "plan-1",
    installment_number: number,
    kind: "installment",
    covers_through: number,
    due_date: "2026-01-05",
    expected_amount: 5_000,
    actual_amount: 5_000,
    payment_date: "2026-01-05",
    payment_method: "cash",
    account_id: null,
    transaction_id: null,
    transaction_origin: null,
    notes: null,
    paid_at: "2026-01-05T00:00:00.000Z",
    created_at: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("financials", () => {
  it("does not assume the purchase price is the financed amount (down payment, interest, fees)", () => {
    const result = computeFinancials(baseInput);
    expect(result.financedCents).toBe(6_000_000);
    expect(result.totalCents).toBe(6_600_000);
    expect(suggestInstallmentAmount(66_000, 12)).toBe(5_500);
    expect(result.finalCents).toBe(550_000);
  });

  it("lets the final installment settle rounding so the schedule adds up exactly", () => {
    const p = plan({ total_repayment_amount: 1_000, financed_amount: 1_000, original_amount: 1_000, installment_count: 3, default_installment_amount: suggestInstallmentAmount(1_000, 3) });
    expect([1, 2, 3].map((n) => expectedInstallmentAmount(p, n))).toEqual([333.33, 333.33, 333.34]);
    const odd = plan({ total_repayment_amount: 10_000.01, installment_count: 7, default_installment_amount: suggestInstallmentAmount(10_000.01, 7) });
    const sum = Array.from({ length: 7 }, (_, i) => Math.round(expectedInstallmentAmount(odd, i + 1) * 100)).reduce((a, b) => a + b, 0);
    expect(sum).toBe(1_000_001);
  });

  it("supports a manual installment amount with a smaller final installment", () => {
    const p = plan({ total_repayment_amount: 66_000, installment_count: 12, default_installment_amount: 5_800 });
    expect(expectedInstallmentAmount(p, 1)).toBe(5_800);
    expect(expectedInstallmentAmount(p, 12)).toBe(2_200);
  });

  it("validates Product EMI, BNPL and Custom plans and rejects impossible amounts", () => {
    expect(validatePlanInput(baseInput)).toBeNull();
    expect(validatePlanInput({ ...baseInput, planType: "bnpl", provider: "Flipkart Pay in 3", downPayment: 0, interestAmount: 0, additionalFees: 0, originalAmount: 3_000, installmentCount: 3, defaultInstallmentAmount: 1_000 })).toBeNull();
    expect(validatePlanInput({ ...baseInput, planType: "custom", provider: "Friend loan", billingCycle: "custom_days", billingInterval: 15 })).toBeNull();
    expect(validatePlanInput({ ...baseInput, downPayment: 80_000 })).toMatch(/Down payment/);
    expect(validatePlanInput({ ...baseInput, defaultInstallmentAmount: 6_000 })).toMatch(/last installment/);
    expect(validatePlanInput({ ...baseInput, defaultInstallmentAmount: 5_500.123 })).toMatch(/two decimal/);
    expect(validatePlanInput({ ...baseInput, provider: " " })).toMatch(/provider/);
    expect(validatePlanInput({ ...baseInput, firstDueDate: "2025-12-31" })).toMatch(/first due date/);
    expect(validatePlanInput({ ...baseInput, installmentCount: 1, defaultInstallmentAmount: 66_000 })).toBeNull();
  });
});

describe("due dates (India calendar date keys)", () => {
  it("keeps the anchor day across month ends, February and leap years", () => {
    const p = plan({ first_due_date: "2027-12-31" });
    expect([1, 2, 3, 4].map((n) => installmentDueDate(p, n))).toEqual(["2027-12-31", "2028-01-31", "2028-02-29", "2028-03-31"]);
    const nonLeap = plan({ first_due_date: "2026-01-31" });
    expect(installmentDueDate(nonLeap, 2)).toBe("2026-02-28");
    expect(installmentDueDate(nonLeap, 3)).toBe("2026-03-31");
    expect(installmentDueDate(plan({ first_due_date: "2026-01-30" }), 2)).toBe("2026-02-28");
  });

  it("crosses year boundaries for weekly, quarterly and custom schedules", () => {
    expect(installmentDueDate(plan({ first_due_date: "2026-12-29", billing_cycle: "weekly" }), 2)).toBe("2027-01-05");
    expect(installmentDueDate(plan({ first_due_date: "2026-11-30", billing_cycle: "quarterly" }), 2)).toBe("2027-02-28");
    expect(installmentDueDate(plan({ first_due_date: "2026-11-30", billing_cycle: "quarterly" }), 3)).toBe("2027-05-30");
    expect(installmentDueDate(plan({ first_due_date: "2026-12-20", billing_cycle: "custom_days", billing_interval: 15 }), 2)).toBe("2027-01-04");
    expect(installmentDueDate(plan({ first_due_date: "2026-08-31", billing_cycle: "custom_months", billing_interval: 6 }), 2)).toBe("2027-02-28");
  });
});

describe("schedule statuses", () => {
  it("marks paid only from confirmed payments, never because the due date passed", () => {
    const rows = buildSchedule(plan(), [payment(1), payment(2)], "2026-03-04");
    expect(rows.map((row) => row.status).slice(0, 5)).toEqual(["paid", "paid", "pending", "upcoming", "upcoming"]);
    const late = buildSchedule(plan(), [payment(1)], "2026-03-10");
    expect(late[1].status).toBe("overdue");
    expect(late[2].status).toBe("overdue");
  });

  it("summarises remaining balance from actual paid amounts and closes early", () => {
    const p = plan();
    const summary = summarizePlan(p, [payment(1, { actual_amount: 5_200 }), payment(2)], "2026-02-10");
    expect(summary.paidCents).toBe(1_020_000);
    expect(summary.remainingCents).toBe(4_980_000);
    expect(summary.nextRow?.number).toBe(3);
    const closure = payment(3, { id: "close", kind: "closure", covers_through: 12, actual_amount: 48_000 });
    const closed = summarizePlan({ ...p, lifecycle: "completed" }, [payment(1), payment(2), closure], "2026-02-10");
    expect(closed.rows.slice(2).every((row) => row.status === "closed")).toBe(true);
    expect(closed.rows[2].payment?.id).toBe("close");
    expect(closed.remainingCents).toBe(0);
    expect(closed.nextRow).toBeNull();
  });

  it("completes only when settled and reopens after undo, keeping paused/cancelled", () => {
    const all = Array.from({ length: 12 }, (_, i) => payment(i + 1));
    expect(settledLifecycle("active", 12, all)).toBe("completed");
    expect(settledLifecycle("completed", 12, all.slice(1))).toBe("active");
    expect(settledLifecycle("paused", 12, all)).toBe("paused");
    // A closure record alone is not settlement: installments 1–4 are still unpaid here.
    expect(settledLifecycle("active", 12, [payment(5, { kind: "closure", covers_through: 12 })])).toBe("active");
    expect(settledLifecycle("active", 12, [...all.slice(0, 4), payment(5, { kind: "closure", covers_through: 12 })])).toBe("completed");
    expect(validatePlanAgainstPayments(4, [payment(6)])).toMatch(/at least 6/);
  });

  it("excludes paused, cancelled and completed plans and paid installments from upcoming", () => {
    const plans = [
      plan(),
      plan({ id: "paused", lifecycle: "paused" }),
      plan({ id: "cancelled", lifecycle: "cancelled" }),
      plan({ id: "done", lifecycle: "completed" }),
    ];
    const upcoming = upcomingInstallments(plans, [payment(1)], "2026-01-20");
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].row.number).toBe(2);
    expect(upcoming[0].progressLabel).toBe("1/12");
  });
});

describe("early closure and coverage", () => {
  const closure = (n: number) => ({ installmentNumber: n, kind: "closure" as const, coversThrough: 12 });

  it("must start at the first unpaid installment and run to the last one", () => {
    expect(coverageError(closure(3), 12, [payment(1), payment(2)])).toBeNull();
    expect(coverageError(closure(4), 12, [payment(1), payment(2)])).toMatch(/first unpaid installment \(3\)/);
    expect(coverageError({ ...closure(3), coversThrough: 11 }, 12, [payment(1), payment(2)])).toMatch(/every remaining/);
  });

  it("rejects overlap with any paid installment or another closure", () => {
    expect(coverageError(closure(3), 12, [payment(1), payment(2), payment(7)])).toMatch(/already paid/);
    const existing = payment(3, { kind: "closure", covers_through: 12 });
    expect(coverageError({ installmentNumber: 8, kind: "installment", coversThrough: 8 }, 12, [existing])).toMatch(/early closure/);
    expect(coverageError({ installmentNumber: 2, kind: "installment", coversThrough: 2 }, 12, [payment(2)])).toMatch(/already has a payment/);
  });

  it("expects the remaining payable amount from actual payment history", () => {
    const p = plan();
    expect(closureExpectedCents(p, [payment(1, { actual_amount: 5_200 }), payment(2)])).toBe(4_980_000);
  });

  it("counts settled installments by coverage, not by the number of records", () => {
    expect(coveredInstallmentCount(12, [payment(1), payment(3, { kind: "closure", covers_through: 12 })])).toBe(11);
    expect(isPlanSettled(12, [payment(1), payment(3, { kind: "closure", covers_through: 12 })])).toBe(false);
  });
});

describe("payments", () => {
  it("builds the transaction description", () => {
    expect(installmentTransactionDescription("iPhone EMI", 1, 12)).toBe("iPhone EMI – Installment 1/12");
    expect(installmentTransactionDescription("Amazon Pay Later", 2, 3)).toBe("Amazon Pay Later – Installment 2/3");
    expect(installmentTransactionDescription("Laptop EMI", 5, 12, "closure", 12)).toBe("Laptop EMI – Early closure 5–12/12");
  });

  it("requires an account only for Linked Account payments", () => {
    const base = { installmentNumber: 1, kind: "installment" as const, coversThrough: 1, actualAmount: 5_000, paymentDate: "2026-01-05", notes: "" };
    expect(validatePaymentFields({ ...base, paymentMethod: "cash", accountId: null, transactionOrigin: null, transactionId: null }, 12)).toBeNull();
    expect(validatePaymentFields({ ...base, paymentMethod: "manual", accountId: null, transactionOrigin: null, transactionId: null }, 12)).toBeNull();
    expect(validatePaymentFields({ ...base, paymentMethod: "account", accountId: null, transactionOrigin: "created", transactionId: "t" }, 12)).toMatch(/account/);
    expect(validatePaymentFields({ ...base, paymentMethod: "cash", accountId: "a", transactionOrigin: null, transactionId: null }, 12)).toMatch(/cannot use an account/);
    expect(validatePaymentFields({ ...base, paymentMethod: "account", accountId: "a", transactionOrigin: "created", transactionId: "t" }, 12)).toBeNull();
    expect(validatePaymentFields({ ...base, installmentNumber: 13, coversThrough: 13, paymentMethod: "cash", accountId: null, transactionOrigin: null, transactionId: null }, 12)).toMatch(/not part/);
  });
});

describe("installmentProgress", () => {
  it("calculates progress for the first installment from plan start_date", () => {
    const p = plan({ start_date: "2026-01-01", first_due_date: "2026-01-21" });
    const row = { number: 1, dueDate: "2026-01-21", status: "upcoming" as const };
    // 20 days total; on Jan 11, 10 days elapsed -> 50%
    expect(installmentProgress(p, row, "2026-01-11")).toBe(50);
    // On start date -> 0%
    expect(installmentProgress(p, row, "2026-01-01")).toBe(0);
    // Before start date -> 0%
    expect(installmentProgress(p, row, "2025-12-31")).toBe(0);
    // On due date -> 100%
    expect(installmentProgress(p, row, "2026-01-21")).toBe(100);
    // Overdue -> 100%
    expect(installmentProgress(p, row, "2026-01-25")).toBe(100);
  });

  it("calculates progress for subsequent installments from previous installment due date", () => {
    const p = plan({ start_date: "2026-01-01", first_due_date: "2026-01-05", billing_cycle: "monthly" });
    // Installment 2: previous due date is 2026-01-05, next due date is 2026-02-05 (31 days)
    const row = { number: 2, dueDate: "2026-02-05", status: "upcoming" as const };
    expect(installmentProgress(p, row, "2026-01-05")).toBe(0);
    // 16 days in (Jan 21): 16 / 31 = 52%
    expect(installmentProgress(p, row, "2026-01-21")).toBe(52);
    expect(installmentProgress(p, row, "2026-02-05")).toBe(100);
  });

  it("returns 100% for paid or closed installments", () => {
    const p = plan();
    const paidRow = { number: 1, dueDate: "2026-01-05", status: "paid" as const };
    const closedRow = { number: 2, dueDate: "2026-02-05", status: "closed" as const };
    expect(installmentProgress(p, paidRow, "2026-01-01")).toBe(100);
    expect(installmentProgress(p, closedRow, "2026-01-01")).toBe(100);
  });

  it("includes progress in upcomingInstallments", () => {
    const p = plan({ start_date: "2026-01-01", first_due_date: "2026-01-21" });
    const upcoming = upcomingInstallments([p], [], "2026-01-11");
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].progress).toBe(50);
  });
});

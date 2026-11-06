import { describe, expect, it } from "vitest";
import {
  addMonths,
  calculateDailyBudgetMonth,
  calculateDailyBudgetToday,
  dailyBudgetMonths,
  dailyBudgetToday,
  groupExpensesByDate,
  limitOn,
  monthLastDay,
  validateDailyExpenseInput,
  validateDailyLimitInput,
  type DailyExpenseRecord,
  type DailyLimitRecord,
} from "@/lib/dailyBudget";

let nextId = 0;
function expense(expense_date: string, amount: number, description = "Spent"): DailyExpenseRecord {
  nextId += 1;
  return { id: `e${nextId}`, expense_date, amount, description, created_at: `2026-01-01T00:00:${String(nextId % 60).padStart(2, "0")}Z` };
}

const limit300: DailyLimitRecord[] = [{ effective_date: "2026-11-01", amount: 300 }];
const closingOn = (month: ReturnType<typeof calculateDailyBudgetMonth>, date: string) =>
  month.days.find((day) => day.date === date)?.closing;

describe("daily budget calculation", () => {
  it("matches the specification example (Nov 1-4 at 300/day)", () => {
    const expenses = [expense("2026-11-01", 200), expense("2026-11-02", 450), expense("2026-11-03", 100), expense("2026-11-04", 400)];
    const month = calculateDailyBudgetMonth(limit300, expenses, "2026-11", "2026-11-04");
    expect(month.days.map((day) => day.closing)).toEqual([100, -50, 150, 50]);
    expect(month.days.map((day) => day.opening)).toEqual([0, 100, -50, 150]);
    expect(month.totals).toMatchObject({ allowance: 1200, expenses: 1150, closing: 50, saved: 50, overspent: 0, daysOver: 2 });
  });

  it("starts with the first day's allowance when nothing is spent", () => {
    const today = calculateDailyBudgetToday(limit300, [], "2026-11-01");
    expect(today).toMatchObject({ started: true, allowance: 300, expenses: 0, carried: 0, available: 300 });
  });

  it("accrues one allowance per calendar day, including days the app was not opened", () => {
    const month = calculateDailyBudgetMonth(limit300, [], "2026-11", "2026-11-10");
    expect(month.days).toHaveLength(10);
    expect(month.totals.allowance).toBe(3000);
    expect(calculateDailyBudgetToday(limit300, [], "2026-11-10")).toMatchObject({ carried: 2700, available: 3000 });
  });

  it("carries positive and negative balances forward", () => {
    const positive = calculateDailyBudgetToday(limit300, [expense("2026-11-01", 100)], "2026-11-02");
    expect(positive).toMatchObject({ carried: 200, allowance: 300, available: 500 });
    const negative = calculateDailyBudgetToday(limit300, [expense("2026-11-01", 500)], "2026-11-02");
    expect(negative).toMatchObject({ carried: -200, available: 100 });
  });

  it("sums several expenses on the same day", () => {
    const expenses = [expense("2026-11-03", 120.5), expense("2026-11-03", 79.5), expense("2026-11-03", 0.1), expense("2026-11-03", 0.2)];
    const today = calculateDailyBudgetToday(limit300, expenses, "2026-11-03");
    expect(today.expenses).toBe(200.3);
    expect(today.available).toBe(699.7); // no 0.1 + 0.2 float drift
  });

  it("starts every month at zero and keeps the previous month's closing balance", () => {
    const expenses = [expense("2026-11-30", 9500)]; // November: 9000 - 9500 = -500
    const november = calculateDailyBudgetMonth(limit300, expenses, "2026-11", "2026-12-02");
    expect(november.totals.closing).toBe(-500);
    expect(november.closed).toBe(true);
    const december = calculateDailyBudgetMonth(limit300, expenses, "2026-12", "2026-12-02");
    expect(december.days[0]).toMatchObject({ date: "2026-12-01", opening: 0, closing: 300 });
    expect(calculateDailyBudgetToday(limit300, expenses, "2026-12-01").carried).toBe(0);
  });

  it("recalculates the affected day and every later day of a previous month", () => {
    const base = [expense("2026-11-29", 8000)];
    const before = calculateDailyBudgetMonth(limit300, base, "2026-11", "2026-12-10");
    expect(before.totals.closing).toBe(1000);
    // On Dec 10 the user records a forgotten Nov 5 expense.
    const late = [...base, expense("2026-11-05", 250)];
    const after = calculateDailyBudgetMonth(limit300, late, "2026-11", "2026-12-10");
    expect(closingOn(after, "2026-11-04")).toBe(closingOn(before, "2026-11-04"));
    for (const day of after.days.filter((entry) => entry.date >= "2026-11-05")) {
      expect(day.closing).toBe(closingOn(before, day.date)! - 250);
    }
    expect(after.totals.closing).toBe(750);
  });

  it("adds, edits and deletes a late entry without ever changing the next month", () => {
    // The specification example: November closes at +300, December at +100.
    const limits: DailyLimitRecord[] = [{ effective_date: "2026-11-01", amount: 100 }];
    const base = [expense("2026-11-15", 2700), expense("2026-12-02", 100)];
    const today = "2026-12-02";
    const nov = (list: DailyExpenseRecord[]) => calculateDailyBudgetMonth(limits, list, "2026-11", today).totals.closing;
    const dec = (list: DailyExpenseRecord[]) => calculateDailyBudgetMonth(limits, list, "2026-12", today).totals.closing;
    expect([nov(base), dec(base)]).toEqual([300, 100]);

    const late = expense("2026-11-30", 500);
    const added = [...base, late];
    expect([nov(added), dec(added)]).toEqual([-200, 100]);

    const edited = [...base, { ...late, amount: 50 }];
    expect([nov(edited), dec(edited)]).toEqual([250, 100]);

    expect([nov(base), dec(base)]).toEqual([300, 100]); // deleted again
  });

  it("applies a limit change only from its effective date and keeps old days' allowance", () => {
    const limits: DailyLimitRecord[] = [
      { effective_date: "2026-11-01", amount: 300 },
      { effective_date: "2026-11-15", amount: 500 },
    ];
    const month = calculateDailyBudgetMonth(limits, [], "2026-11", "2026-11-30");
    expect(month.days.filter((day) => day.date < "2026-11-15").every((day) => day.allowance === 300)).toBe(true);
    expect(month.days.filter((day) => day.date >= "2026-11-15").every((day) => day.allowance === 500)).toBe(true);
    expect(month.totals.allowance).toBe(14 * 300 + 16 * 500);
    expect(limitOn(limits, "2026-11-14")).toBe(300);
    expect(limitOn(limits, "2026-11-15")).toBe(500);
  });

  it("never recalculates an old month with today's limit, even after a late entry", () => {
    const limits: DailyLimitRecord[] = [
      { effective_date: "2026-10-01", amount: 200 },
      { effective_date: "2026-12-01", amount: 900 },
    ];
    const october = calculateDailyBudgetMonth(limits, [expense("2026-10-31", 100)], "2026-10", "2026-12-05");
    expect(october.days.every((day) => day.allowance === 200)).toBe(true);
    expect(october.totals.closing).toBe(31 * 200 - 100);
  });

  it("does not accrue before tracking starts or after today", () => {
    const limits: DailyLimitRecord[] = [{ effective_date: "2026-11-20", amount: 300 }];
    const month = calculateDailyBudgetMonth(limits, [], "2026-11", "2026-11-22");
    expect(month.days.map((day) => day.date)).toEqual(["2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(calculateDailyBudgetMonth(limits, [], "2026-12", "2026-11-22").days).toEqual([]);
    expect(calculateDailyBudgetToday(limits, [], "2026-11-19")).toMatchObject({ started: false, available: 0 });
  });

  it("counts an expense recorded before tracking started as spending against zero", () => {
    const limits: DailyLimitRecord[] = [{ effective_date: "2026-11-10", amount: 300 }];
    const month = calculateDailyBudgetMonth(limits, [expense("2026-11-08", 50)], "2026-11", "2026-11-10");
    expect(month.days[0]).toMatchObject({ date: "2026-11-08", tracked: false, allowance: 0, closing: -50 });
    expect(month.totals.closing).toBe(250); // one tracked day (300) minus the earlier 50
  });

  it("handles leap years and month lengths", () => {
    expect(monthLastDay("2028-02")).toBe("2028-02-29");
    expect(monthLastDay("2026-02")).toBe("2026-02-28");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    const limits: DailyLimitRecord[] = [{ effective_date: "2028-01-15", amount: 10 }];
    expect(calculateDailyBudgetMonth(limits, [], "2028-02", "2028-03-10").days).toHaveLength(29);
  });

  it("lists months from the earliest record to the current month", () => {
    const months = dailyBudgetMonths(limit300, [expense("2026-09-03", 1)], "2027-01-04");
    expect(months).toEqual(["2027-01", "2026-12", "2026-11", "2026-10", "2026-09"]);
  });

  it("groups a month's expenses by date", () => {
    const list = [expense("2026-11-02", 1), expense("2026-11-02", 2), expense("2026-12-01", 3)];
    const groups = groupExpensesByDate(list, "2026-11");
    expect([...groups.keys()]).toEqual(["2026-11-02"]);
    expect(groups.get("2026-11-02")).toHaveLength(2);
  });
});

describe("daily budget dates use India's calendar", () => {
  it("rolls over to the next day and month at midnight IST, not UTC", () => {
    // 18:29 UTC on Nov 30 is 23:59 IST on Nov 30; 18:30 UTC is 00:00 IST on Dec 1.
    expect(dailyBudgetToday(new Date("2026-11-30T18:29:59Z"))).toBe("2026-11-30");
    expect(dailyBudgetToday(new Date("2026-11-30T18:30:00Z"))).toBe("2026-12-01");
    // Still Nov 30 in UTC, already Dec 1 in India: December starts at zero.
    const today = dailyBudgetToday(new Date("2026-11-30T20:00:00Z"));
    expect(calculateDailyBudgetToday(limit300, [expense("2026-11-30", 50)], today)).toMatchObject({
      month: "2026-12",
      carried: 0,
      available: 300,
    });
  });
});

describe("daily budget validation", () => {
  const today = "2026-11-06";
  it("accepts previous dates and closed months but not future dates", () => {
    expect(validateDailyExpenseInput({ amount: 10, expenseDate: "2025-01-31", description: "Tea" }, today)).toBeNull();
    expect(validateDailyExpenseInput({ amount: 10, expenseDate: today, description: "Tea" }, today)).toBeNull();
    expect(validateDailyExpenseInput({ amount: 10, expenseDate: "2026-11-07", description: "Tea" }, today)).toMatch(/future/);
    expect(validateDailyExpenseInput({ amount: 10, expenseDate: "2026-02-30", description: "Tea" }, today)).toMatch(/valid date/);
  });

  it("rejects empty descriptions and invalid amounts", () => {
    expect(validateDailyExpenseInput({ amount: 10, expenseDate: today, description: "   " }, today)).toMatch(/description/);
    expect(validateDailyExpenseInput({ amount: 0, expenseDate: today, description: "x" }, today)).toMatch(/greater than zero/);
    expect(validateDailyExpenseInput({ amount: 1.234, expenseDate: today, description: "x" }, today)).toMatch(/two decimal/);
    expect(validateDailyExpenseInput({ amount: Number.NaN, expenseDate: today, description: "x" }, today)).toMatch(/valid amount/);
  });

  it("allows a zero limit and limits up to a year ahead", () => {
    expect(validateDailyLimitInput({ amount: 0, effectiveDate: today }, today)).toBeNull();
    expect(validateDailyLimitInput({ amount: -1, effectiveDate: today }, today)).toMatch(/negative/);
    expect(validateDailyLimitInput({ amount: 100, effectiveDate: "2028-01-01" }, today)).toMatch(/next year/);
  });
});

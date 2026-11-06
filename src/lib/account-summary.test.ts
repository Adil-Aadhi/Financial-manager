import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calculateDashboard,
  type HomeSnapshot,
} from "@/components/home/OfflineHomeDashboard";
import {
  changedIncludeInSummary,
  normalizeIncludeInSummary,
} from "@/lib/accountSummary";
import { normalizeIncludeInSummary as normalizeFromAccounts } from "@/lib/accounts";
import { buildReport, type ReportRollupRow } from "@/lib/reports";

const range = { start: "2026-01-01", end: "2026-12-31" };

describe("financial summary account inclusion", () => {
  it("keeps the accounts module re-export callable", () => {
    expect(normalizeFromAccounts).toBe(normalizeIncludeInSummary);
    expect(normalizeFromAccounts(undefined)).toBe(true);
    expect(normalizeFromAccounts(false)).toBe(false);
  });

  it("treats legacy account records without the setting as included", () => {
    expect(normalizeIncludeInSummary(undefined)).toBe(true);
    expect(normalizeIncludeInSummary(null)).toBe(true);
    expect(normalizeIncludeInSummary(true)).toBe(true);
    expect(normalizeIncludeInSummary(false)).toBe(false);
  });

  it("omits an unchanged setting and returns only an intentional toggle", () => {
    expect(changedIncludeInSummary(true, true)).toBeUndefined();
    expect(changedIncludeInSummary(false, false)).toBeUndefined();
    expect(changedIncludeInSummary(undefined, true)).toBeUndefined();
    expect(changedIncludeInSummary(true, false)).toBe(false);
    expect(changedIncludeInSummary(false, true)).toBe(true);
  });

  it("excludes opted-out accounts from dashboard totals without changing their balance", () => {
    const snapshot: HomeSnapshot = {
      accounts: [
        {
          id: "included",
          name: "SBI",
          opening_balance: 100,
          currency: "INR",
          include_in_summary: true,
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "excluded",
          name: "Chair",
          opening_balance: 1_000,
          currency: "INR",
          include_in_summary: false,
          created_at: "2026-01-02T00:00:00.000Z",
        },
      ],
      transactions: [
        transaction("included-income", "included", "income", 20, "2026-04-01", "salary", "Salary"),
        transaction("included-expense", "included", "expense", 5, "2026-04-30", "food", "Food"),
        transaction("excluded-income", "excluded", "income", 500, "2026-04-01", "salary", "Salary"),
        transaction("excluded-expense", "excluded", "expense", 200, "2026-04-30", "tracking", "Tracking"),
      ],
      budget: { available: true, limit: 500, spent: 5, otherCurrencyCount: 0 },
    };

    const dashboard = calculateDashboard(snapshot, "INR", "2026-04");

    expect(dashboard.balance).toBe(115);
    expect(dashboard.monthIncome).toBe(20);
    expect(dashboard.monthExpense).toBe(5);
    expect(dashboard.topSpending).toEqual([
      expect.objectContaining({ name: "Food", total: 5 }),
    ]);
    expect(dashboard.activeAccounts.map((account) => account.id)).toEqual([
      "excluded",
      "included",
    ]);
    expect(dashboard.totalsByAccount.get("excluded")).toEqual({
      income: 500,
      expense: 200,
    });
    expect(
      1_000 +
        dashboard.totalsByAccount.get("excluded")!.income -
        dashboard.totalsByAccount.get("excluded")!.expense
    ).toBe(1_300);
  });

  it("filters consolidated report categories and months but retains excluded account reports", () => {
    const rows: ReportRollupRow[] = [
      rollup("included", "income", 100, 1, "salary", "2026-03-01"),
      rollup("included", "expense", 40, 2, "food", "2026-04-01"),
      rollup("excluded", "income", 1_000, 3, "tracking-income", "2026-03-01"),
      rollup("excluded", "expense", 600, 4, "tracking-expense", "2026-04-01"),
    ];

    const report = buildReport(
      rows,
      [
        { id: "included", name: "SBI", currency: "INR", trashed: false, include_in_summary: true },
        { id: "excluded", name: "Chair", currency: "INR", trashed: false, include_in_summary: false },
      ],
      [
        { id: "salary", name: "Salary", icon: "wallet" },
        { id: "food", name: "Food", icon: "utensils" },
        { id: "tracking-income", name: "Tracking income", icon: "circle" },
        { id: "tracking-expense", name: "Tracking expense", icon: "circle" },
      ],
      range,
      "INR",
      "INR"
    );

    expect(report).toMatchObject({ income: 100, expense: 40, net: 60, count: 3 });
    expect(report.incomeCategories.map(({ name, total }) => ({ name, total }))).toEqual([
      { name: "Salary", total: 100 },
    ]);
    expect(report.expenseCategories.map(({ name, total }) => ({ name, total }))).toEqual([
      { name: "Food", total: 40 },
    ]);
    expect(report.months.find((month) => month.key === "2026-03")).toMatchObject({
      income: 100,
      expense: 0,
    });
    expect(report.months.find((month) => month.key === "2026-04")).toMatchObject({
      income: 0,
      expense: 40,
    });
    expect(report.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "excluded",
          income: 1_000,
          expense: 600,
          net: 400,
          count: 7,
          include_in_summary: false,
        }),
        expect.objectContaining({
          id: "included",
          income: 100,
          expense: 40,
          net: 60,
          count: 3,
          include_in_summary: true,
        }),
      ])
    );
  });

  it("keeps legacy report rows included when the setting is absent", () => {
    const report = buildReport(
      [rollup("legacy", "income", 75, 1, "salary", "2026-12-01")],
      [{ id: "legacy", name: "Legacy", currency: "INR", trashed: false }],
      [{ id: "salary", name: "Salary", icon: "wallet" }],
      range,
      "INR",
      "INR"
    );

    expect(report).toMatchObject({ income: 75, expense: 0, net: 75, count: 1 });
    expect(report.accounts[0]).toMatchObject({
      id: "legacy",
      income: 75,
      include_in_summary: true,
    });
  });

  it("preserves the existing report RPC signature in the summary migration", () => {
    const migration = readFileSync(
      new URL(
        "../../supabase/migrations/20261106134557_account_summary_inclusion.sql",
        import.meta.url
      ),
      "utf8"
    );

    expect(migration).not.toMatch(/get_report_rollup/i);
    expect(migration).toContain("and a.include_in_summary is true");
  });
});

function transaction(
  id: string,
  accountId: string,
  type: "income" | "expense",
  amount: number,
  date: string,
  categoryId: string,
  categoryName: string
) {
  return {
    id,
    account_id: accountId,
    category_id: categoryId,
    type,
    amount,
    description: null,
    transaction_date: date,
    created_at: `${date}T00:00:00.000Z`,
    category: { name: categoryName, icon: "circle" },
  };
}

function rollup(
  account_id: string,
  type: "income" | "expense",
  total: number,
  tx_count: number,
  category_id: string,
  month: string
): ReportRollupRow {
  return {
    account_id,
    type,
    total,
    tx_count,
    category_id,
    month,
  };
}

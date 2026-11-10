import { describe, expect, it } from "vitest";
import { calculateDashboard, type HomeSnapshot } from "@/components/home/OfflineHomeDashboard";
import { niceMax } from "@/components/home/CashFlowChart";
import { getRecentMonthKeys } from "@/lib/month";

describe("Cash Flow feature tests", () => {
  const baseAccount = {
    id: "acc-1",
    name: "Main Bank",
    opening_balance: 10000,
    currency: "INR",
    include_in_summary: true,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };

  it("calculates exact six-month rolling keys including the current month", () => {
    const keys = getRecentMonthKeys("2026-11", 6);
    expect(keys).toHaveLength(6);
    expect(keys).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
  });

  it("separates income and expenses correctly across 6 months", () => {
    const snapshot: HomeSnapshot = {
      accounts: [baseAccount],
      transactions: [
        {
          id: "tx-1",
          account_id: "acc-1",
          category_id: null,
          type: "income",
          amount: 50000,
          description: "Salary June",
          transaction_date: "2026-06-15",
          created_at: "2026-06-15T10:00:00Z",
          category: null,
        },
        {
          id: "tx-2",
          account_id: "acc-1",
          category_id: null,
          type: "expense",
          amount: 20000,
          description: "Rent June",
          transaction_date: "2026-06-18",
          created_at: "2026-06-18T10:00:00Z",
          category: null,
        },
        {
          id: "tx-3",
          account_id: "acc-1",
          category_id: null,
          type: "income",
          amount: 60000,
          description: "Salary November",
          transaction_date: "2026-11-01",
          created_at: "2026-11-01T10:00:00Z",
          category: null,
        },
        {
          id: "tx-4",
          account_id: "acc-1",
          category_id: null,
          type: "expense",
          amount: 25000,
          description: "Groceries November",
          transaction_date: "2026-11-05",
          created_at: "2026-11-05T10:00:00Z",
          category: null,
        },
      ],
      budget: { available: true, limit: 30000, spent: 25000, otherCurrencyCount: 0 },
    };

    const result = calculateDashboard(snapshot, "INR", "2026-11");
    expect(result.cashFlow).toHaveLength(6);

    const june = result.cashFlow.find((m) => m.key === "2026-06");
    expect(june).toMatchObject({
      income: 50000,
      expense: 20000,
      net: 30000,
    });

    const november = result.cashFlow.find((m) => m.key === "2026-11");
    expect(november).toMatchObject({
      income: 60000,
      expense: 25000,
      net: 35000,
    });

    // An intermediate month with no transactions
    const july = result.cashFlow.find((m) => m.key === "2026-07");
    expect(july).toMatchObject({
      income: 0,
      expense: 0,
      net: 0,
    });
  });

  it("strictly excludes transfers and unsupported transaction types", () => {
    const snapshot: HomeSnapshot = {
      accounts: [baseAccount],
      transactions: [
        {
          id: "tx-transfer",
          account_id: "acc-1",
          category_id: null,
          type: "transfer",
          amount: 15000,
          description: "Account Transfer",
          transaction_date: "2026-11-02",
          created_at: "2026-11-02T10:00:00Z",
          category: null,
        },
        {
          id: "tx-expense",
          account_id: "acc-1",
          category_id: null,
          type: "expense",
          amount: 3000,
          description: "Lunch",
          transaction_date: "2026-11-02",
          created_at: "2026-11-02T12:00:00Z",
          category: null,
        },
      ],
      budget: { available: true, limit: null, spent: 3000, otherCurrencyCount: 0 },
    };

    const result = calculateDashboard(snapshot, "INR", "2026-11");
    const nov = result.cashFlow.find((m) => m.key === "2026-11");
    expect(nov?.income).toBe(0);
    expect(nov?.expense).toBe(3000);
    expect(nov?.net).toBe(-3000);
  });

  it("excludes transactions from accounts marked include_in_summary: false", () => {
    const excludedAccount = {
      id: "acc-excluded",
      name: "Secret Stash",
      opening_balance: 5000,
      currency: "INR",
      include_in_summary: false,
      deleted_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
    };

    const snapshot: HomeSnapshot = {
      accounts: [baseAccount, excludedAccount],
      transactions: [
        {
          id: "tx-excluded",
          account_id: "acc-excluded",
          category_id: null,
          type: "income",
          amount: 100000,
          description: "Hidden bonus",
          transaction_date: "2026-11-01",
          created_at: "2026-11-01T10:00:00Z",
          category: null,
        },
        {
          id: "tx-included",
          account_id: "acc-1",
          category_id: null,
          type: "income",
          amount: 10000,
          description: "Regular income",
          transaction_date: "2026-11-01",
          created_at: "2026-11-01T10:00:00Z",
          category: null,
        },
      ],
      budget: { available: true, limit: null, spent: 0, otherCurrencyCount: 0 },
    };

    const result = calculateDashboard(snapshot, "INR", "2026-11");
    const nov = result.cashFlow.find((m) => m.key === "2026-11");
    expect(nov?.income).toBe(10000); // only the included account's 10,000
  });

  it("excludes transactions from trashed / deleted accounts", () => {
    const trashedAccount = {
      id: "acc-trashed",
      name: "Old Closed Bank",
      opening_balance: 0,
      currency: "INR",
      include_in_summary: true,
      deleted_at: "2026-10-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
    };

    const snapshot: HomeSnapshot = {
      accounts: [baseAccount, trashedAccount],
      transactions: [
        {
          id: "tx-trashed",
          account_id: "acc-trashed",
          category_id: null,
          type: "expense",
          amount: 8000,
          description: "Old transaction",
          transaction_date: "2026-11-01",
          created_at: "2026-11-01T10:00:00Z",
          category: null,
        },
      ],
      budget: { available: true, limit: null, spent: 0, otherCurrencyCount: 0 },
    };

    const result = calculateDashboard(snapshot, "INR", "2026-11");
    const nov = result.cashFlow.find((m) => m.key === "2026-11");
    expect(nov?.expense).toBe(0);
  });

  it("isolates currencies and excludes non-matching account transactions", () => {
    const usdAccount = {
      id: "acc-usd",
      name: "US Dollar Account",
      opening_balance: 1000,
      currency: "USD",
      include_in_summary: true,
      deleted_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
    };

    const snapshot: HomeSnapshot = {
      accounts: [baseAccount, usdAccount],
      transactions: [
        {
          id: "tx-usd",
          account_id: "acc-usd",
          category_id: null,
          type: "income",
          amount: 1500,
          description: "USD Consulting",
          transaction_date: "2026-11-02",
          created_at: "2026-11-02T10:00:00Z",
          category: null,
        },
        {
          id: "tx-inr",
          account_id: "acc-1",
          category_id: null,
          type: "income",
          amount: 5000,
          description: "INR Consulting",
          transaction_date: "2026-11-02",
          created_at: "2026-11-02T10:00:00Z",
          category: null,
        },
      ],
      budget: { available: true, limit: null, spent: 0, otherCurrencyCount: 0 },
    };

    const resultInr = calculateDashboard(snapshot, "INR", "2026-11");
    const novInr = resultInr.cashFlow.find((m) => m.key === "2026-11");
    expect(novInr?.income).toBe(5000);

    const resultUsd = calculateDashboard(snapshot, "USD", "2026-11");
    const novUsd = resultUsd.cashFlow.find((m) => m.key === "2026-11");
    expect(novUsd?.income).toBe(1500);
  });

  it("normalizes UTC instant timestamps to Asia/Kolkata calendar month", () => {
    // 2026-05-31 20:00:00 UTC is 2026-06-01 01:30:00 in Asia/Kolkata
    const snapshot: HomeSnapshot = {
      accounts: [baseAccount],
      transactions: [
        {
          id: "tx-border",
          account_id: "acc-1",
          category_id: null,
          type: "expense",
          amount: 4500,
          description: "Night purchase",
          transaction_date: "2026-05-31T20:00:00.000Z",
          created_at: "2026-05-31T20:00:00.000Z",
          category: null,
        },
      ],
      budget: { available: true, limit: null, spent: 0, otherCurrencyCount: 0 },
    };

    const result = calculateDashboard(snapshot, "INR", "2026-11");
    const june = result.cashFlow.find((m) => m.key === "2026-06");
    expect(june?.expense).toBe(4500);
  });

  it("returns zero totals when there are no transactions in the 6-month window", () => {
    const snapshot: HomeSnapshot = {
      accounts: [baseAccount],
      transactions: [],
      budget: { available: true, limit: null, spent: 0, otherCurrencyCount: 0 },
    };

    const result = calculateDashboard(snapshot, "INR", "2026-11");
    expect(result.cashFlow).toHaveLength(6);
    expect(result.cashFlow.every((m) => m.income === 0 && m.expense === 0 && m.net === 0)).toBe(true);
  });

  it("calculates niceMax tick scale correctly", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(80)).toBe(100);
    expect(niceMax(150)).toBe(200);
    expect(niceMax(230)).toBe(250);
    expect(niceMax(420)).toBe(500);
    expect(niceMax(8500)).toBe(10000);
  });
});

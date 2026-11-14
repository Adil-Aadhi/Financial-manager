import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildExportReport, selectAccounts, TRANSFERS_NOTE } from "@/lib/reportExport/build";
import { buildCsv, escapeCsvCell } from "@/lib/reportExport/csv";
import { buildExportFilename, formatAmount, neutralizeFormula } from "@/lib/reportExport/format";
import type { ExportConfig, ReportDataset } from "@/lib/reportExport/model";
import {
  partitionByPeriod,
  toExportAccount,
  toExportTransaction,
  type AccountLike,
  type TransactionLike,
} from "@/lib/reportExport/normalize";
import { dateInPeriod, resolveExportPeriod, type ExportPeriod, type ResolvedPeriod } from "@/lib/reportExport/period";
import { buildPdf, pdfText } from "@/lib/reportExport/pdf";
import { runExport } from "@/lib/reportExport/runExport";
import { assessOfflineCache, datasetFromOfflineRows, readOfflineRows } from "@/lib/reportExport/sources/offline";
import { ExportAuthError, loadOnlineDataset } from "@/lib/reportExport/sources/online";
import { buildWorkbook, createSheetNamer } from "@/lib/reportExport/xlsx";
import { offlineDb } from "@/lib/offline/db";
import { transactionDateRangeBounds } from "@/lib/transactions";

// ---------------------------------------------------------------- helpers --

const NOW = new Date("2026-11-14T10:00:00Z");

function period(p: ExportPeriod, now = NOW): ResolvedPeriod {
  const result = resolveExportPeriod(p, now);
  if (!result.ok) throw new Error(result.error);
  return result.period;
}

const ACCOUNTS: AccountLike[] = [
  { id: "a-hdfc", name: "HDFC Savings", account_type: "bank", opening_balance: 1000, currency: "INR", include_in_summary: true, deleted_at: null },
  { id: "a-cash", name: "Cash", account_type: "cash", opening_balance: "500.50", currency: "INR", include_in_summary: true, deleted_at: null },
  { id: "a-usd", name: "US Wallet", account_type: "bank", opening_balance: 10, currency: "USD", include_in_summary: false, deleted_at: null },
  { id: "a-old", name: "Old Card", account_type: "credit", opening_balance: 0, currency: null, include_in_summary: true, deleted_at: "2026-10-01T00:00:00Z" },
];

const CATEGORIES = [
  { id: "c-salary", name: "Salary", type: "income" },
  { id: "c-food", name: "Food", type: "expense" },
  { id: "c-rent", name: "Rent", type: "expense" },
];

let seq = 0;
function tx(partial: Partial<TransactionLike> & Pick<TransactionLike, "account_id" | "type" | "amount" | "transaction_date">): TransactionLike {
  seq += 1;
  return {
    id: partial.id ?? `t-${String(seq).padStart(5, "0")}`,
    category_id: partial.type === "income" ? "c-salary" : "c-food",
    description: null,
    transaction_time: null,
    created_at: `2026-01-01T00:00:${String(seq % 60).padStart(2, "0")}Z`,
    ...partial,
  };
}

const TXS: TransactionLike[] = [
  tx({ id: "t-prior-1", account_id: "a-hdfc", type: "income", amount: 200, transaction_date: "2026-10-31" }),
  tx({ id: "t-prior-2", account_id: "a-hdfc", type: "expense", amount: 50, transaction_date: "2026-10-15" }),
  tx({ id: "t-prior-3", account_id: "a-cash", type: "expense", amount: "0.50", transaction_date: "2026-09-01" }),
  tx({ id: "t-1", account_id: "a-hdfc", type: "income", amount: 50000, transaction_date: "2026-11-01", transaction_time: "09:00:00", description: "November salary" }),
  tx({ id: "t-2", account_id: "a-hdfc", type: "expense", amount: 1200.75, transaction_date: "2026-11-03", transaction_time: "13:05:00", category_id: "c-rent" }),
  tx({ id: "t-3", account_id: "a-cash", type: "expense", amount: 99.25, transaction_date: "2026-11-30", transaction_time: "23:59:00", description: "Late snack" }),
  tx({ id: "t-4", account_id: "a-usd", type: "income", amount: 25, transaction_date: "2026-11-10" }),
  tx({ id: "t-future", account_id: "a-hdfc", type: "expense", amount: 10, transaction_date: "2026-12-01" }),
];

function dataset(p: ResolvedPeriod, rows = TXS, accounts = ACCOUNTS, categories: typeof CATEGORIES | null = CATEGORIES): ReportDataset {
  const normalized = rows.map((row) => toExportTransaction(row)!);
  const { inPeriod, priorTotals } = partitionByPeriod(normalized, p);
  return {
    accounts: accounts.map((a) => toExportAccount(a, "INR")),
    categories,
    transactions: inPeriod,
    priorTotals,
    source: { kind: "online", asOf: NOW.toISOString(), pendingChanges: 0, failedChanges: 0 },
  };
}

function config(p: ResolvedPeriod, extra: Partial<ExportConfig> = {}): ExportConfig {
  return { period: p, accountMode: "combined", accountId: null, includeExcluded: false, format: "pdf", ...extra };
}

// ---------------------------------------------------------------- periods --

describe("export periods", () => {
  it("1. current month uses the India calendar", () => {
    expect(period({ kind: "current-month" })).toMatchObject({ start: "2026-11-01", end: "2026-11-30", fileStem: "2026-11" });
    // 30 Nov 19:00 UTC is already 1 Dec in India.
    expect(period({ kind: "current-month" }, new Date("2026-11-30T19:00:00Z"))).toMatchObject({ start: "2026-12-01", end: "2026-12-31" });
  });

  it("2. last three months spans the current month and the two before it, across years", () => {
    expect(period({ kind: "last-3-months" }, new Date("2026-01-15T06:00:00Z"))).toMatchObject({
      start: "2025-11-01",
      end: "2026-01-31",
      fileStem: "2025-11_to_2026-01",
    });
  });

  it("3. specific month and year, including leap February; rejects invalid months", () => {
    expect(period({ kind: "month", year: 2024, month: 2 })).toMatchObject({ start: "2024-02-01", end: "2024-02-29", label: "February 2024" });
    expect(resolveExportPeriod({ kind: "month", year: 2026, month: 13 }).ok).toBe(false);
  });

  it("4. current year", () => {
    expect(period({ kind: "current-year" })).toMatchObject({ start: "2026-01-01", end: "2026-12-31", fileStem: "2026" });
  });

  it("5. specific year; rejects out-of-range years", () => {
    expect(period({ kind: "year", year: 2025 })).toMatchObject({ start: "2025-01-01", end: "2025-12-31" });
    expect(resolveExportPeriod({ kind: "year", year: 1500 }).ok).toBe(false);
  });

  it("6. custom range validates dates and order", () => {
    expect(period({ kind: "custom", start: "2026-01-05", end: "2026-02-10" })).toMatchObject({
      start: "2026-01-05",
      end: "2026-02-10",
      fileStem: "2026-01-05_to_2026-02-10",
    });
    expect(resolveExportPeriod({ kind: "custom", start: "2026-03-01", end: "2026-02-01" })).toEqual({
      ok: false,
      error: "The start date can't be after the end date.",
    });
    expect(resolveExportPeriod({ kind: "custom", start: "2026-02-30", end: "2026-03-01" }).ok).toBe(false);
    expect(resolveExportPeriod({ kind: "custom", start: "", end: "2026-03-01" }).ok).toBe(false);
  });

  it("7. all time has open bounds and includes future-dated rows", () => {
    const all = period({ kind: "all-time" });
    expect(all).toMatchObject({ start: null, end: null, fileStem: "All_Time" });
    expect(dateInPeriod("1999-01-01", all) && dateInPeriod("2099-12-31", all)).toBe(true);
    const report = buildExportReport(dataset(all), config(all, { includeExcluded: true }));
    expect(report.rows).toHaveLength(TXS.length);
  });

  it("8. both ends are inclusive and the whole end date counts", () => {
    const nov = period({ kind: "current-month" });
    expect(dateInPeriod("2026-11-01", nov)).toBe(true);
    expect(dateInPeriod("2026-11-30", nov)).toBe(true);
    expect(dateInPeriod("2026-10-31", nov)).toBe(false);
    expect(dateInPeriod("2026-12-01", nov)).toBe(false);
    // Online query bounds: 30 Nov 23:59 IST (18:29 UTC) is in, 1 Dec 00:00 IST is out.
    expect(transactionDateRangeBounds("2026-11-01", "2026-11-30")).toEqual({
      startInclusive: "2026-10-31T18:30:00.000Z",
      endExclusive: "2026-11-30T18:30:00.000Z",
    });
    // A timestamptz late on 30 Nov India time normalizes into the period.
    const late = toExportTransaction(tx({ account_id: "a-cash", type: "expense", amount: 1, transaction_date: "2026-11-30T18:29:00+00:00" }))!;
    expect(late.date).toBe("2026-11-30");
    const report = buildExportReport(dataset(nov), config(nov));
    expect(report.rows.map((r) => r.tx.id)).toContain("t-3");
    expect(report.rows.map((r) => r.tx.id)).not.toContain("t-future");
  });
});

// ------------------------------------------------------------ calculations --

describe("financial calculations", () => {
  const nov = period({ kind: "current-month" });

  it("9–11. income, expenses and net cash flow (combined INR accounts)", () => {
    const report = buildExportReport(dataset(nov), config(nov));
    expect(report.summaries).toHaveLength(1);
    const inr = report.summaries[0];
    expect(inr.currency).toBe("INR");
    expect(inr.income).toBe(50000);
    expect(inr.expense).toBe(1300);
    expect(inr.net).toBe(48700);
    expect(inr.count).toBe(3);
  });

  it("12. the schema has no transfer type; unsupported types are never counted as income or expense", () => {
    expect(toExportTransaction(tx({ account_id: "a-hdfc", type: "transfer", amount: 999, transaction_date: "2026-11-05" }))).toBeNull();
    const report = buildExportReport(dataset(nov), config(nov));
    expect(report.transfersSupported).toBe(false);
    expect(report.notes[0]).toBe(TRANSFERS_NOTE);
  });

  it("13. a transaction appears once in combined history even when shown per account", () => {
    const report = buildExportReport(dataset(nov), config(nov, { accountMode: "separate", includeExcluded: true }));
    const perAccount = report.statements.reduce((n, s) => n + s.rows.length, 0);
    expect(report.rows).toHaveLength(perAccount);
    expect(new Set(report.rows.map((r) => r.tx.id)).size).toBe(report.rows.length);
    // Statements share the same row objects (no duplicated data).
    expect(report.statements[0].rows[0]).toBe(report.rows.find((r) => r.tx.id === report.statements[0].rows[0].tx.id));
  });

  it("14. opening balance = opening_balance + activity before the period", () => {
    const report = buildExportReport(dataset(nov), config(nov));
    const hdfc = report.statements.find((s) => s.account.id === "a-hdfc")!;
    const cash = report.statements.find((s) => s.account.id === "a-cash")!;
    expect(hdfc.opening).toBe(1150); // 1000 + 200 − 50
    expect(cash.opening).toBe(500); // 500.50 − 0.50
    expect(report.summaries[0].opening).toBe(1650);
  });

  it("15. closing balance = opening + income − expense in the period (later rows excluded)", () => {
    const report = buildExportReport(dataset(nov), config(nov));
    const hdfc = report.statements.find((s) => s.account.id === "a-hdfc")!;
    expect(hdfc.closing).toBe(1150 + 50000 - 1200.75);
    expect(hdfc.rows.at(-1)!.runningBalance).toBe(hdfc.closing);
    expect(report.summaries[0].closing).toBe(1650 + 50000 - 1300);
    // All time closing equals the account details page's current balance formula.
    const all = period({ kind: "all-time" });
    const allHdfc = buildExportReport(dataset(all), config(all)).statements.find((s) => s.account.id === "a-hdfc")!;
    expect(allHdfc.opening).toBe(1000);
    expect(allHdfc.closing).toBe(1000 + 200 - 50 + 50000 - 1200.75 - 10);
  });

  it("16. combined export: account column, excluded accounts only on request, currencies never mixed", () => {
    const report = buildExportReport(dataset(nov), config(nov));
    expect(report.statements.map((s) => s.account.id)).toEqual(["a-cash", "a-hdfc"]);
    expect(report.rows.every((r) => r.accountName)).toBe(true);
    const withExcluded = buildExportReport(dataset(nov), config(nov, { includeExcluded: true }));
    expect(withExcluded.summaries.map((s) => s.currency)).toEqual(["INR", "USD"]);
    expect(withExcluded.summaries[1]).toMatchObject({ income: 25, opening: 10, closing: 35 });
    // Old Card is in Trash with no activity in November, so it is left out.
    expect(withExcluded.statements.some((s) => s.account.id === "a-old")).toBe(false);
  });

  it("17. individual account export contains only that account", () => {
    const report = buildExportReport(dataset(nov), config(nov, { accountMode: "single", accountId: "a-cash" }));
    expect(report.statements).toHaveLength(1);
    expect(report.rows.map((r) => r.tx.id)).toEqual(["t-3"]);
    expect(selectAccounts(dataset(nov), config(nov, { accountMode: "single", accountId: "nope" })).ok).toBe(false);
    // A trashed account can still be exported individually.
    expect(selectAccounts(dataset(nov), config(nov, { accountMode: "single", accountId: "a-old" })).ok).toBe(true);
  });

  it("orders rows by date, time, then creation", () => {
    const rows = [
      tx({ id: "z", account_id: "a-cash", type: "expense", amount: 1, transaction_date: "2026-11-02", transaction_time: "10:00:00" }),
      tx({ id: "y", account_id: "a-cash", type: "expense", amount: 1, transaction_date: "2026-11-02", transaction_time: null }),
      tx({ id: "x", account_id: "a-cash", type: "expense", amount: 1, transaction_date: "2026-11-01", transaction_time: "23:00:00" }),
    ];
    const report = buildExportReport(dataset(nov, rows), config(nov));
    expect(report.rows.map((r) => r.tx.id)).toEqual(["x", "y", "z"]);
  });

  it("19. empty period: balances carry through and every format still builds", async () => {
    const empty = period({ kind: "month", year: 2026, month: 6 });
    const report = buildExportReport(dataset(empty, TXS.filter((t) => t.transaction_date < "2026-06-01")), config(empty));
    expect(report.rows).toHaveLength(0);
    expect(report.summaries[0]).toMatchObject({ income: 0, expense: 0, net: 0 });
    expect(report.summaries[0].opening).toBe(report.summaries[0].closing);
    expect(buildCsv(report).split("\r\n").filter(Boolean)).toHaveLength(1);
    const doc = await buildPdf(report);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    const wb = await buildWorkbook(report);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "All Transactions"]);
  });

  it("20. large dataset (25,000 rows) stays exact and fast", () => {
    const year = period({ kind: "year", year: 2026 });
    const rows: TransactionLike[] = [];
    for (let i = 0; i < 25_000; i += 1) {
      const day = String((i % 28) + 1).padStart(2, "0");
      const month = String((i % 12) + 1).padStart(2, "0");
      rows.push(tx({ account_id: i % 2 ? "a-hdfc" : "a-cash", type: i % 3 ? "expense" : "income", amount: "0.10", transaction_date: `2026-${month}-${day}` }));
    }
    const started = performance.now();
    const report = buildExportReport(dataset(year, rows), config(year));
    expect(performance.now() - started).toBeLessThan(3000);
    const incomeCount = rows.filter((r) => r.type === "income").length;
    expect(report.summaries[0].income).toBe(Math.round(incomeCount * 10) / 100);
    expect(report.summaries[0].expense).toBe(Math.round((25_000 - incomeCount) * 10) / 100);
    expect(report.rows).toHaveLength(25_000);
  });
});

// ------------------------------------------------------------ offline path --

describe("offline export", () => {
  const owner = "user-1";
  const nov = period({ kind: "current-month" });
  const meta = { ownerId: owner, completedAt: "2026-11-14T08:00:00Z", totalsMatch: true };

  it("21. cache completeness checks", () => {
    const base = {
      ownerId: owner,
      activeOwnerId: owner,
      meta,
      accountIds: new Set(["a"]),
      transactionAccountIds: ["a"],
      invalidTransactions: 0,
      failedChanges: 0,
    };
    expect(assessOfflineCache(base).ok).toBe(true);
    expect(assessOfflineCache({ ...base, meta: undefined }).problems[0]).toMatch(/hasn't finished downloading/);
    expect(assessOfflineCache({ ...base, meta: { ...meta, totalsMatch: false } }).ok).toBe(false);
    expect(assessOfflineCache({ ...base, transactionAccountIds: ["a", "missing"] }).ok).toBe(false);
    expect(assessOfflineCache({ ...base, invalidTransactions: 2 }).ok).toBe(false);
    expect(assessOfflineCache({ ...base, requiredAccountId: "zzz" }).ok).toBe(false);
    const failed = assessOfflineCache({ ...base, failedChanges: 1 });
    expect(failed.ok).toBe(true);
    expect(failed.warnings).toHaveLength(1);
  });

  beforeEach(async () => {
    await Promise.all([
      offlineDb.syncMeta.clear(),
      offlineDb.accounts.clear(),
      offlineDb.categories.clear(),
      offlineDb.transactions.clear(),
      offlineDb.profiles.clear(),
      offlineDb.outbox.clear(),
    ]);
  });

  async function seed(ownerId: string, rows = TXS, withMeta = true) {
    if (withMeta) {
      await offlineDb.syncMeta.put({
        ownerId,
        completedAt: meta.completedAt,
        budgetAvailable: true,
        server: { accounts: 0, transactions: 0, income: 0, expense: 0 },
        local: { accounts: 0, transactions: 0, income: 0, expense: 0 },
        totalsMatch: true,
      });
    }
    await offlineDb.profiles.put({ ownerId, id: ownerId, full_name: null, avatar_url: null, default_currency: "INR" });
    await offlineDb.accounts.bulkPut(
      ACCOUNTS.map((a) => ({
        ...a,
        ownerId,
        user_id: ownerId,
        created_at: "2026-01-01T00:00:00Z",
        account_type: a.account_type ?? "bank",
        include_in_summary: a.include_in_summary ?? undefined,
        deleted_at: a.deleted_at ?? null,
      }))
    );
    await offlineDb.categories.bulkPut(CATEGORIES.map((c) => ({ ownerId, user_id: null, icon: "circle", is_default: true, ...c })));
    await offlineDb.transactions.bulkPut(
      rows.map((t) => ({ ownerId, user_id: ownerId, ...t, category_id: t.category_id ?? "", transaction_time: t.transaction_time ?? null }))
    );
  }

  it("22. offline export reads only IndexedDB and matches the online calculation", async () => {
    await seed(owner);
    const rows = await readOfflineRows(owner);
    const result = datasetFromOfflineRows(rows, { ownerId: owner, activeOwnerId: owner, defaultCurrency: "INR", period: nov });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dataset.source.kind).toBe("offline");
    const offline = buildExportReport(result.dataset, config(nov));
    const online = buildExportReport(dataset(nov), config(nov));
    expect(offline.summaries).toEqual(online.summaries);
    expect(offline.statements.map((s) => [s.account.id, s.opening, s.closing])).toEqual(
      online.statements.map((s) => [s.account.id, s.opening, s.closing])
    );

    // The full pipeline, with no network available (fetch would throw).
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("network disabled in test"));
    try {
      const exported = await runExport({
        ownerId: owner,
        activeOwnerId: owner,
        defaultCurrency: "INR",
        source: "offline",
        config: config(nov, { format: "csv" }),
      });
      expect(exported.filename).toBe("Finance_Report_2026-11.csv");
      const text = await exported.blob.text();
      expect(text).toContain("November salary");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refuses an offline export when the initial bootstrap never completed", async () => {
    await seed(owner, TXS, false);
    await expect(
      runExport({ ownerId: owner, activeOwnerId: owner, defaultCurrency: "INR", source: "offline", config: config(nov, { format: "csv" }) })
    ).rejects.toThrow(/hasn't finished downloading/);
  });

  it("23. missing cached category metadata is marked unavailable, never invented", async () => {
    await seed(owner);
    await offlineDb.categories.where("ownerId").equals(owner).delete();
    const rows = await readOfflineRows(owner);
    const result = datasetFromOfflineRows(rows, { ownerId: owner, activeOwnerId: owner, defaultCurrency: "INR", period: nov });
    if (!result.ok) throw new Error("expected ok");
    const report = buildExportReport(result.dataset, config(nov));
    expect(report.categoriesAvailable).toBe(false);
    expect(report.summaries[0].expenseCategories).toEqual([]);
    expect(buildCsv(report)).toContain(",Unavailable,");
    expect(report.notes.some((n) => /Category details are unavailable/.test(n))).toBe(true);
  });

  it("24a. offline: another user's cached rows are never read; a different active user is blocked", async () => {
    await seed("someone-else");
    const mine = await readOfflineRows(owner);
    expect(mine.transactions).toHaveLength(0);
    expect(mine.meta).toBeUndefined();
    await seed(owner);
    const rows = await readOfflineRows(owner);
    const result = datasetFromOfflineRows(rows, { ownerId: owner, activeOwnerId: "someone-else", defaultCurrency: "INR", period: nov });
    expect(result.ok).toBe(false);
  });
});

// ------------------------------------------------------------- online path --

class FakeQuery {
  filters: [string, string, unknown][] = [];
  rangeArgs: [number, number] | null = null;
  constructor(private db: FakeSupabase, private table: string, private opts?: { count?: string }) {}
  select(_cols: string, opts?: { count?: string }) {
    this.opts = opts;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push(["eq", col, val]);
    return this;
  }
  gte(col: string, val: unknown) {
    this.filters.push(["gte", col, val]);
    return this;
  }
  lt(col: string, val: unknown) {
    this.filters.push(["lt", col, val]);
    return this;
  }
  or(expr: string) {
    this.filters.push(["or", expr, null]);
    return this;
  }
  order() {
    return this;
  }
  range(from: number, to: number) {
    this.rangeArgs = [from, to];
    return this;
  }
  then<T>(resolve: (value: { data: unknown[]; error: null; count: number | null }) => T) {
    this.db.queries.push({ table: this.table, filters: this.filters });
    let rows = this.db.tables[this.table] ?? [];
    const userFilter = this.filters.find(([op, col]) => op === "eq" && col === "user_id");
    if (userFilter) rows = rows.filter((r) => (r as { user_id?: string }).user_id === userFilter[2]);
    const gte = this.filters.find(([op]) => op === "gte");
    const lt = this.filters.find(([op]) => op === "lt");
    if (gte) rows = rows.filter((r) => String((r as { transaction_date: string }).transaction_date) >= String(gte[2]));
    if (lt) rows = rows.filter((r) => String((r as { transaction_date: string }).transaction_date) < String(lt[2]));
    const [from, to] = this.rangeArgs ?? [0, rows.length];
    return Promise.resolve({ data: rows.slice(from, to + 1), error: null, count: this.opts?.count ? rows.length : null }).then(resolve);
  }
}

class FakeSupabase {
  queries: { table: string; filters: [string, string, unknown][] }[] = [];
  tables: Record<string, unknown[]> = {};
  constructor(private sessionUser: string | null) {}
  auth = {
    getUser: async () =>
      this.sessionUser ? { data: { user: { id: this.sessionUser } }, error: null } : { data: { user: null }, error: { message: "no session" } },
  };
  from(table: string) {
    return new FakeQuery(this, table);
  }
  rpc() {
    return {
      order() {
        return this;
      },
      range: async () => ({ data: [], error: { code: "PGRST202", message: "missing" }, count: null }),
    };
  }
}

describe("online export", () => {
  const all = period({ kind: "all-time" });

  it("24b. uses the verified session user, never the caller's id, and rejects a mismatched session", async () => {
    const fake = new FakeSupabase("user-1");
    fake.tables = {
      accounts: ACCOUNTS.map((a) => ({ ...a, user_id: "user-1" })),
      categories: CATEGORIES,
      transactions: [
        ...TXS.map((t) => ({ ...t, user_id: "user-1" })),
        { ...tx({ account_id: "x", type: "income", amount: 1, transaction_date: "2026-11-02" }), user_id: "intruder" },
      ],
    };
    const data = await loadOnlineDataset({ supabase: fake as never, ownerId: "user-1", defaultCurrency: "INR", period: all });
    expect(data.transactions).toHaveLength(TXS.length);
    for (const q of fake.queries.filter((q) => q.table !== "categories")) {
      expect(q.filters).toContainEqual(["eq", "user_id", "user-1"]);
    }
    await expect(
      loadOnlineDataset({ supabase: new FakeSupabase("user-2") as never, ownerId: "user-1", defaultCurrency: "INR", period: all })
    ).rejects.toBeInstanceOf(ExportAuthError);
    await expect(
      loadOnlineDataset({ supabase: new FakeSupabase(null) as never, ownerId: "user-1", defaultCurrency: "INR", period: all })
    ).rejects.toBeInstanceOf(ExportAuthError);
  });

  it("pages through more than 1,000 transactions and checks the count", async () => {
    const fake = new FakeSupabase("user-1");
    fake.tables = {
      accounts: ACCOUNTS.map((a) => ({ ...a, user_id: "user-1" })),
      categories: CATEGORIES,
      transactions: Array.from({ length: 2345 }, () => ({ ...tx({ account_id: "a-cash", type: "expense", amount: 1, transaction_date: "2026-11-02" }), user_id: "user-1" })),
    };
    const data = await loadOnlineDataset({ supabase: fake as never, ownerId: "user-1", defaultCurrency: "INR", period: all });
    expect(data.transactions).toHaveLength(2345);
    expect(fake.queries.filter((q) => q.table === "transactions")).toHaveLength(3);
  });
});

// ------------------------------------------------------------- file output --

describe("CSV", () => {
  it("25. escapes commas, quotes and newlines, keeps Unicode, adds a BOM and blocks formulas", () => {
    expect(escapeCsvCell("plain")).toBe("plain");
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(neutralizeFormula("+91 phone")).toBe("'+91 phone");
    expect(neutralizeFormula("-5 refund")).toBe("'-5 refund");
    expect(neutralizeFormula("@sum")).toBe("'@sum");
    expect(neutralizeFormula("normal")).toBe("normal");

    const nov = period({ kind: "current-month" });
    const rows = [
      tx({ account_id: "a-cash", type: "expense", amount: 12.5, transaction_date: "2026-11-02", description: "=cmd|' /C calc'!A0" }),
      tx({ account_id: "a-cash", type: "income", amount: 3, transaction_date: "2026-11-03", description: "चाय, കാപ്പി \"☕\"" }),
    ];
    const csv = buildCsv(buildExportReport(dataset(nov, rows), config(nov)));
    expect(csv.startsWith("﻿Date,Time,Account,Currency,Category,Description,Type,Amount\r\n")).toBe(true);
    expect(csv).toContain("'=cmd|' /C calc'!A0");
    expect(csv).toContain('"चाय, കാപ്പി ""☕"""');
    expect(csv).toContain("2026-11-02,,Cash,INR,Food,");
    expect(csv).toContain(",Expense,12.50\r\n");
  });
});

describe("PDF and Excel", () => {
  const nov = period({ kind: "current-month" });

  it("26a. PDF paginates large histories and repeats table headers and page numbers", async () => {
    const rows = Array.from({ length: 400 }, (_, i) =>
      tx({
        account_id: i % 2 ? "a-hdfc" : "a-cash",
        type: i % 4 ? "expense" : "income",
        amount: 100 + i,
        transaction_date: `2026-11-${String((i % 30) + 1).padStart(2, "0")}`,
        description: i === 5 ? "A very long description ".repeat(20) : `Item ${i}`,
      })
    );
    const report = buildExportReport(dataset(nov, rows), config(nov));
    const doc = await buildPdf(report);
    const pages = doc.getNumberOfPages();
    expect(pages).toBeGreaterThan(5);
    const internal = doc.internal as unknown as { pages: (string[] | undefined)[] };
    const pageText = (n: number) => (internal.pages[n] ?? []).join("\n");
    // Every page after the first carries the running header and page number; history pages repeat the table head.
    for (let n = 2; n <= pages; n += 1) {
      expect(pageText(n)).toContain(`Page ${n} of ${pages}`);
      expect(pageText(n)).toContain("Financial Statement");
    }
    const headed = Array.from({ length: pages }, (_, i) => pageText(i + 1)).filter((t) => t.includes("(Description)"));
    expect(headed.length).toBeGreaterThan(3);
  });

  it("26b. separate mode puts each account on its own section; text is PDF-safe", async () => {
    const report = buildExportReport(dataset(nov), config(nov, { accountMode: "separate", includeExcluded: true }));
    const doc = await buildPdf(report);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1 + report.statements.length);
    expect(pdfText("Café – “quote” ₹5 😀 चाय")).toBe('Café - "quote" Rs.5 ? ???');
  });

  it("18 / 26c. Excel: separate worksheets, frozen headers, filters, formats and string-only text", async () => {
    const rows = [...TXS, tx({ account_id: "a-cash", type: "expense", amount: 5, transaction_date: "2026-11-04", description: "=1+1" })];
    const report = buildExportReport(dataset(nov, rows), config(nov, { accountMode: "separate", includeExcluded: true, format: "xlsx" }));
    const built = await buildWorkbook(report);
    const buffer = await built.xlsx.writeBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "All Transactions", "Cash", "HDFC Savings", "US Wallet"]);

    const all = wb.getWorksheet("All Transactions")!;
    expect(all.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(all.autoFilter).toBeTruthy();
    expect(all.getRow(1).getCell(1).font?.bold).toBe(true);
    const formulaRow = all.getRows(2, all.rowCount - 1)!.find((r) => r.getCell(5).value === "=1+1")!;
    expect(formulaRow.getCell(5).type).toBe(ExcelJS.ValueType.String);
    expect(formulaRow.getCell(7).numFmt).toContain("₹");
    expect(formulaRow.getCell(1).value).toBeInstanceOf(Date);

    const cash = wb.getWorksheet("Cash")!;
    expect(cash.views[0]).toMatchObject({ state: "frozen" });
    expect(cash.getCell("B6").value).toBe(500); // opening balance
  });

  it("single-account workbook has no empty multi-account sheets", async () => {
    const report = buildExportReport(dataset(nov), config(nov, { accountMode: "single", accountId: "a-hdfc", format: "xlsx" }));
    const wb = await buildWorkbook(report);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "HDFC Savings"]);
  });

  it("sheet names obey Excel's rules and stay unique", () => {
    const name = createSheetNamer();
    expect(name("Summary")).toBe("Summary (2)");
    expect(name("A/B: [x]*?")).toBe("A B x");
    expect(name("'quoted'")).toBe("quoted");
    expect(name("x".repeat(40))).toHaveLength(31);
    expect(name("x".repeat(40))).toBe(`${"x".repeat(27)} (2)`);
    expect(name("")).toBe("Account");
  });
});

describe("formatting and filenames", () => {
  it("uses Indian grouping for INR and safe filenames", () => {
    expect(formatAmount(125000, "INR")).toBe("1,25,000.00");
    expect(formatAmount(125000, "USD")).toBe("125,000.00");
    const p = period({ kind: "custom", start: "2026-01-05", end: "2026-02-10" });
    expect(buildExportFilename(p, "combined", null, "pdf")).toBe("Finance_Report_2026-01-05_to_2026-02-10.pdf");
    expect(buildExportFilename(period({ kind: "current-month" }), "single", { name: "Café / Savings: ₹" }, "xlsx")).toBe(
      "Finance_Report_2026-11_Cafe_Savings.xlsx"
    );
    expect(buildExportFilename(period({ kind: "all-time" }), "separate", null, "csv")).toBe("Finance_Report_All_Time_By_Account.csv");
  });
});

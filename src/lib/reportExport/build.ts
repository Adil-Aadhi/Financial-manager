/**
 * Financial calculations for exports. Pure and source-agnostic: the online (Supabase) and
 * offline (IndexedDB) paths both produce a ReportDataset, and every exporter (PDF, XLSX,
 * CSV) consumes the ExportReport built here, so the numbers can never disagree by format.
 *
 * Money is summed in integer minor units (paise/cents) to avoid floating-point drift.
 */

import { dateInPeriod } from "@/lib/reportExport/period";
import type {
  AccountStatement,
  CategorySummary,
  CurrencySummary,
  ExportAccount,
  ExportConfig,
  ExportReport,
  ExportTransaction,
  ReportDataset,
  ReportRow,
} from "@/lib/reportExport/model";

export const TRANSFERS_NOTE =
  "This app records income and expense transactions only; it has no transfer records, so no transfer history is included and nothing is excluded as a transfer.";

const toMinor = (value: number) => Math.round((Number(value) || 0) * 100);
const fromMinor = (value: number) => value / 100;

/** Chronological order used by every exporter: date, time, creation time, id. */
export function compareTransactions(a: ExportTransaction, b: ExportTransaction) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const at = a.time ?? "";
  const bt = b.time ?? "";
  if (at !== bt) return at < bt ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type AccountSelection = { ok: true; accounts: ExportAccount[] } | { ok: false; error: string };

/**
 * Which accounts a configuration covers.
 * - single: exactly the chosen account (it may be in Trash or excluded from summary).
 * - combined / separate: the accounts the Reports page totals (include_in_summary), or all of
 *   them when `includeExcluded`. Accounts in Trash are included only when they have activity in
 *   the period, matching the Reports page, which still counts their history.
 */
export function selectAccounts(
  dataset: Pick<ReportDataset, "accounts" | "transactions">,
  config: Pick<ExportConfig, "accountMode" | "accountId" | "includeExcluded" | "period">
): AccountSelection {
  if (config.accountMode === "single") {
    const account = dataset.accounts.find((item) => item.id === config.accountId);
    if (!account) return { ok: false, error: "The selected account isn't available." };
    return { ok: true, accounts: [account] };
  }

  const active = new Set<string>();
  for (const tx of dataset.transactions) {
    if (dateInPeriod(tx.date, config.period)) active.add(tx.accountId);
  }
  const accounts = dataset.accounts
    .filter((account) => config.includeExcluded || account.includeInSummary)
    .filter((account) => !account.trashed || active.has(account.id))
    .sort((a, b) => Number(a.trashed) - Number(b.trashed) || a.name.localeCompare(b.name));

  if (accounts.length === 0) return { ok: false, error: "There are no accounts to include in this report." };
  return { ok: true, accounts };
}

function rankCategories(map: Map<string, { name: string; total: number; count: number }>, totalMinor: number) {
  const items: CategorySummary[] = [...map.entries()].map(([id, item]) => ({
    id,
    name: item.name,
    total: fromMinor(item.total),
    count: item.count,
    percent: totalMinor > 0 ? (item.total / totalMinor) * 100 : 0,
  }));
  return items.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

export function buildExportReport(
  dataset: ReportDataset,
  config: ExportConfig,
  generatedAt = new Date().toISOString()
): ExportReport {
  const selection = selectAccounts(dataset, config);
  if (!selection.ok) throw new Error(selection.error);
  const accounts = selection.accounts;
  const selected = new Set(accounts.map((account) => account.id));
  const categoryById = dataset.categories ? new Map(dataset.categories.map((c) => [c.id, c])) : null;

  // Opening balance: the account balance immediately before the period starts.
  const state = new Map<
    string,
    { statement: AccountStatement; running: number; openingMinor: number; incomeMinor: number; expenseMinor: number }
  >();
  for (const account of accounts) {
    const prior = dataset.priorTotals.get(account.id) ?? { income: 0, expense: 0 };
    const openingMinor = toMinor(account.openingBalance) + toMinor(prior.income) - toMinor(prior.expense);
    state.set(account.id, {
      statement: { account, opening: 0, income: 0, expense: 0, net: 0, closing: 0, count: 0, rows: [] },
      running: openingMinor,
      openingMinor,
      incomeMinor: 0,
      expenseMinor: 0,
    });
  }

  const inScope = dataset.transactions
    .filter((tx) => selected.has(tx.accountId) && dateInPeriod(tx.date, config.period))
    .sort(compareTransactions);

  let missingCategory = false;
  const rows: ReportRow[] = [];
  for (const tx of inScope) {
    const entry = state.get(tx.accountId)!;
    const amountMinor = toMinor(tx.amount);
    if (tx.type === "income") {
      entry.incomeMinor += amountMinor;
      entry.running += amountMinor;
    } else {
      entry.expenseMinor += amountMinor;
      entry.running -= amountMinor;
    }
    const category = tx.categoryId && categoryById ? categoryById.get(tx.categoryId) : undefined;
    if (!category) missingCategory = true;
    const row: ReportRow = {
      tx,
      accountName: entry.statement.account.name,
      currency: entry.statement.account.currency,
      categoryName: category?.name ?? null,
      runningBalance: fromMinor(entry.running),
    };
    entry.statement.rows.push(row);
    rows.push(row);
  }

  const statements: AccountStatement[] = accounts.map((account) => {
    const entry = state.get(account.id)!;
    const statement = entry.statement;
    statement.opening = fromMinor(entry.openingMinor);
    statement.income = fromMinor(entry.incomeMinor);
    statement.expense = fromMinor(entry.expenseMinor);
    statement.net = fromMinor(entry.incomeMinor - entry.expenseMinor);
    statement.closing = fromMinor(entry.openingMinor + entry.incomeMinor - entry.expenseMinor);
    statement.count = statement.rows.length;
    return statement;
  });

  const categoriesAvailable = dataset.categories !== null && !missingCategory;

  // Combined totals, one block per currency (amounts are never converted).
  const byCurrency = new Map<string, AccountStatement[]>();
  for (const statement of statements) {
    const list = byCurrency.get(statement.account.currency) ?? [];
    list.push(statement);
    byCurrency.set(statement.account.currency, list);
  }
  const summaries: CurrencySummary[] = [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, list]) => {
      let opening = 0;
      let income = 0;
      let expense = 0;
      let count = 0;
      const incomeCats = new Map<string, { name: string; total: number; count: number }>();
      const expenseCats = new Map<string, { name: string; total: number; count: number }>();
      for (const statement of list) {
        const entry = state.get(statement.account.id)!;
        opening += entry.openingMinor;
        income += entry.incomeMinor;
        expense += entry.expenseMinor;
        count += statement.count;
        if (!categoriesAvailable) continue;
        for (const row of statement.rows) {
          const target = row.tx.type === "income" ? incomeCats : expenseCats;
          const key = row.tx.categoryId ?? "uncategorized";
          const item = target.get(key) ?? { name: row.categoryName ?? "Uncategorized", total: 0, count: 0 };
          item.total += toMinor(row.tx.amount);
          item.count += 1;
          target.set(key, item);
        }
      }
      return {
        currency,
        accountCount: list.length,
        income: fromMinor(income),
        expense: fromMinor(expense),
        net: fromMinor(income - expense),
        opening: fromMinor(opening),
        closing: fromMinor(opening + income - expense),
        count,
        incomeCategories: rankCategories(incomeCats, income),
        expenseCategories: rankCategories(expenseCats, expense),
      };
    });

  const notes: string[] = [TRANSFERS_NOTE];
  if (!categoriesAvailable) {
    notes.push("Category details are unavailable for some transactions, so category summaries are omitted.");
  }
  if (summaries.length > 1) {
    notes.push("Accounts use different currencies; totals are shown separately per currency and never converted.");
  }
  if (dataset.source.kind === "offline") {
    notes.push(
      dataset.source.pendingChanges > 0
        ? `Generated offline from this device's copy, including ${dataset.source.pendingChanges} change(s) not yet synced.`
        : "Generated offline from this device's last complete copy of your data."
    );
  } else if (dataset.source.pendingChanges > 0) {
    notes.push(
      `${dataset.source.pendingChanges} change(s) saved on this device haven't synced yet and are not included.`
    );
  }

  return {
    title: "Financial Statement",
    period: config.period,
    generatedAt,
    source: dataset.source,
    accountMode: config.accountMode,
    summaries,
    statements,
    rows,
    categoriesAvailable,
    transfersSupported: false,
    notes,
  };
}

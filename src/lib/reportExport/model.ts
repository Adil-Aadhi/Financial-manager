/**
 * The normalized data every export path produces and every exporter consumes.
 *
 * Schema notes (verified against the repository, not assumed):
 * - transactions.type is constrained to 'income' | 'expense'. There is no transfer type, no
 *   transfer table and no pairing column, so the app has no transfers to report. Exports say
 *   so instead of inventing a transfer section.
 * - Account balance = accounts.opening_balance + income − expense (the same formula as the
 *   account details page). Accounts are soft-deleted (deleted_at, Trash); transactions are
 *   hard-deleted, so every stored transaction counts.
 * - Amounts are per-account currency and are never converted or summed across currencies.
 */

import type { ResolvedPeriod } from "@/lib/reportExport/period";

export type ExportFormat = "pdf" | "xlsx" | "csv";
export type AccountMode = "combined" | "single" | "separate";
export type ExportTxType = "income" | "expense";
export type DataSourceKind = "online" | "offline";

export interface ExportAccount {
  id: string;
  name: string;
  accountType: string | null;
  currency: string;
  openingBalance: number;
  trashed: boolean;
  includeInSummary: boolean;
}

export interface ExportCategory {
  id: string;
  name: string;
  type: string;
}

export interface ExportTransaction {
  id: string;
  accountId: string;
  categoryId: string | null;
  type: ExportTxType;
  amount: number;
  description: string | null;
  /** India calendar date, "YYYY-MM-DD". */
  date: string;
  /** "HH:MM" or null when the transaction has no time. */
  time: string | null;
  createdAt: string;
}

export interface AccountActivityTotals {
  income: number;
  expense: number;
}

export interface DataSourceInfo {
  kind: DataSourceKind;
  /** When the data was read (online) or when the offline copy was last fully refreshed. */
  asOf: string;
  /** Local changes not yet on the server: included offline, NOT included online. */
  pendingChanges: number;
  failedChanges: number;
}

/**
 * Everything a report needs, from either source. `transactions` holds only rows inside the
 * period; `priorTotals` holds per-account sums of everything dated before it (for opening
 * balances), so the full history never has to be held in memory for a short period.
 */
export interface ReportDataset {
  accounts: ExportAccount[];
  /** null when category metadata is unavailable (never guessed). */
  categories: ExportCategory[] | null;
  transactions: ExportTransaction[];
  priorTotals: Map<string, AccountActivityTotals>;
  source: DataSourceInfo;
}

export interface ExportConfig {
  period: ResolvedPeriod;
  accountMode: AccountMode;
  /** Required for "single". */
  accountId?: string | null;
  /** Combined/separate: also include accounts marked "exclude from summary". */
  includeExcluded: boolean;
  format: ExportFormat;
}

// ------------------------------------------------------------------ report --

export interface ReportRow {
  tx: ExportTransaction;
  accountName: string;
  currency: string;
  /** null when the category is unknown to the data source. */
  categoryName: string | null;
  /** Account balance after this row (chronological, per account). */
  runningBalance: number;
}

export interface CategorySummary {
  id: string;
  name: string;
  total: number;
  count: number;
  percent: number;
}

export interface CurrencySummary {
  currency: string;
  accountCount: number;
  income: number;
  expense: number;
  net: number;
  opening: number;
  closing: number;
  count: number;
  incomeCategories: CategorySummary[];
  expenseCategories: CategorySummary[];
}

export interface AccountStatement {
  account: ExportAccount;
  opening: number;
  income: number;
  expense: number;
  net: number;
  closing: number;
  count: number;
  rows: ReportRow[];
}

export interface ExportReport {
  title: string;
  period: ResolvedPeriod;
  generatedAt: string;
  source: DataSourceInfo;
  accountMode: AccountMode;
  /** One per currency among the selected accounts (combined totals never mix currencies). */
  summaries: CurrencySummary[];
  statements: AccountStatement[];
  /** Every selected row, chronological. Shares row objects with `statements`. */
  rows: ReportRow[];
  categoriesAvailable: boolean;
  /** Always false: the schema has no transfer representation. */
  transfersSupported: false;
  notes: string[];
}

/**
 * Row mappers shared by the online and offline sources, so both produce identical
 * ReportDataset values from identical rows.
 */

import { normalizeIncludeInSummary } from "@/lib/accountSummary";
import { dateInPeriod, type ResolvedPeriod } from "@/lib/reportExport/period";
import type {
  AccountActivityTotals,
  ExportAccount,
  ExportCategory,
  ExportTransaction,
} from "@/lib/reportExport/model";
import { normalizeTransactionDate } from "@/lib/transactions";

export interface AccountLike {
  id: string;
  name: string;
  account_type?: string | null;
  opening_balance: number | string | null;
  currency: string | null;
  include_in_summary?: boolean | null;
  deleted_at?: string | null;
}

export interface CategoryLike {
  id: string;
  name: string;
  type: string;
}

export interface TransactionLike {
  id: string;
  account_id: string;
  category_id: string | null;
  type: string;
  amount: number | string;
  description: string | null;
  transaction_date: string;
  transaction_time?: string | null;
  created_at: string;
}

export function toExportAccount(row: AccountLike, defaultCurrency: string): ExportAccount {
  return {
    id: String(row.id),
    name: row.name?.trim() || "Unnamed account",
    accountType: row.account_type ?? null,
    currency: row.currency || defaultCurrency,
    openingBalance: Number(row.opening_balance) || 0,
    trashed: Boolean(row.deleted_at),
    includeInSummary: normalizeIncludeInSummary(row.include_in_summary),
  };
}

export function toExportCategory(row: CategoryLike): ExportCategory {
  return { id: String(row.id), name: row.name, type: row.type };
}

/** null when the row can't be reported faithfully (unknown type, unreadable date or amount). */
export function toExportTransaction(row: TransactionLike): ExportTransaction | null {
  if (row.type !== "income" && row.type !== "expense") return null;
  const date = normalizeTransactionDate(row.transaction_date);
  const amount = Number(row.amount);
  if (!date || !Number.isFinite(amount)) return null;
  const time = row.transaction_time ? row.transaction_time.slice(0, 5) : null;
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    categoryId: row.category_id ? String(row.category_id) : null,
    type: row.type,
    amount,
    description: row.description,
    date,
    time: time && /^\d{2}:\d{2}$/.test(time) ? time : null,
    createdAt: row.created_at,
  };
}

/**
 * Split normalized transactions into rows inside the period and per-account totals of
 * everything dated before it (used for opening balances). Rows after the period are dropped.
 */
export function partitionByPeriod(
  transactions: Iterable<ExportTransaction>,
  period: Pick<ResolvedPeriod, "start" | "end">
) {
  const inPeriod: ExportTransaction[] = [];
  const priorTotals = new Map<string, AccountActivityTotals>();
  for (const tx of transactions) {
    if (period.start && tx.date < period.start) {
      const totals = priorTotals.get(tx.accountId) ?? { income: 0, expense: 0 };
      if (tx.type === "income") totals.income = (Math.round(totals.income * 100) + Math.round(tx.amount * 100)) / 100;
      else totals.expense = (Math.round(totals.expense * 100) + Math.round(tx.amount * 100)) / 100;
      priorTotals.set(tx.accountId, totals);
    } else if (dateInPeriod(tx.date, period)) {
      inPeriod.push(tx);
    }
  }
  return { inPeriod, priorTotals };
}

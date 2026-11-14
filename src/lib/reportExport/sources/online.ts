/**
 * Online data source: the browser's authenticated Supabase client (publishable key + the
 * user's session), so row-level security applies to every read. The user id used in every
 * filter comes from the verified session, never from the caller.
 *
 * Reads are paged (Supabase returns at most 1,000 rows per request) and checked against an
 * exact count, so a report is never built from a partial download.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportDataset } from "@/lib/reportExport/model";
import {
  toExportAccount,
  toExportCategory,
  toExportTransaction,
  type AccountLike,
  type CategoryLike,
  type TransactionLike,
} from "@/lib/reportExport/normalize";
import { dayBefore, type ResolvedPeriod } from "@/lib/reportExport/period";
import { transactionDateRangeBounds } from "@/lib/transactions";

export const ONLINE_PAGE_SIZE = 1000;
const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);
const MISSING_COLUMN = "42703";
const EARLIEST = "1000-01-01";

export type ProgressFn = (message: string) => void;

export class ExportAuthError extends Error {}

interface PageError {
  code?: string;
  message: string;
}
interface Page<T> {
  data: T[] | null;
  error: PageError | null;
  count?: number | null;
}

/** Fetch every page; with `exact`, verify the row count matches the server's count. */
async function fetchAll<T>(
  label: string,
  fetchPage: (from: number, to: number, first: boolean) => PromiseLike<Page<T>>,
  onPage?: (loaded: number, total: number | null) => void
) {
  const rows: T[] = [];
  let total: number | null = null;
  for (let from = 0; ; from += ONLINE_PAGE_SIZE) {
    const page = await fetchPage(from, from + ONLINE_PAGE_SIZE - 1, from === 0);
    if (page.error) {
      const error = new Error(`${label}: ${page.error.message}`) as Error & { code?: string };
      error.code = page.error.code;
      throw error;
    }
    if (from === 0 && typeof page.count === "number") total = page.count;
    const data = page.data ?? [];
    rows.push(...data);
    onPage?.(rows.length, total);
    if (data.length < ONLINE_PAGE_SIZE || (total !== null && rows.length >= total)) break;
  }
  if (total !== null && rows.length !== total) {
    throw new Error(`${label} changed while downloading (${rows.length} of ${total}). Try the export again.`);
  }
  return rows;
}

async function fetchAccounts(supabase: SupabaseClient, userId: string) {
  const columns = [
    "id, name, account_type, opening_balance, currency, include_in_summary, deleted_at",
    "id, name, account_type, opening_balance, currency, deleted_at",
    "id, name, account_type, opening_balance, currency",
  ];
  for (const select of columns) {
    try {
      return await fetchAll<AccountLike>("Accounts", (from, to) =>
        supabase.from("accounts").select(select).eq("user_id", userId).order("id").range(from, to) as unknown as PromiseLike<
          Page<AccountLike>
        >
      );
    } catch (error) {
      // Older databases without the summary/trash migrations.
      if ((error as { code?: string }).code !== MISSING_COLUMN) throw error;
    }
  }
  throw new Error("Accounts could not be read.");
}

/** Per-account income/expense before the period, from the existing reports rollup. */
async function fetchPriorTotals(supabase: SupabaseClient, userId: string, start: string) {
  const totals = new Map<string, { income: number; expense: number }>();
  const add = (accountId: string, type: string, amount: number) => {
    if (type !== "income" && type !== "expense") return;
    const entry = totals.get(accountId) ?? { income: 0, expense: 0 };
    entry[type] = (Math.round(entry[type] * 100) + Math.round(amount * 100)) / 100;
    totals.set(accountId, entry);
  };

  try {
    const rows = await fetchAll<{ account_id: string; type: string; total: number | string }>(
      "Balances",
      (from, to, first) =>
        supabase
          .rpc("get_report_rollup", { p_start: EARLIEST, p_end: dayBefore(start) }, first ? { count: "exact" } : undefined)
          .order("month")
          .order("account_id")
          .order("category_id")
          .order("type")
          .range(from, to) as unknown as PromiseLike<Page<{ account_id: string; type: string; total: number | string }>>
    );
    for (const row of rows) add(String(row.account_id), row.type, Number(row.total) || 0);
    return totals;
  } catch (error) {
    if (!MISSING_FUNCTION_CODES.has((error as { code?: string }).code ?? "")) throw error;
  }

  // Without the reports migration: sum the raw rows (three small columns only).
  const bounds = transactionDateRangeBounds(start, start);
  if (!bounds) throw new Error("Invalid report start date.");
  const rows = await fetchAll<{ account_id: string; type: string; amount: number | string }>(
    "Balances",
    (from, to, first) =>
      supabase
        .from("transactions")
        .select("account_id, type, amount", first ? { count: "exact" } : undefined)
        .eq("user_id", userId)
        .lt("transaction_date", bounds.startInclusive)
        .order("id")
        .range(from, to) as unknown as PromiseLike<Page<{ account_id: string; type: string; amount: number | string }>>
  );
  for (const row of rows) add(String(row.account_id), row.type, Number(row.amount) || 0);
  return totals;
}

export async function loadOnlineDataset(options: {
  supabase: SupabaseClient;
  /** The user the page was rendered for; must match the live session. */
  ownerId: string;
  defaultCurrency: string;
  period: Pick<ResolvedPeriod, "start" | "end">;
  pendingChanges?: number;
  failedChanges?: number;
  onProgress?: ProgressFn;
}): Promise<ReportDataset> {
  const { supabase, ownerId, period, onProgress } = options;
  onProgress?.("Checking your session…");
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new ExportAuthError("Your session has expired. Sign in again to export.");
  if (data.user.id !== ownerId) throw new ExportAuthError("You're signed in as a different user. Reload the page and try again.");
  const userId = data.user.id;

  onProgress?.("Loading accounts and categories…");
  const [accountRows, categoryRows] = await Promise.all([
    fetchAccounts(supabase, userId),
    fetchAll<CategoryLike>("Categories", (from, to) =>
      supabase
        .from("categories")
        .select("id, name, type")
        .or(`is_default.eq.true,user_id.eq.${userId}`)
        .order("id")
        .range(from, to) as unknown as PromiseLike<Page<CategoryLike>>
    ),
  ]);

  // Both bounds are set, or neither (All time). Inclusive India-calendar dates as UTC instants,
  // the same conversion the Reports page uses, so the whole end date is included.
  const bounds = period.start && period.end ? transactionDateRangeBounds(period.start, period.end) : null;
  if (period.start && period.end && !bounds) throw new Error("Invalid report date range.");

  onProgress?.("Loading transactions…");
  const txRows = await fetchAll<TransactionLike>(
    "Transactions",
    (from, to, first) => {
      let query = supabase
        .from("transactions")
        .select(
          "id, account_id, category_id, type, amount, description, transaction_date, transaction_time, created_at",
          first ? { count: "exact" } : undefined
        )
        .eq("user_id", userId);
      if (bounds && period.start) query = query.gte("transaction_date", bounds.startInclusive);
      if (bounds && period.end) query = query.lt("transaction_date", bounds.endExclusive);
      return query.order("id").range(from, to) as unknown as PromiseLike<Page<TransactionLike>>;
    },
    (loaded, total) =>
      onProgress?.(total ? `Loading transactions… ${loaded.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}` : "Loading transactions…")
  );

  const transactions = [];
  for (const row of txRows) {
    const tx = toExportTransaction(row);
    if (!tx) throw new Error("A transaction has an unreadable date, type or amount, so a complete report can't be produced.");
    transactions.push(tx);
  }

  let priorTotals = new Map<string, { income: number; expense: number }>();
  if (period.start) {
    onProgress?.("Calculating opening balances…");
    priorTotals = await fetchPriorTotals(supabase, userId, period.start);
  }

  return {
    accounts: accountRows.map((row) => toExportAccount(row, options.defaultCurrency)),
    categories: categoryRows.map(toExportCategory),
    transactions,
    priorTotals,
    source: {
      kind: "online",
      asOf: new Date().toISOString(),
      pendingChanges: options.pendingChanges ?? 0,
      failedChanges: options.failedChanges ?? 0,
    },
  };
}

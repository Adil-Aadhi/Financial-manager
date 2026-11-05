import type { createClient } from "@/lib/supabase/server";
import type {
  ReportAccountMeta,
  ReportCategoryMeta,
  ReportRange,
  ReportRollupRow,
} from "@/lib/reports";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export interface ReportSource {
  rows: ReportRollupRow[];
  accounts: ReportAccountMeta[];
  categories: ReportCategoryMeta[];
  /** true when the rollup came from the database function. */
  aggregatedInDatabase: boolean;
}

const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);
const FALLBACK_PAGE_SIZE = 1000;
const FALLBACK_MAX_ROWS = 20_000;

/**
 * Without the reports migration: read only the columns needed, page by page,
 * and group them on the server into the same shape as get_report_rollup.
 * Nothing is sent to the client.
 */
async function fallbackRollup(
  supabase: ServerClient,
  userId: string,
  range: Pick<ReportRange, "start" | "end">
): Promise<ReportRollupRow[]> {
  const groups = new Map<string, ReportRollupRow>();

  for (let from = 0; from < FALLBACK_MAX_ROWS; from += FALLBACK_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("account_id, category_id, type, amount, transaction_date")
      .eq("user_id", userId)
      .gte("transaction_date", range.start)
      .lte("transaction_date", `${range.end}T23:59:59.999`)
      .order("id")
      .range(from, from + FALLBACK_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const month = `${String(row.transaction_date).slice(0, 7)}-01`;
      const key = `${row.account_id}|${row.category_id}|${row.type}|${month}`;
      const group = groups.get(key) ?? {
        account_id: String(row.account_id),
        category_id: row.category_id ? String(row.category_id) : null,
        type: String(row.type),
        month,
        total: 0,
        tx_count: 0,
      };
      group.total = Number(group.total) + (Number(row.amount) || 0);
      group.tx_count = Number(group.tx_count) + 1;
      groups.set(key, group);
    }

    if (!data || data.length < FALLBACK_PAGE_SIZE) break;
  }

  return [...groups.values()];
}

/** Rollup rows plus the account and category metadata needed to label them. */
export async function getReportSource(
  supabase: ServerClient,
  userId: string,
  range: Pick<ReportRange, "start" | "end">
): Promise<ReportSource> {
  const [rollupResult, accountsResult, categoriesResult] = await Promise.all([
    supabase.rpc("get_report_rollup", { p_start: range.start, p_end: range.end }),
    // All accounts, including ones in Trash: their history still counts.
    supabase.from("accounts").select("id, name, currency, deleted_at").eq("user_id", userId),
    supabase
      .from("categories")
      .select("id, name, icon")
      .or(`is_default.eq.true,user_id.eq.${userId}`),
  ]);

  let accountRows = accountsResult.data as
    | { id: string; name: string; currency: string | null; deleted_at?: string | null }[]
    | null;
  if (accountsResult.error?.code === "42703") {
    // Account-trash migration not applied: no deleted_at column yet.
    const legacy = await supabase.from("accounts").select("id, name, currency").eq("user_id", userId);
    if (legacy.error) throw new Error(legacy.error.message);
    accountRows = legacy.data;
  } else if (accountsResult.error) {
    throw new Error(accountsResult.error.message);
  }
  if (categoriesResult.error) throw new Error(categoriesResult.error.message);

  let rows: ReportRollupRow[];
  let aggregatedInDatabase = true;
  if (rollupResult.error) {
    if (!MISSING_FUNCTION_CODES.has(rollupResult.error.code ?? "")) {
      throw new Error(rollupResult.error.message);
    }
    rows = await fallbackRollup(supabase, userId, range);
    aggregatedInDatabase = false;
  } else {
    rows = (rollupResult.data ?? []) as ReportRollupRow[];
  }

  return {
    rows,
    aggregatedInDatabase,
    accounts: (accountRows ?? []).map((account) => ({
      id: String(account.id),
      name: account.name,
      currency: account.currency,
      trashed: Boolean(account.deleted_at),
    })),
    categories: (categoriesResult.data ?? []).map((category) => ({
      id: String(category.id),
      name: category.name,
      icon: category.icon,
    })),
  };
}

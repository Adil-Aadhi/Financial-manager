import type { createClient } from "@/lib/supabase/server";
import type { MonthRange } from "@/lib/month";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export interface MonthlyBudgetOverview {
  /** false when the monthly-budget migration has not been applied yet. */
  available: boolean;
  /** null when the user has not set a budget. */
  limit: number | null;
  /** This month's expenses in the budget currency, across all accounts. */
  spent: number;
  /** Expenses this month in accounts using another currency (not summed). */
  otherCurrencyCount: number;
}

const MISSING_OBJECT_CODES = new Set(["42P01", "PGRST205", "42883", "PGRST202"]);

/**
 * Loads the budget limit and this month's expense total in two small queries.
 * The total is aggregated in Postgres (get_monthly_expense_summary), so no
 * transaction rows are sent to the server or client.
 */
export async function getMonthlyBudgetOverview(
  supabase: ServerClient,
  userId: string,
  currency: string,
  month: MonthRange
): Promise<MonthlyBudgetOverview> {
  const [budgetResult, summaryResult] = await Promise.all([
    supabase.from("monthly_budgets").select("amount").eq("user_id", userId).maybeSingle(),
    supabase
      .rpc("get_monthly_expense_summary", {
        p_month_start: month.start,
        p_month_end: month.end,
        p_currency: currency,
      })
      .maybeSingle(),
  ]);

  const missing =
    MISSING_OBJECT_CODES.has(budgetResult.error?.code ?? "") ||
    MISSING_OBJECT_CODES.has(summaryResult.error?.code ?? "");
  if (missing) return { available: false, limit: null, spent: 0, otherCurrencyCount: 0 };

  if (budgetResult.error) console.error("Error fetching monthly budget:", budgetResult.error.message);
  if (summaryResult.error) {
    console.error("Error fetching monthly expense summary:", summaryResult.error.message);
  }

  const summary = summaryResult.data as
    | { total_spent: number | string | null; other_currency_count: number | null }
    | null;

  return {
    available: true,
    limit: budgetResult.data ? Number(budgetResult.data.amount) || null : null,
    spent: Number(summary?.total_spent) || 0,
    otherCurrencyCount: Number(summary?.other_currency_count) || 0,
  };
}

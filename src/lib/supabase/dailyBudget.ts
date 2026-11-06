import type { createClient } from "@/lib/supabase/server";
import type { DailyExpenseRecord, DailyLimitRecord } from "@/lib/dailyBudget";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export interface DailyBudgetServerData {
  /** false when the daily-budget migration has not been applied yet. */
  available: boolean;
  limits: DailyLimitRecord[];
  expenses: DailyExpenseRecord[];
}

const MISSING_OBJECT_CODES = new Set(["42P01", "PGRST205"]);
const PAGE_SIZE = 1000;

/**
 * The first render's data for the Home card and the Daily Budget page. Pages show IndexedDB
 * data as soon as the device copy is ready; this is only the server fallback.
 * `fromDate` limits expenses (the Home card only needs the current month).
 */
export async function getDailyBudgetServerData(
  supabase: ServerClient,
  userId: string,
  fromDate?: string
): Promise<DailyBudgetServerData> {
  const limitsResult = await supabase
    .from("daily_budget_limits")
    .select("effective_date, amount")
    .eq("user_id", userId)
    .order("effective_date");
  if (MISSING_OBJECT_CODES.has(limitsResult.error?.code ?? "")) {
    return { available: false, limits: [], expenses: [] };
  }
  if (limitsResult.error) console.error("Error fetching daily budget limits:", limitsResult.error.message);

  const expenses: DailyExpenseRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from("daily_budget_expenses")
      .select("id, expense_date, amount, description, created_at, updated_at")
      .eq("user_id", userId);
    if (fromDate) query = query.gte("expense_date", fromDate);
    const page = await query.order("id").range(from, from + PAGE_SIZE - 1);
    if (page.error) {
      if (MISSING_OBJECT_CODES.has(page.error.code ?? "")) return { available: false, limits: [], expenses: [] };
      console.error("Error fetching daily budget expenses:", page.error.message);
      break;
    }
    expenses.push(...((page.data ?? []) as DailyExpenseRecord[]));
    if ((page.data ?? []).length < PAGE_SIZE) break;
  }

  return { available: true, limits: (limitsResult.data ?? []) as DailyLimitRecord[], expenses };
}

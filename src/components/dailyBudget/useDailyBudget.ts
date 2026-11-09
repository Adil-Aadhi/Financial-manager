"use client";

import { useLiveQuery } from "dexie-react-hooks";
import type { DailyExpenseRecord, DailyLimitRecord } from "@/lib/dailyBudget";
import { offlineDb } from "@/lib/offline/db";
import { useOfflineRefresh } from "@/lib/offline/useOfflineRefresh";
import type { DailyBudgetServerData } from "@/lib/supabase/dailyBudget";
import { useIndiaToday } from "@/lib/useIndiaToday";

export interface DailyBudgetData {
  /** "local": read from this device (works offline). "server": first-render fallback. */
  source: "local" | "server";
  available: boolean;
  limits: DailyLimitRecord[];
  expenses: DailyExpenseRecord[];
}

/**
 * The user's limit history and manual expenses, from IndexedDB once the device copy is ready
 * (so it works offline and shows pending changes immediately), otherwise the server data.
 */
export function useDailyBudgetData(ownerId: string, server: DailyBudgetServerData): DailyBudgetData {
  const serverVersion = [
    server.available,
    ...server.limits.map((limit) => `${limit.effective_date}:${limit.amount}`),
    ...server.expenses.map((expense) => `${expense.id}:${expense.amount}:${expense.expense_date}:${expense.updated_at ?? ""}`),
  ].join("|");
  useOfflineRefresh(ownerId, serverVersion, "the daily budget");

  const local = useLiveQuery(async () => {
    const meta = await offlineDb.syncMeta.get(ownerId);
    // An older device copy (before this feature) has no daily-budget flag yet: keep showing
    // the server data until the next refresh fills it in.
    if (!meta?.totalsMatch || meta.dailyBudgetAvailable === undefined) return null;
    const [limits, expenses] = await Promise.all([
      offlineDb.dailyBudgetLimits.where("ownerId").equals(ownerId).toArray(),
      offlineDb.dailyBudgetExpenses.where("ownerId").equals(ownerId).toArray(),
    ]);
    return { available: meta.dailyBudgetAvailable, limits, expenses };
  }, [ownerId]);

  if (local) return { source: "local", ...local };
  return { source: "server", ...server };
}

/** Today's date in India, kept current if the app stays open past midnight. */
export function useDailyBudgetToday(initial: string) {
  return useIndiaToday(initial);
}

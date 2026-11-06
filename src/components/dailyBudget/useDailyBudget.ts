"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { dailyBudgetToday, type DailyExpenseRecord, type DailyLimitRecord } from "@/lib/dailyBudget";
import { offlineDb } from "@/lib/offline/db";
import { useOfflineRefresh } from "@/lib/offline/useOfflineRefresh";
import type { DailyBudgetServerData } from "@/lib/supabase/dailyBudget";

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
  const [today, setToday] = useState(initial);
  useEffect(() => {
    const tick = () => setToday(dailyBudgetToday());
    // The server's date can be stale (a page saved for offline use yesterday), so re-check
    // straight after mounting, then every minute.
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return today;
}

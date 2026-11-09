"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { offlineDb } from "@/lib/offline/db";
import { useOfflineRefresh } from "@/lib/offline/useOfflineRefresh";
import type { BillsServerData } from "@/lib/supabase/bills";
import { useIndiaToday } from "@/lib/useIndiaToday";

export function useBillsData(ownerId: string, server: BillsServerData) {
  const version = [server.available, ...server.bills.map((bill) => `${bill.id}:${bill.next_due_date}:${bill.lifecycle}:${bill.updated_at ?? ""}`), ...server.payments.map((payment) => `${payment.id}:${payment.actual_amount}:${payment.updated_at ?? ""}`)].join("|");
  useOfflineRefresh(ownerId, version, "bills");
  const local = useLiveQuery(async () => {
    const meta = await offlineDb.syncMeta.get(ownerId);
    if (!meta?.totalsMatch || meta.billsAvailable === undefined) return null;
    const [bills, payments] = await Promise.all([
      offlineDb.bills.where("ownerId").equals(ownerId).toArray(),
      offlineDb.billPayments.where("ownerId").equals(ownerId).toArray(),
    ]);
    return { available: meta.billsAvailable, bills, payments };
  }, [ownerId]);
  return local ? { source: "local" as const, ...local } : { source: "server" as const, ...server };
}

export function useBillToday(initial: string) {
  return useIndiaToday(initial);
}

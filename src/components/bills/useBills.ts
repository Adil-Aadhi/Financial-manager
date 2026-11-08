"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { billToday } from "@/lib/bills";
import { offlineDb } from "@/lib/offline/db";
import { useOfflineRefresh } from "@/lib/offline/useOfflineRefresh";
import type { BillsServerData } from "@/lib/supabase/bills";

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
  const [today, setToday] = useState(initial);
  useEffect(() => {
    const tick = () => setToday(billToday());
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, []);
  return today;
}

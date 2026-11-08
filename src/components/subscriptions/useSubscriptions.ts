"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { offlineDb } from "@/lib/offline/db";
import { useOfflineRefresh } from "@/lib/offline/useOfflineRefresh";
import type { SubscriptionsServerData } from "@/lib/supabase/subscriptions";
import { subscriptionToday } from "@/lib/subscriptions";

export function useSubscriptionsData(ownerId: string, server: SubscriptionsServerData) {
  const version = [
    server.available,
    ...server.subscriptions.map((item) => `${item.id}:${item.next_payment_date}:${item.lifecycle}:${item.updated_at ?? ""}`),
    ...server.payments.map((payment) => `${payment.id}:${payment.due_date}:${payment.paid_at}`),
  ].join("|");
  useOfflineRefresh(ownerId, version, "subscriptions");

  const local = useLiveQuery(async () => {
    const meta = await offlineDb.syncMeta.get(ownerId);
    if (!meta?.totalsMatch || meta.subscriptionsAvailable === undefined) return null;
    const [subscriptions, payments] = await Promise.all([
      offlineDb.subscriptions.where("ownerId").equals(ownerId).toArray(),
      offlineDb.subscriptionPayments.where("ownerId").equals(ownerId).toArray(),
    ]);
    return { available: meta.subscriptionsAvailable, subscriptions, payments };
  }, [ownerId]);

  return local ? { source: "local" as const, ...local } : { source: "server" as const, ...server };
}

export function useSubscriptionToday(initial: string) {
  const [today, setToday] = useState(initial);
  useEffect(() => {
    const tick = () => setToday(subscriptionToday());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 60_000);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return today;
}

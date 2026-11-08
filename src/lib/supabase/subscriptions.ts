import type { createClient } from "@/lib/supabase/server";
import type { SubscriptionPaymentRecord, SubscriptionRecord } from "@/lib/subscriptions";

type ServerClient = Awaited<ReturnType<typeof createClient>>;
const MISSING_OBJECT_CODES = new Set(["42P01", "PGRST205"]);
const PAGE_SIZE = 1000;

export interface SubscriptionsServerData {
  available: boolean;
  subscriptions: SubscriptionRecord[];
  payments: SubscriptionPaymentRecord[];
}

export async function getSubscriptionsServerData(
  supabase: ServerClient,
  userId: string
): Promise<SubscriptionsServerData> {
  const subscriptionsResult = await supabase
    .from("subscriptions")
    .select("id, user_id, name, icon, amount, currency, billing_cycle, billing_anchor_day, start_date, next_payment_date, lifecycle, notes, created_at, updated_at")
    .eq("user_id", userId)
    .order("next_payment_date");
  if (MISSING_OBJECT_CODES.has(subscriptionsResult.error?.code ?? "")) {
    return { available: false, subscriptions: [], payments: [] };
  }
  if (subscriptionsResult.error) {
    console.error("Error fetching subscriptions:", subscriptionsResult.error.message);
    return { available: true, subscriptions: [], payments: [] };
  }

  const payments: SubscriptionPaymentRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await supabase
      .from("subscription_payments")
      .select("id, user_id, subscription_id, due_date, paid_at, created_at, updated_at")
      .eq("user_id", userId)
      .order("due_date", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (page.error) {
      if (MISSING_OBJECT_CODES.has(page.error.code ?? "")) return { available: false, subscriptions: [], payments: [] };
      console.error("Error fetching subscription payments:", page.error.message);
      break;
    }
    payments.push(...((page.data ?? []) as SubscriptionPaymentRecord[]));
    if ((page.data ?? []).length < PAGE_SIZE) break;
  }

  return {
    available: true,
    subscriptions: (subscriptionsResult.data ?? []) as SubscriptionRecord[],
    payments,
  };
}

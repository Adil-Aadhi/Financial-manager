import type { createClient } from "@/lib/supabase/server";
import type { BillPaymentRecord, BillRecord } from "@/lib/bills";

type ServerClient = Awaited<ReturnType<typeof createClient>>;
const MISSING_OBJECT_CODES = new Set(["42P01", "PGRST205", "42703"]);
const PAGE_SIZE = 1000;
export const BILL_SELECT = "id, user_id, name, category, icon, amount_type, expected_amount, currency, billing_cycle, billing_interval, billing_anchor_day, start_date, next_due_date, reminder_days, lifecycle, notes, created_at, updated_at";
export const BILL_PAYMENT_SELECT = "id, user_id, bill_id, due_date, expected_amount, actual_amount, payment_date, paid_at, status, created_at, updated_at";

export interface BillsServerData {
  available: boolean;
  bills: BillRecord[];
  payments: BillPaymentRecord[];
}

export async function getBillsServerData(supabase: ServerClient, userId: string): Promise<BillsServerData> {
  const billsResult = await supabase.from("bills").select(BILL_SELECT).eq("user_id", userId).order("next_due_date");
  if (MISSING_OBJECT_CODES.has(billsResult.error?.code ?? "")) return { available: false, bills: [], payments: [] };
  if (billsResult.error) {
    console.error("Error fetching bills:", billsResult.error.message);
    return { available: true, bills: [], payments: [] };
  }
  const payments: BillPaymentRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await supabase.from("bill_payments").select(BILL_PAYMENT_SELECT).eq("user_id", userId)
      .order("due_date", { ascending: false }).range(from, from + PAGE_SIZE - 1);
    if (page.error) {
      if (MISSING_OBJECT_CODES.has(page.error.code ?? "")) return { available: false, bills: [], payments: [] };
      console.error("Error fetching bill payments:", page.error.message);
      break;
    }
    payments.push(...((page.data ?? []) as BillPaymentRecord[]));
    if ((page.data ?? []).length < PAGE_SIZE) break;
  }
  return { available: true, bills: (billsResult.data ?? []) as BillRecord[], payments };
}

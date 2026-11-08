"use server";

import { revalidatePath } from "next/cache";
import { runSyncBatch } from "@/lib/server/syncApply";
import { createClient } from "@/lib/supabase/server";
import type { BillAmountType, BillCategory, BillCycle, BillIconName, BillLifecycle } from "@/lib/bills";
import type { SyncOp, SyncOperation } from "@/lib/sync/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function runOne(entity: "bill" | "bill_payment", entityId: string, op: SyncOp, payload: Record<string, unknown>) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in to change bills." };
  const operation: SyncOperation = { opId: crypto.randomUUID(), seq: 1, ownerId: user.id, entity, entityId, op, payload, baseUpdatedAt: null, editedAt: new Date().toISOString() };
  const response = await runSyncBatch(supabase, user.id, [operation]);
  const result = response.results[0];
  if (response.status !== "ok" || !result) return { success: false, error: response.error ?? "Unable to save this bill." };
  if (result.status === "applied" || result.status === "already-applied") {
    revalidatePath("/home");
    revalidatePath("/bills");
    return { success: true };
  }
  return { success: false, error: result.error ?? "Unable to save this bill." };
}

export interface BillActionInput {
  id: string; name: string; category: BillCategory; icon: BillIconName; amountType: BillAmountType;
  expectedAmount: number | null; currency: string; billingCycle: BillCycle; billingInterval: number;
  billingAnchorDay: number; startDate: string; nextDueDate: string; reminderDays: number;
  lifecycle: BillLifecycle; notes: string;
}

function billPayload(input: BillActionInput) {
  return {
    name: input.name, category: input.category, icon: input.icon, amount_type: input.amountType,
    expected_amount: input.expectedAmount, currency: input.currency, billing_cycle: input.billingCycle,
    billing_interval: input.billingCycle.startsWith("custom_") ? input.billingInterval : 1,
    billing_anchor_day: input.billingAnchorDay, start_date: input.startDate, next_due_date: input.nextDueDate,
    reminder_days: input.reminderDays, lifecycle: input.lifecycle, notes: input.notes,
  };
}

export async function createBillAction(input: BillActionInput) {
  if (!UUID.test(input.id)) return { success: false, error: "Invalid bill." };
  return runOne("bill", input.id, "CREATE", billPayload(input));
}
export async function updateBillAction(input: BillActionInput) {
  if (!UUID.test(input.id)) return { success: false, error: "Invalid bill." };
  return runOne("bill", input.id, "UPDATE", billPayload(input));
}
export async function setBillLifecycleAction(id: string, lifecycle: BillLifecycle) {
  if (!UUID.test(id)) return { success: false, error: "Invalid bill." };
  return runOne("bill", id, "UPDATE", { lifecycle });
}
export async function deleteBillAction(id: string) {
  if (!UUID.test(id)) return { success: false, error: "Invalid bill." };
  return runOne("bill", id, "DELETE", { id });
}

export interface BillPaymentActionInput { paymentId: string; billId: string; dueDate: string; actualAmount: number; paymentDate: string; paidAt?: string }
export async function createBillPaymentAction(input: BillPaymentActionInput) {
  if (!UUID.test(input.paymentId) || !UUID.test(input.billId)) return { success: false, error: "Invalid bill payment." };
  return runOne("bill_payment", input.paymentId, "CREATE", { bill_id: input.billId, due_date: input.dueDate, actual_amount: input.actualAmount, payment_date: input.paymentDate, paid_at: input.paidAt });
}
export async function updateBillPaymentAction(input: BillPaymentActionInput) {
  if (!UUID.test(input.paymentId) || !UUID.test(input.billId)) return { success: false, error: "Invalid bill payment." };
  return runOne("bill_payment", input.paymentId, "UPDATE", { actual_amount: input.actualAmount, payment_date: input.paymentDate });
}
export async function deleteBillPaymentAction(paymentId: string, billId: string) {
  if (!UUID.test(paymentId) || !UUID.test(billId)) return { success: false, error: "Invalid bill payment." };
  return runOne("bill_payment", paymentId, "DELETE", { bill_id: billId });
}

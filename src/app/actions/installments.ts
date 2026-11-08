"use server";

import { revalidatePath } from "next/cache";
import { runSyncBatch } from "@/lib/server/syncApply";
import { createClient } from "@/lib/supabase/server";
import type { InstallmentLifecycle, InstallmentPlanInput } from "@/lib/installments";
import type { LocalInstallmentPaymentInput } from "@/lib/offline/mutations";
import type { SyncOp, SyncOperation } from "@/lib/sync/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Online path. Each action sends exactly one operation through the same runSyncBatch code the
 * offline outbox uses, so validation, idempotency and the atomic payment + transaction write are
 * identical whether the change was made online or replayed after reconnecting.
 */
async function runOne(entity: "installment_plan" | "installment_payment", entityId: string, op: SyncOp, payload: Record<string, unknown>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in to change installments." };
  const operation: SyncOperation = {
    opId: crypto.randomUUID(),
    seq: 1,
    ownerId: user.id,
    entity,
    entityId,
    op,
    payload,
    baseUpdatedAt: null,
    editedAt: new Date().toISOString(),
  };
  const response = await runSyncBatch(supabase, user.id, [operation]);
  const result = response.results[0];
  if (response.status !== "ok" || !result) return { success: false, error: response.error ?? "Unable to save this change." };
  if (result.status === "applied" || result.status === "already-applied") {
    revalidatePath("/home");
    revalidatePath("/installments");
    if (entity === "installment_payment") {
      revalidatePath("/transactions");
      revalidatePath("/reports");
      revalidatePath("/accounts/[id]", "page");
    }
    return { success: true };
  }
  return { success: false, error: result.error ?? "Unable to save this change." };
}

export interface InstallmentPlanActionInput extends InstallmentPlanInput {
  id: string;
}

function planPayload(input: InstallmentPlanInput) {
  return {
    name: input.name,
    description: input.description,
    plan_type: input.planType,
    provider: input.provider,
    product_category: input.productCategory,
    icon: input.icon,
    original_amount: input.originalAmount,
    down_payment: input.downPayment,
    interest_amount: input.interestAmount,
    additional_fees: input.additionalFees,
    currency: input.currency,
    installment_count: input.installmentCount,
    default_installment_amount: input.defaultInstallmentAmount,
    billing_cycle: input.billingCycle,
    billing_interval: input.billingCycle.startsWith("custom_") ? input.billingInterval : 1,
    start_date: input.startDate,
    first_due_date: input.firstDueDate,
    reminder_days: input.reminderDays,
    notes: input.notes,
  };
}

export async function createInstallmentPlanAction(input: InstallmentPlanActionInput) {
  if (!UUID.test(input.id)) return { success: false, error: "Invalid installment plan." };
  return runOne("installment_plan", input.id, "CREATE", planPayload(input));
}

export async function updateInstallmentPlanAction(input: InstallmentPlanActionInput) {
  if (!UUID.test(input.id)) return { success: false, error: "Invalid installment plan." };
  return runOne("installment_plan", input.id, "UPDATE", planPayload(input));
}

export async function setInstallmentPlanLifecycleAction(id: string, lifecycle: InstallmentLifecycle) {
  if (!UUID.test(id)) return { success: false, error: "Invalid installment plan." };
  if (lifecycle === "completed") return { success: false, error: "Choose a valid plan state." };
  return runOne("installment_plan", id, "UPDATE", { lifecycle });
}

export async function deleteInstallmentPlanAction(id: string) {
  if (!UUID.test(id)) return { success: false, error: "Invalid installment plan." };
  return runOne("installment_plan", id, "DELETE", { id });
}

export async function saveInstallmentPaymentAction(input: LocalInstallmentPaymentInput, isNew: boolean) {
  if (!UUID.test(input.paymentId) || !UUID.test(input.planId)) return { success: false, error: "Invalid installment payment." };
  return runOne("installment_payment", input.paymentId, isNew ? "CREATE" : "UPDATE", {
    installment_plan_id: input.planId,
    installment_number: input.installmentNumber,
    kind: input.kind,
    covers_through: input.coversThrough,
    actual_amount: input.actualAmount,
    payment_date: input.paymentDate,
    payment_method: input.paymentMethod,
    account_id: input.paymentMethod === "account" ? input.accountId : null,
    transaction_id: input.paymentMethod === "account" ? input.transactionId : null,
    transaction_origin: input.paymentMethod === "account" ? input.transactionOrigin : null,
    notes: input.notes,
    paid_at: input.paidAt,
    transaction_time: input.transactionTime || null,
  });
}

export async function deleteInstallmentPaymentAction(paymentId: string) {
  if (!UUID.test(paymentId)) return { success: false, error: "Invalid installment payment." };
  return runOne("installment_payment", paymentId, "DELETE", {});
}

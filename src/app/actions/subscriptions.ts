"use server";

import { revalidatePath } from "next/cache";
import { runSyncBatch } from "@/lib/server/syncApply";
import { createClient } from "@/lib/supabase/server";
import type { BillingCycle, SubscriptionIconName, SubscriptionLifecycle } from "@/lib/subscriptions";
import type { SyncOp, SyncOperation } from "@/lib/sync/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function runOne(
  entity: "subscription" | "subscription_payment",
  entityId: string,
  op: SyncOp,
  payload: Record<string, unknown>
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in to change subscriptions." };
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
  if (response.status !== "ok" || !result) return { success: false, error: response.error ?? "Unable to save this subscription." };
  if (result.status === "applied" || result.status === "already-applied") {
    revalidatePath("/home");
    revalidatePath("/subscriptions");
    return { success: true };
  }
  return { success: false, error: result.error ?? "Unable to save this subscription." };
}

export interface SubscriptionActionInput {
  id: string;
  name: string;
  icon: SubscriptionIconName;
  amount: number;
  currency: string;
  billingCycle: BillingCycle;
  billingAnchorDay: number;
  startDate: string;
  nextPaymentDate: string;
  lifecycle: SubscriptionLifecycle;
  notes: string;
}

function payload(input: SubscriptionActionInput) {
  return {
    name: input.name,
    icon: input.icon,
    amount: input.amount,
    currency: input.currency,
    billing_cycle: input.billingCycle,
    billing_anchor_day: input.billingAnchorDay,
    start_date: input.startDate,
    next_payment_date: input.nextPaymentDate,
    lifecycle: input.lifecycle,
    notes: input.notes,
  };
}

export async function createSubscriptionAction(input: SubscriptionActionInput) {
  if (!UUID.test(input.id)) return { success: false, error: "Invalid subscription." };
  return runOne("subscription", input.id, "CREATE", payload(input));
}

export async function updateSubscriptionAction(input: SubscriptionActionInput) {
  if (!UUID.test(input.id)) return { success: false, error: "Invalid subscription." };
  return runOne("subscription", input.id, "UPDATE", payload(input));
}

export async function setSubscriptionLifecycleAction(id: string, lifecycle: SubscriptionLifecycle) {
  if (!UUID.test(id)) return { success: false, error: "Invalid subscription." };
  return runOne("subscription", id, "UPDATE", { lifecycle });
}

export async function deleteSubscriptionAction(id: string) {
  if (!UUID.test(id)) return { success: false, error: "Invalid subscription." };
  return runOne("subscription", id, "DELETE", { id });
}

export async function markSubscriptionPaidAction(input: {
  paymentId: string;
  subscriptionId: string;
  dueDate: string;
  paidAt: string;
}) {
  if (!UUID.test(input.paymentId) || !UUID.test(input.subscriptionId)) {
    return { success: false, error: "Invalid payment." };
  }
  return runOne("subscription_payment", input.paymentId, "CREATE", {
    subscription_id: input.subscriptionId,
    due_date: input.dueDate,
    paid_at: input.paidAt,
  });
}

export async function undoSubscriptionPaymentAction(input: {
  paymentId: string;
  subscriptionId: string;
  dueDate: string;
}) {
  if (!UUID.test(input.paymentId) || !UUID.test(input.subscriptionId)) {
    return { success: false, error: "Invalid payment." };
  }
  return runOne("subscription_payment", input.paymentId, "DELETE", {
    subscription_id: input.subscriptionId,
    due_date: input.dueDate,
  });
}

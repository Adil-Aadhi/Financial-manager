"use server";

import { revalidatePath } from "next/cache";
import { isDateKey } from "@/lib/dailyBudget";
import { runSyncBatch } from "@/lib/server/syncApply";
import { createClient } from "@/lib/supabase/server";
import type { SyncOp, SyncOperation } from "@/lib/sync/types";

/**
 * Online path of the Daily Budget Tracker. Each action is one operation through the same
 * runSyncBatch used to replay offline changes, so online and offline writes share exactly the
 * same validation, ownership checks and idempotency (a resent create with the same client id
 * is recognised as already applied, so a double submit can't add an expense twice).
 *
 * Only daily_budget_expenses and daily_budget_limits are written.
 */

export interface DailyBudgetActionResult {
  success: boolean;
  error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function runOne(
  entity: "daily_expense" | "daily_limit",
  entityId: string,
  op: SyncOp,
  payload: Record<string, unknown>
): Promise<DailyBudgetActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in to change your daily budget." };

  const operation: SyncOperation = {
    opId: crypto.randomUUID(),
    seq: 1,
    ownerId: user.id,
    entity,
    entityId,
    op,
    payload,
    // Direct online edit: there is no older device version to compare against.
    baseUpdatedAt: null,
    editedAt: new Date().toISOString(),
  };
  const response = await runSyncBatch(supabase, user.id, [operation]);
  const result = response.results[0];
  if (response.status !== "ok" || !result) {
    return { success: false, error: response.error ?? "Unable to save your daily budget." };
  }
  if (result.status === "applied" || result.status === "already-applied") {
    revalidatePath("/home");
    revalidatePath("/daily-budget");
    return { success: true };
  }
  return { success: false, error: result.error ?? "Unable to save your daily budget." };
}

export async function addDailyExpenseAction(input: {
  id: string;
  amount: number;
  expenseDate: string;
  description: string;
}) {
  if (!UUID.test(input.id)) return { success: false, error: "Invalid expense." };
  return runOne("daily_expense", input.id, "CREATE", {
    expense_date: input.expenseDate,
    amount: input.amount,
    description: input.description,
  });
}

export async function updateDailyExpenseAction(input: {
  expenseId: string;
  amount: number;
  expenseDate: string;
  description: string;
}) {
  if (!UUID.test(input.expenseId)) return { success: false, error: "Invalid expense." };
  return runOne("daily_expense", input.expenseId, "UPDATE", {
    expense_date: input.expenseDate,
    amount: input.amount,
    description: input.description,
  });
}

export async function deleteDailyExpenseAction(expenseId: string) {
  if (!UUID.test(expenseId)) return { success: false, error: "Invalid expense." };
  return runOne("daily_expense", expenseId, "DELETE", { id: expenseId });
}

export async function setDailyLimitAction(input: { amount: number; effectiveDate: string }) {
  if (!isDateKey(input.effectiveDate)) return { success: false, error: "Choose a valid date." };
  return runOne("daily_limit", input.effectiveDate, "UPDATE", {
    effective_date: input.effectiveDate,
    amount: input.amount,
  });
}

export async function deleteDailyLimitAction(effectiveDate: string) {
  if (!isDateKey(effectiveDate)) return { success: false, error: "Choose a valid date." };
  return runOne("daily_limit", effectiveDate, "DELETE", { effective_date: effectiveDate });
}

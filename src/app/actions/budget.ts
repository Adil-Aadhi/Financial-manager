"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateBudgetAmount } from "@/lib/budget";

export interface BudgetActionResult {
  success: boolean;
  error?: string;
  amount?: number;
}

/** Create or update the signed-in user's single monthly budget. */
export async function saveMonthlyBudgetAction(amount: number): Promise<BudgetActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in to set a budget." };

  const value = typeof amount === "number" ? Math.round(amount * 100) / 100 : Number.NaN;
  const validationError = validateBudgetAmount(value);
  if (validationError) return { success: false, error: validationError };

  // Ownership comes from the session, never from the client. The unique
  // user_id constraint makes repeated submissions update the same row.
  const { data, error } = await supabase
    .from("monthly_budgets")
    .upsert({ user_id: user.id, amount: value }, { onConflict: "user_id" })
    .select("amount")
    .single();

  if (error || !data) {
    console.error("Database error saving monthly budget:", error?.message);
    const missingTable = error?.code === "42P01" || error?.code === "PGRST205";
    return {
      success: false,
      error: missingTable
        ? "Run the monthly-budget migration before setting a budget."
        : "Unable to save your budget.",
    };
  }

  revalidatePath("/home");
  return { success: true, amount: Number(data.amount) };
}

/** Remove the signed-in user's monthly budget. Transactions are untouched. */
export async function deleteMonthlyBudgetAction(): Promise<BudgetActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in to remove a budget." };

  const { error } = await supabase.from("monthly_budgets").delete().eq("user_id", user.id);

  if (error) {
    console.error("Database error removing monthly budget:", error.message);
    return { success: false, error: "Unable to remove your budget." };
  }

  revalidatePath("/home");
  return { success: true };
}

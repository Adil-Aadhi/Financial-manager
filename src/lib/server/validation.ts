import type { createClient } from "@/lib/supabase/server";
import { transactionFieldsError, type TransactionFields } from "@/lib/validation/rules";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Full transaction validation used by both createTransactionAction/updateTransactionAction
 * and the offline sync action: field rules plus "is this one of your active accounts" and
 * "is this an available category of the same type". Moved here unchanged from
 * src/app/actions/transactions.ts so the two paths can never drift apart.
 */
export async function validateTransactionInput(
  input: TransactionFields,
  userId: string,
  supabase: ServerClient
) {
  const fieldError = transactionFieldsError(input);
  if (fieldError) return fieldError;

  const [accountResult, categoryResult] = await Promise.all([
    supabase
      .from("accounts")
      .select("id")
      .eq("id", input.accountId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("categories")
      .select("id")
      .eq("id", input.categoryId)
      .eq("type", input.type)
      .or(`is_default.eq.true,user_id.eq.${userId}`)
      .maybeSingle(),
  ]);

  if (accountResult.error || !accountResult.data) {
    return "Choose one of your active accounts.";
  }
  if (categoryResult.error || !categoryResult.data) {
    return "Choose an available category matching the transaction type.";
  }

  return null;
}

/** Number of this user's transactions using a category (null if the count failed). */
export async function countCategoryUsage(supabase: ServerClient, userId: string, categoryId: string) {
  const { count, error } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("category_id", categoryId)
    .eq("user_id", userId);
  if (error) {
    console.error("Database error checking category usage:", error.message);
    return null;
  }
  return count ?? 0;
}

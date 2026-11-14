"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { INSTALLMENT_MANAGED_MESSAGE } from "@/lib/installments";
import { isInstallmentManagedTransaction, validateTransactionInput } from "@/lib/server/validation";
import { isAccountArchived } from "@/lib/accounts";
import {
  isTransactionDateChange,
  type TransactionFormOptions,
  type TransactionType,
} from "@/lib/transactions";

export interface TransactionActionInput {
  transactionId?: string;
  type: TransactionType;
  amount: number;
  accountId: string;
  categoryId: string;
  transactionDate: string;
  transactionTime: string;
  remark?: string;
}

export interface TransactionActionResult {
  success: boolean;
  error?: string;
}

export interface TransactionOptionsResult extends TransactionActionResult {
  options?: TransactionFormOptions;
}

function isTransactionType(value: string): value is TransactionType {
  return value === "income" || value === "expense";
}

async function getTransactionContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function revalidateTransactionViews(accountIds: string[]) {
  revalidatePath("/home");
  revalidatePath("/transactions");
  revalidatePath("/reports");
  // A manually linked installment payment follows its transaction (database trigger).
  revalidatePath("/installments");
  for (const accountId of new Set(accountIds)) {
    if (accountId) revalidatePath(`/accounts/${accountId}`);
  }
}

export async function getTransactionFormOptionsAction(): Promise<TransactionOptionsResult> {
  const { supabase, user } = await getTransactionContext();
  if (!user) return { success: false, error: "You must be signed in." };

  const [accountsResult, categoriesResult] = await Promise.all([
    // "*" keeps working before the archive migration adds archived_at.
    supabase
      .from("accounts")
      .select("*")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("categories")
      .select("id, name, type, icon, is_default")
      .or(`is_default.eq.true,user_id.eq.${user.id}`)
      .order("is_default", { ascending: false })
      .order("name"),
  ]);

  if (accountsResult.error || categoriesResult.error) {
    console.error(
      "Database error loading transaction form:",
      accountsResult.error?.message ?? categoriesResult.error?.message
    );
    return { success: false, error: "Unable to load accounts and categories." };
  }

  return {
    success: true,
    options: {
      // Archived accounts can't take new transactions, so they aren't offered.
      accounts: ((accountsResult.data ?? []) as { id: string; name: string; currency: string | null; archived_at?: string | null }[])
        .filter((account) => !isAccountArchived(account))
        .map(({ id, name, currency }) => ({ id, name, currency })),
      categories: (categoriesResult.data ?? []).flatMap((category) =>
        isTransactionType(category.type)
          ? [{ ...category, type: category.type }]
          : []
      ),
    },
  };
}

export async function createTransactionAction(
  input: TransactionActionInput
): Promise<TransactionActionResult> {
  const { supabase, user } = await getTransactionContext();
  if (!user) {
    return { success: false, error: "You must be signed in to add a transaction." };
  }

  const validationError = await validateTransactionInput(input, user.id, supabase);
  if (validationError) return { success: false, error: validationError };

  const { error } = await supabase.from("transactions").insert({
    user_id: user.id,
    account_id: input.accountId,
    category_id: input.categoryId,
    type: input.type,
    amount: input.amount,
    description: input.remark?.trim() || null,
    transaction_date: input.transactionDate,
    transaction_time: input.transactionTime ? `${input.transactionTime}:00` : null,
  });

  if (error) {
    console.error("Database error creating transaction:", error.message);
    return {
      success: false,
      error:
        error.code === "42703"
          ? "Run the transaction-time migration before adding transactions."
          : "Unable to add this transaction.",
    };
  }

  revalidateTransactionViews([input.accountId]);
  return { success: true };
}

export async function updateTransactionAction(
  input: TransactionActionInput
): Promise<TransactionActionResult> {
  const { supabase, user } = await getTransactionContext();
  if (!user) {
    return { success: false, error: "You must be signed in to edit a transaction." };
  }
  if (!input.transactionId) return { success: false, error: "Transaction not found." };

  const { data: existing, error: existingError } = await supabase
    .from("transactions")
    .select("id, account_id, transaction_date")
    .eq("id", input.transactionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingError || !existing) {
    return { success: false, error: "Transaction not found." };
  }

  const managed = await isInstallmentManagedTransaction(supabase, user.id, input.transactionId);
  if (managed === "error") return { success: false, error: "Unable to update this transaction." };
  if (managed) return { success: false, error: INSTALLMENT_MANAGED_MESSAGE };

  const validationError = await validateTransactionInput(input, user.id, supabase, String(existing.account_id));
  if (validationError) return { success: false, error: validationError };

  const changes: Record<string, string | number | null> = {
    account_id: input.accountId,
    category_id: input.categoryId,
    type: input.type,
    amount: input.amount,
    description: input.remark?.trim() || null,
    transaction_time: input.transactionTime ? `${input.transactionTime}:00` : null,
    updated_at: new Date().toISOString(),
  };
  if (isTransactionDateChange(existing.transaction_date, input.transactionDate)) {
    changes.transaction_date = input.transactionDate;
  }

  const { data, error } = await supabase
    .from("transactions")
    .update(changes)
    .eq("id", input.transactionId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("Database error updating transaction:", error?.message);
    return { success: false, error: "Unable to update this transaction." };
  }

  revalidateTransactionViews([existing.account_id, input.accountId]);
  return { success: true };
}

export async function deleteTransactionAction(
  transactionId: string
): Promise<TransactionActionResult> {
  const { supabase, user } = await getTransactionContext();
  if (!user) {
    return { success: false, error: "You must be signed in to delete a transaction." };
  }

  const { data: existing, error: existingError } = await supabase
    .from("transactions")
    .select("id, account_id")
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingError || !existing) {
    return { success: false, error: "Transaction not found." };
  }

  const managed = await isInstallmentManagedTransaction(supabase, user.id, transactionId);
  if (managed === "error") return { success: false, error: "Unable to delete this transaction." };
  if (managed) return { success: false, error: INSTALLMENT_MANAGED_MESSAGE };

  const { data, error } = await supabase
    .from("transactions")
    .delete()
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("Database error deleting transaction:", error?.message);
    return { success: false, error: "Unable to delete this transaction." };
  }

  revalidateTransactionViews([existing.account_id]);
  return { success: true };
}

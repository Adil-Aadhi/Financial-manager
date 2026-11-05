"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type {
  TransactionFormOptions,
  TransactionType,
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

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
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
  for (const accountId of new Set(accountIds)) {
    if (accountId) revalidatePath(`/accounts/${accountId}`);
  }
}

async function validateTransactionInput(
  input: TransactionActionInput,
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  if (!isTransactionType(input.type)) return "Choose Income or Expense.";
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return "Amount must be greater than zero.";
  }
  if (!input.accountId) return "Choose an account.";
  if (!input.categoryId) return "Choose a category.";
  if (!isValidDate(input.transactionDate)) return "Choose a valid date.";
  if (input.transactionTime && !isValidTime(input.transactionTime)) {
    return "Choose a valid time.";
  }
  if ((input.remark?.trim().length ?? 0) > 200) {
    return "Remark must be 200 characters or fewer.";
  }

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

export async function getTransactionFormOptionsAction(): Promise<TransactionOptionsResult> {
  const { supabase, user } = await getTransactionContext();
  if (!user) return { success: false, error: "You must be signed in." };

  const [accountsResult, categoriesResult] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, currency")
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
      accounts: accountsResult.data ?? [],
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
    .select("id, account_id")
    .eq("id", input.transactionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingError || !existing) {
    return { success: false, error: "Transaction not found." };
  }

  const validationError = await validateTransactionInput(input, user.id, supabase);
  if (validationError) return { success: false, error: validationError };

  const { data, error } = await supabase
    .from("transactions")
    .update({
      account_id: input.accountId,
      category_id: input.categoryId,
      type: input.type,
      amount: input.amount,
      description: input.remark?.trim() || null,
      transaction_date: input.transactionDate,
      transaction_time: input.transactionTime ? `${input.transactionTime}:00` : null,
      updated_at: new Date().toISOString(),
    })
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

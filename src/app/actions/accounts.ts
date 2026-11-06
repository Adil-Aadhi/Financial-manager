"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { ACCOUNT_RESTORE_WINDOW_MS, accountFieldsError } from "@/lib/validation/rules";
import {
  ACCOUNT_GROUP_ERROR,
  DEFAULT_NEW_ACCOUNT_GROUP,
  isAccountGroup,
  type AccountGroup,
} from "@/lib/accounts";

export interface CreateAccountInput {
  name: string;
  startingAmount?: number;
  accountType?: string;
  accountGroup?: AccountGroup;
  includeInSummary?: boolean;
}

export interface CreateAccountResult {
  success: boolean;
  error?: string;
  account?: {
    id: string;
    name: string;
    opening_balance?: number;
    account_type?: string;
    account_group?: AccountGroup;
    include_in_summary?: boolean;
  };
}

export interface UpdateAccountInput {
  accountId: string;
  name: string;
  openingAmount: number;
  /** Omitted by callers that don't change the group; the stored group is then kept. */
  accountGroup?: AccountGroup;
  /** Omitted by callers that don't change summary inclusion; the stored value is kept. */
  includeInSummary?: boolean;
}

export interface AccountActionResult {
  success: boolean;
  error?: string;
}

const TEN_DAYS_IN_MS = ACCOUNT_RESTORE_WINDOW_MS;

function revalidateAccountViews(accountId?: string) {
  revalidatePath("/transactions");
  revalidatePath("/home");
  revalidatePath("/reports");
  revalidatePath("/trash");
  if (accountId) revalidatePath(`/accounts/${accountId}`);
}

async function getAccountActionContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user };
}

export async function createAccountAction({
  name,
  startingAmount = 0,
  accountType = "other",
  accountGroup = DEFAULT_NEW_ACCOUNT_GROUP,
  includeInSummary = true,
}: CreateAccountInput): Promise<CreateAccountResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "You must be signed in to create an account." };
  }

  const trimmedName = name?.trim();
  if (!trimmedName) {
    return { success: false, error: "Account Name is required." };
  }

  if (!isAccountGroup(accountGroup)) {
    return { success: false, error: ACCOUNT_GROUP_ERROR };
  }
  if (typeof includeInSummary !== "boolean") {
    return { success: false, error: "Choose whether to include this account in financial summaries." };
  }

  const parsedAmount =
    typeof startingAmount === "number" && !isNaN(startingAmount)
      ? startingAmount
      : Number(startingAmount) || 0;

  const { data, error } = await supabase
    .from("accounts")
    .insert({
      user_id: user.id,
      name: trimmedName,
      account_type: accountType || "other",
      opening_balance: parsedAmount,
      account_group: accountGroup,
      include_in_summary: includeInSummary,
    })
    .select("id, name, opening_balance, account_type, account_group, include_in_summary")
    .single();

  if (error) {
    console.error("Database error creating account:", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/transactions");
  revalidatePath("/home");
  revalidatePath("/trash");

  return {
    success: true,
    account: data,
  };
}

export async function updateAccountAction({
  accountId,
  name,
  openingAmount,
  accountGroup,
  includeInSummary,
}: UpdateAccountInput): Promise<AccountActionResult> {
  const { supabase, user } = await getAccountActionContext();

  if (!user) {
    return { success: false, error: "You must be signed in to edit an account." };
  }

  const trimmedName = name.trim();
  if (!accountId) {
    return { success: false, error: "Account Name is required." };
  }
  const fieldsError = accountFieldsError(name, openingAmount);
  if (fieldsError) {
    return { success: false, error: fieldsError };
  }
  if (accountGroup !== undefined && !isAccountGroup(accountGroup)) {
    return { success: false, error: ACCOUNT_GROUP_ERROR };
  }
  if (includeInSummary !== undefined && typeof includeInSummary !== "boolean") {
    return { success: false, error: "Choose whether to include this account in financial summaries." };
  }

  const { data, error } = await supabase
    .from("accounts")
    .update({
      name: trimmedName,
      opening_balance: openingAmount,
      // Only the group column changes; id, balance and transactions are untouched.
      ...(accountGroup !== undefined ? { account_group: accountGroup } : {}),
      ...(includeInSummary !== undefined
        ? { include_in_summary: includeInSummary }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Database error updating account:", error.message);
    return { success: false, error: "Unable to update this account." };
  }

  if (!data) {
    return { success: false, error: "Account not found." };
  }

  revalidateAccountViews(accountId);
  return { success: true };
}

export async function trashAccountAction(
  accountId: string,
  confirmation: string
): Promise<AccountActionResult> {
  const { supabase, user } = await getAccountActionContext();

  if (!user) {
    return { success: false, error: "You must be signed in to delete an account." };
  }

  if (!accountId || confirmation !== "CONFIRM") {
    return { success: false, error: "Type CONFIRM to move this account to Trash." };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("accounts")
    .update({ deleted_at: now, updated_at: now })
    .eq("id", accountId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Database error moving account to Trash:", error.message);
    return { success: false, error: "Unable to move this account to Trash." };
  }

  if (!data) {
    return { success: false, error: "Account not found." };
  }

  revalidateAccountViews(accountId);
  return { success: true };
}

export async function restoreAccountAction(
  accountId: string
): Promise<AccountActionResult> {
  const { supabase, user } = await getAccountActionContext();

  if (!user) {
    return { success: false, error: "You must be signed in to restore an account." };
  }

  if (!accountId) {
    return { success: false, error: "Account not found." };
  }

  const recoveryCutoff = new Date(Date.now() - TEN_DAYS_IN_MS).toISOString();
  const { data, error } = await supabase
    .from("accounts")
    .update({ deleted_at: null, updated_at: new Date().toISOString() })
    .eq("id", accountId)
    .eq("user_id", user.id)
    .gt("deleted_at", recoveryCutoff)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Database error restoring account:", error.message);
    return { success: false, error: "Unable to restore this account." };
  }

  if (!data) {
    return {
      success: false,
      error: "This account is no longer available for recovery.",
    };
  }

  revalidateAccountViews(accountId);
  return { success: true };
}

import { isCategoryIcon, isCategoryType } from "@/lib/categories";

/**
 * Field rules shared by the online Server Actions, the sync Server Action and the offline
 * (local-first) mutations, so all three accept and reject exactly the same input with the
 * same messages. Checks that need data (does the account exist? is the category in use?)
 * stay with each caller, because they read from Supabase or IndexedDB respectively.
 */

export interface TransactionFields {
  type: string;
  amount: number;
  accountId: string;
  categoryId: string;
  transactionDate: string;
  transactionTime: string;
  remark?: string;
}

export function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Returns the first problem with a transaction's own fields, or null. */
export function transactionFieldsError(input: TransactionFields) {
  if (input.type !== "income" && input.type !== "expense") return "Choose Income or Expense.";
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
  return null;
}

export interface CategoryFields {
  name: string;
  type: string;
  icon: string;
}

/** Validates a category's fields; returns the trimmed name or the first error. */
export function validateCategoryFields(input: CategoryFields): { name?: string; error?: string } {
  const name = input.name.trim();

  if (!name) return { error: "Category name is required." };
  if (name.length > 50) return { error: "Category name must be 50 characters or fewer." };
  if (!isCategoryType(input.type)) return { error: "Choose Income or Expense." };
  if (!isCategoryIcon(input.icon)) return { error: "Choose a valid category icon." };

  return { name };
}

/** Account name and opening amount, as required when creating or editing an account. */
export function accountFieldsError(name: string, openingAmount: number) {
  if (!name.trim()) return "Account Name is required.";
  if (!Number.isFinite(openingAmount)) return "Enter a valid opening amount.";
  return null;
}

/** Accounts in Trash can be restored for this long after deleted_at. */
export const ACCOUNT_RESTORE_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

import type { CategoryType } from "@/lib/categories";

export type TransactionType = CategoryType;

export interface TransactionAccountOption {
  id: string;
  name: string;
  currency: string | null;
}

export interface TransactionCategoryOption {
  id: string;
  name: string;
  type: TransactionType;
  icon: string;
  is_default: boolean;
}

export interface TransactionRecord {
  id: string;
  account_id: string;
  category_id: string;
  type: TransactionType;
  amount: number | string;
  description: string | null;
  transaction_date: string;
  transaction_time: string | null;
  created_at: string;
  updated_at?: string | null;
  category?: {
    id: string;
    name: string;
    icon: string;
  } | null;
}

export interface TransactionFormOptions {
  accounts: TransactionAccountOption[];
  categories: TransactionCategoryOption[];
}

export function normalizeTransactionDate(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return "";

  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === normalized
    ? normalized
    : "";
}

export function transactionSortValue(transaction: TransactionRecord) {
  const time = transaction.transaction_time?.slice(0, 8) ?? "00:00:00";
  const date = normalizeTransactionDate(transaction.transaction_date) || "0000-00-00";
  return `${date}T${time}|${transaction.created_at}`;
}

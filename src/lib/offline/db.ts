import "client-only";

import Dexie, { type EntityTable, type Table } from "dexie";

export interface LocalProfile {
  ownerId: string;
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  default_currency: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LocalAccount {
  ownerId: string;
  id: string;
  user_id: string;
  name: string;
  account_type: string;
  opening_balance: number | string | null;
  currency: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface LocalCategory {
  ownerId: string;
  id: string;
  user_id: string | null;
  name: string;
  type: string;
  icon: string;
  is_default: boolean;
}

export interface LocalTransaction {
  ownerId: string;
  id: string;
  user_id: string;
  account_id: string;
  category_id: string;
  type: string;
  amount: number | string;
  description: string | null;
  transaction_date: string;
  transaction_time: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface LocalMonthlyBudget {
  ownerId: string;
  id: string;
  user_id: string;
  amount: number | string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LocalVerificationTotals {
  accounts: number;
  transactions: number;
  income: number;
  expense: number;
}

export interface LocalSyncMeta {
  ownerId: string;
  completedAt: string;
  budgetAvailable: boolean;
  server: LocalVerificationTotals;
  local: LocalVerificationTotals;
  totalsMatch: boolean;
}

class FinanceOfflineDatabase extends Dexie {
  profiles!: EntityTable<LocalProfile, "ownerId">;
  accounts!: Table<LocalAccount, [string, string]>;
  categories!: Table<LocalCategory, [string, string]>;
  transactions!: Table<LocalTransaction, [string, string]>;
  monthlyBudgets!: EntityTable<LocalMonthlyBudget, "ownerId">;
  syncMeta!: EntityTable<LocalSyncMeta, "ownerId">;

  constructor() {
    super("finance-tracker-offline");
    this.version(1).stores({
      profiles: "&ownerId, id",
      accounts: "&[ownerId+id], ownerId, [ownerId+deleted_at], created_at",
      categories: "&[ownerId+id], ownerId, [ownerId+type], is_default",
      transactions:
        "&[ownerId+id], ownerId, [ownerId+account_id], [ownerId+category_id], [ownerId+transaction_date], [ownerId+account_id+transaction_date], [ownerId+type+transaction_date]",
      monthlyBudgets: "&ownerId, id",
      syncMeta: "&ownerId, completedAt",
    });
  }
}

export const offlineDb = new FinanceOfflineDatabase();


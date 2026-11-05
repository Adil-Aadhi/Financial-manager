import "client-only";

import type { User } from "@supabase/supabase-js";
import { offlineDb, type LocalSyncMeta, type LocalVerificationTotals } from "@/lib/offline/db";
import { createClient } from "@/lib/supabase/client";

const PAGE_SIZE = 500;
const BOOTSTRAP_FRESH_MS = 60_000;
const MISSING_OBJECT_CODES = new Set(["42P01", "PGRST205"]);

/** Dispatched on window after a successful server mutation; mounted pages refresh on it. */
export const OFFLINE_DATA_STALE_EVENT = "finance-tracker:offline-data-stale";

/**
 * Bumped by markOfflineDataStale() after every successful server mutation. A refresh records
 * the value it started with, so one that began before a write can never count as fresh.
 */
let mutationGeneration = 0;
/** Per owner: the mutationGeneration at which the last successful refresh started. */
const syncedGeneration = new Map<string, number>();
interface InFlightRefresh {
  promise: Promise<LocalSyncMeta>;
  generation: number;
}
const inFlight = new Map<string, InFlightRefresh>();

interface QueryError {
  code?: string;
  message: string;
}

interface PageResult<T> {
  data: T[] | null;
  error: QueryError | null;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  default_currency: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface AccountRow {
  id: string;
  user_id: string;
  name: string;
  account_type: string;
  opening_balance: number | string | null;
  currency: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at?: string | null;
}

interface CategoryRow {
  id: string;
  user_id: string | null;
  name: string;
  type: string;
  icon: string;
  is_default: boolean;
}

interface TransactionRow {
  id: string;
  user_id: string;
  account_id: string;
  category_id: string;
  type: string;
  amount: number | string;
  description: string | null;
  transaction_date: string;
  transaction_time?: string | null;
  created_at: string;
  updated_at?: string | null;
}

interface BudgetRow {
  id: string;
  user_id: string;
  amount: number | string;
  created_at?: string | null;
  updated_at?: string | null;
}

async function fetchEveryPage<T>(
  label: string,
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>
) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await fetchPage(from, from + PAGE_SIZE - 1);
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function totals(accounts: AccountRow[], transactions: TransactionRow[]): LocalVerificationTotals {
  let income = 0;
  let expense = 0;
  for (const transaction of transactions) {
    const value = Number(transaction.amount) || 0;
    if (transaction.type === "income") income += value;
    if (transaction.type === "expense") expense += value;
  }
  return { accounts: accounts.length, transactions: transactions.length, income, expense };
}

function totalsEqual(left: LocalVerificationTotals, right: LocalVerificationTotals) {
  return (
    left.accounts === right.accounts &&
    left.transactions === right.transactions &&
    Math.abs(left.income - right.income) < 0.005 &&
    Math.abs(left.expense - right.expense) < 0.005
  );
}

async function downloadSnapshot(user: User) {
  const supabase = createClient();
  const profilePromise = supabase
    .from("profiles")
    .select("id, full_name, avatar_url, default_currency, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle();

  const accountsPromise = fetchEveryPage<AccountRow>("Accounts", (from, to) =>
    supabase
      .from("accounts")
      .select(
        "id, user_id, name, account_type, opening_balance, currency, deleted_at, created_at, updated_at"
      )
      .eq("user_id", user.id)
      .order("id")
      .range(from, to)
  );

  const categoriesPromise = fetchEveryPage<CategoryRow>("Categories", (from, to) =>
    supabase
      .from("categories")
      .select("id, user_id, name, type, icon, is_default")
      .or(`is_default.eq.true,user_id.eq.${user.id}`)
      .order("id")
      .range(from, to)
  );

  const fetchTransactions = () =>
    fetchEveryPage<TransactionRow>("Transactions", (from, to) =>
      supabase
        .from("transactions")
        .select(
          "id, user_id, account_id, category_id, type, amount, description, transaction_date, transaction_time, created_at, updated_at"
        )
        .eq("user_id", user.id)
        .order("id")
        .range(from, to)
    );

  const budgetPromise = fetchEveryPage<BudgetRow>("Monthly budget", (from, to) =>
    supabase
      .from("monthly_budgets")
      .select("id, user_id, amount, created_at, updated_at")
      .eq("user_id", user.id)
      .order("id")
      .range(from, to)
  ).then(
    (rows) => ({ rows, available: true }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const missing = [...MISSING_OBJECT_CODES].some((code) => message.includes(code));
      if (missing || message.includes("monthly_budgets")) return { rows: [], available: false };
      throw error;
    }
  );

  const [profileResult, accounts, categories, budget] = await Promise.all([
    profilePromise,
    accountsPromise,
    categoriesPromise,
    budgetPromise,
  ]);
  if (profileResult.error) throw new Error(`Profile: ${profileResult.error.message}`);

  let transactions: TransactionRow[];
  try {
    transactions = await fetchTransactions();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("transaction_time")) throw error;
    transactions = await fetchEveryPage<TransactionRow>("Transactions", (from, to) =>
      supabase
        .from("transactions")
        .select(
          "id, user_id, account_id, category_id, type, amount, description, transaction_date, created_at, updated_at"
        )
        .eq("user_id", user.id)
        .order("id")
        .range(from, to)
    );
  }

  const profile: ProfileRow = profileResult.data ?? {
    id: user.id,
    full_name: (user.user_metadata?.full_name as string | undefined) ?? null,
    avatar_url: null,
    default_currency: "USD",
  };

  return { profile, accounts, categories, transactions, budget };
}

async function commitSnapshot(user: User, snapshot: Awaited<ReturnType<typeof downloadSnapshot>>) {
  const ownerId = user.id;
  const serverTotals = totals(snapshot.accounts, snapshot.transactions);

  return offlineDb.transaction(
    "rw",
    [
      offlineDb.profiles,
      offlineDb.accounts,
      offlineDb.categories,
      offlineDb.transactions,
      offlineDb.monthlyBudgets,
      offlineDb.syncMeta,
      offlineDb.outbox,
    ],
    async () => {
      // Checked inside the same transaction as the overwrite, so a change saved on this
      // device while the snapshot was downloading can never be replaced by it.
      const kept = await keepLocalChanges(ownerId);
      if (kept) return kept;

      await Promise.all([
        offlineDb.accounts.where("ownerId").equals(ownerId).delete(),
        offlineDb.categories.where("ownerId").equals(ownerId).delete(),
        offlineDb.transactions.where("ownerId").equals(ownerId).delete(),
      ]);
      await offlineDb.profiles.delete(ownerId);
      await offlineDb.monthlyBudgets.delete(ownerId);

      await offlineDb.profiles.put({
        ownerId,
        ...snapshot.profile,
        default_currency: snapshot.profile.default_currency || "USD",
      });
      await offlineDb.accounts.bulkPut(
        snapshot.accounts.map((account) => ({ ownerId, ...account, deleted_at: account.deleted_at ?? null }))
      );
      await offlineDb.categories.bulkPut(
        snapshot.categories.map((category) => ({ ownerId, ...category }))
      );
      await offlineDb.transactions.bulkPut(
        snapshot.transactions.map((transaction) => ({
          ownerId,
          ...transaction,
          transaction_time: transaction.transaction_time ?? null,
        }))
      );
      if (snapshot.budget.rows[0]) {
        await offlineDb.monthlyBudgets.put({ ownerId, ...snapshot.budget.rows[0] });
      }

      const [localAccounts, localTransactions] = await Promise.all([
        offlineDb.accounts.where("ownerId").equals(ownerId).toArray(),
        offlineDb.transactions.where("ownerId").equals(ownerId).toArray(),
      ]);
      const localTotals = totals(localAccounts, localTransactions);
      const totalsMatch = totalsEqual(serverTotals, localTotals);
      if (!totalsMatch) throw new Error("IndexedDB verification did not match the Supabase snapshot.");

      const meta: LocalSyncMeta = {
        ownerId,
        completedAt: new Date().toISOString(),
        budgetAvailable: snapshot.budget.available,
        server: serverTotals,
        local: localTotals,
        totalsMatch,
      };
      await offlineDb.syncMeta.put(meta);
      return meta;
    }
  );
}

/**
 * A snapshot replaces every local row for the owner. While the outbox holds changes that
 * Supabase hasn't received, that would erase them, so the refresh keeps the local copy
 * instead. Phase 2's sync engine empties the outbox first; refreshes then resume as before.
 */
async function keepLocalChanges(ownerId: string): Promise<LocalSyncMeta | null> {
  const unsynced = await offlineDb.outbox.where("ownerId").equals(ownerId).count();
  if (unsynced === 0) return null;
  const meta = await offlineDb.syncMeta.get(ownerId);
  if (!meta) throw new Error("Unsynced changes exist without a local snapshot.");
  return meta;
}

async function runBootstrap(expectedUserId: string) {
  // Skip the download entirely while local changes are waiting; see keepLocalChanges().
  const kept = await keepLocalChanges(expectedUserId);
  if (kept) return kept;

  const supabase = createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || data.user.id !== expectedUserId) {
    throw new Error("An authenticated online session is required to refresh offline data.");
  }
  const snapshot = await downloadSnapshot(data.user);
  return commitSnapshot(data.user, snapshot);
}

/**
 * Call after a server mutation succeeds. The next refresh for any owner downloads a new
 * snapshot instead of trusting the freshness window, and mounted pages start one right away.
 */
export function markOfflineDataStale() {
  mutationGeneration += 1;
  window.dispatchEvent(new Event(OFFLINE_DATA_STALE_EVENT));
}

/**
 * Refreshes this owner's IndexedDB snapshot from Supabase when it is needed:
 * - `force`, or a server mutation since the last successful refresh: always.
 * - otherwise: only when the last complete snapshot is older than BOOTSTRAP_FRESH_MS.
 * Concurrent callers share one download.
 */
export async function ensureOfflineBootstrap(
  expectedUserId: string,
  force = false
): Promise<LocalSyncMeta> {
  const generation = mutationGeneration;
  const current = inFlight.get(expectedUserId);
  if (current) {
    if (current.generation === generation) return current.promise;
    // That download started before the latest mutation and may hold pre-mutation rows.
    return current.promise
      .catch(() => undefined)
      .then(() => ensureOfflineBootstrap(expectedUserId, true));
  }

  const staleAfterMutation = (syncedGeneration.get(expectedUserId) ?? 0) < generation;
  if (!force && !staleAfterMutation) {
    const meta = await offlineDb.syncMeta.get(expectedUserId);
    if (meta && Date.now() - Date.parse(meta.completedAt) < BOOTSTRAP_FRESH_MS) return meta;
    // Another caller may have started a download while IndexedDB was being read.
    if (inFlight.has(expectedUserId)) return ensureOfflineBootstrap(expectedUserId, force);
  }

  const entry: InFlightRefresh = {
    generation,
    promise: runBootstrap(expectedUserId)
      .then((meta) => {
        syncedGeneration.set(
          expectedUserId,
          Math.max(syncedGeneration.get(expectedUserId) ?? 0, generation)
        );
        return meta;
      })
      .finally(() => {
        if (inFlight.get(expectedUserId) === entry) inFlight.delete(expectedUserId);
      }),
  };
  inFlight.set(expectedUserId, entry);
  return entry.promise;
}


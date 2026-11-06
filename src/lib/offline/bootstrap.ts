import "client-only";

import type { User } from "@supabase/supabase-js";
import { normalizeAccountGroup } from "@/lib/accounts";
import { normalizeIncludeInSummary } from "@/lib/accountSummary";
import { offlineDb, type LocalSyncMeta, type LocalVerificationTotals } from "@/lib/offline/db";
import { overlayOutbox } from "@/lib/offline/snapshotOverlay";
import { createClient } from "@/lib/supabase/client";
import { normalizeTransactionDate } from "@/lib/transactions";

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
  account_group?: string | null;
  include_in_summary?: boolean | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at?: string | null;
}

/**
 * Every account column the device keeps. A column missing here is silently dropped from the
 * local copy on each refresh (that is how a saved group change used to vanish), so the
 * account-group regression tests check the downloaded rows against this list.
 */
export const ACCOUNT_SNAPSHOT_COLUMNS =
  "id, user_id, name, account_type, opening_balance, currency, account_group, include_in_summary, deleted_at, created_at, updated_at";

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

interface DailyLimitRow {
  id: string;
  user_id: string;
  effective_date: string;
  amount: number | string;
  created_at?: string | null;
  updated_at?: string | null;
}

interface DailyExpenseRow {
  id: string;
  user_id: string;
  expense_date: string;
  amount: number | string;
  description: string;
  created_at: string;
  updated_at?: string | null;
}

/** Daily Budget Tracker columns kept on the device (see the account-columns note above). */
export const DAILY_LIMIT_SNAPSHOT_COLUMNS = "id, user_id, effective_date, amount, created_at, updated_at";
export const DAILY_EXPENSE_SNAPSHOT_COLUMNS =
  "id, user_id, expense_date, amount, description, created_at, updated_at";

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

  const fetchAccounts = () =>
    fetchEveryPage<AccountRow>("Accounts", (from, to) =>
      supabase
        .from("accounts")
        .select(ACCOUNT_SNAPSHOT_COLUMNS)
        .eq("user_id", user.id)
        .order("id")
        .range(from, to)
    );
  const fetchLegacyAccounts = () =>
    fetchEveryPage<AccountRow>("Accounts", (from, to) =>
      supabase
        .from("accounts")
        .select(
          "id, user_id, name, account_type, opening_balance, currency, account_group, deleted_at, created_at, updated_at"
        )
        .eq("user_id", user.id)
        .order("id")
        .range(from, to)
    );
  const accountsPromise = fetchAccounts().catch(
    async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("include_in_summary")) throw error;
      return fetchLegacyAccounts();
    }
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

  // Daily Budget Tracker. Before its migration runs the tables don't exist: the feature is
  // then reported unavailable and everything else downloads as before.
  const isMissingDailyTable = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return (
      [...MISSING_OBJECT_CODES].some((code) => message.includes(code)) ||
      message.includes("daily_budget_limits") ||
      message.includes("daily_budget_expenses")
    );
  };
  const dailyBudgetPromise = Promise.all([
    fetchEveryPage<DailyLimitRow>("Daily budget limits", (from, to) =>
      supabase
        .from("daily_budget_limits")
        .select(DAILY_LIMIT_SNAPSHOT_COLUMNS)
        .eq("user_id", user.id)
        .order("id")
        .range(from, to)
    ),
    fetchEveryPage<DailyExpenseRow>("Daily budget expenses", (from, to) =>
      supabase
        .from("daily_budget_expenses")
        .select(DAILY_EXPENSE_SNAPSHOT_COLUMNS)
        .eq("user_id", user.id)
        .order("id")
        .range(from, to)
    ),
  ]).then(
    ([limits, expenses]) => ({ limits, expenses, available: true }),
    (error: unknown) => {
      if (isMissingDailyTable(error)) {
        return { limits: [] as DailyLimitRow[], expenses: [] as DailyExpenseRow[], available: false };
      }
      throw error;
    }
  );

  const [profileResult, accounts, categories, budget, dailyBudget] = await Promise.all([
    profilePromise,
    accountsPromise,
    categoriesPromise,
    budgetPromise,
    dailyBudgetPromise,
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

  return { profile, accounts, categories, transactions, budget, dailyBudget };
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
      offlineDb.dailyBudgetLimits,
      offlineDb.dailyBudgetExpenses,
      offlineDb.syncMeta,
      offlineDb.outbox,
    ],
    async () => {
      // Read both the previous rows and the current outbox inside the same transaction as the
      // replacement. Changes saved while the snapshot downloaded are therefore replayed over
      // it atomically instead of being overwritten.
      const [
        previousAccounts,
        previousCategories,
        previousTransactions,
        previousBudget,
        previousDailyLimits,
        previousDailyExpenses,
        outbox,
      ] = await Promise.all([
        offlineDb.accounts.where("ownerId").equals(ownerId).toArray(),
        offlineDb.categories.where("ownerId").equals(ownerId).toArray(),
        offlineDb.transactions.where("ownerId").equals(ownerId).toArray(),
        offlineDb.monthlyBudgets.get(ownerId),
        offlineDb.dailyBudgetLimits.where("ownerId").equals(ownerId).toArray(),
        offlineDb.dailyBudgetExpenses.where("ownerId").equals(ownerId).toArray(),
        offlineDb.outbox.where("ownerId").equals(ownerId).sortBy("seq"),
      ]);

      const localRows = overlayOutbox(
        ownerId,
        {
          accounts: snapshot.accounts.map((account) => ({
            ownerId,
            ...account,
            account_group: normalizeAccountGroup(account.account_group),
            include_in_summary: normalizeIncludeInSummary(account.include_in_summary),
            deleted_at: account.deleted_at ?? null,
          })),
          categories: snapshot.categories.map((category) => ({ ownerId, ...category })),
          transactions: snapshot.transactions.map((transaction) => ({
            ownerId,
            ...transaction,
            transaction_time: transaction.transaction_time ?? null,
          })),
          budget: snapshot.budget.rows[0]
            ? { ownerId, ...snapshot.budget.rows[0] }
            : null,
          dailyLimits: snapshot.dailyBudget.limits.map(({ id: _id, ...limit }) => {
            void _id;
            return { ownerId, ...limit };
          }),
          dailyExpenses: snapshot.dailyBudget.expenses.map((expense) => ({ ownerId, ...expense })),
        },
        {
          accounts: previousAccounts,
          categories: previousCategories,
          transactions: previousTransactions,
          budget: previousBudget ?? null,
          dailyLimits: previousDailyLimits,
          dailyExpenses: previousDailyExpenses,
        },
        outbox
      );

      await Promise.all([
        offlineDb.accounts.where("ownerId").equals(ownerId).delete(),
        offlineDb.categories.where("ownerId").equals(ownerId).delete(),
        offlineDb.transactions.where("ownerId").equals(ownerId).delete(),
        offlineDb.dailyBudgetLimits.where("ownerId").equals(ownerId).delete(),
        offlineDb.dailyBudgetExpenses.where("ownerId").equals(ownerId).delete(),
      ]);
      await offlineDb.profiles.delete(ownerId);
      await offlineDb.monthlyBudgets.delete(ownerId);

      await offlineDb.profiles.put({
        ownerId,
        ...snapshot.profile,
        default_currency: snapshot.profile.default_currency || "USD",
      });
      await offlineDb.accounts.bulkPut(localRows.accounts);
      await offlineDb.categories.bulkPut(localRows.categories);
      await offlineDb.transactions.bulkPut(
        localRows.transactions.map((transaction) => ({
          ...transaction,
          transaction_date:
            normalizeTransactionDate(transaction.transaction_date) ??
            transaction.transaction_date,
        }))
      );
      if (localRows.budget) await offlineDb.monthlyBudgets.put(localRows.budget);
      await offlineDb.dailyBudgetLimits.bulkPut(localRows.dailyLimits ?? []);
      await offlineDb.dailyBudgetExpenses.bulkPut(localRows.dailyExpenses ?? []);

      const [localAccounts, localTransactions] = await Promise.all([
        offlineDb.accounts.where("ownerId").equals(ownerId).toArray(),
        offlineDb.transactions.where("ownerId").equals(ownerId).toArray(),
      ]);
      const localTotals = totals(localAccounts, localTransactions);
      // With an outbox, local totals intentionally differ from Supabase. The snapshot was fully
      // downloaded and the overlay completed in this same atomic transaction, so it remains a
      // complete usable local copy.
      const totalsMatch = outbox.length > 0 || totalsEqual(serverTotals, localTotals);
      if (!totalsMatch) throw new Error("IndexedDB verification did not match the Supabase snapshot.");

      const meta: LocalSyncMeta = {
        ownerId,
        completedAt: new Date().toISOString(),
        budgetAvailable: snapshot.budget.available,
        dailyBudgetAvailable: snapshot.dailyBudget.available,
        server: serverTotals,
        local: localTotals,
        totalsMatch,
      };
      await offlineDb.syncMeta.put(meta);
      return meta;
    }
  );
}

async function runBootstrap(expectedUserId: string) {
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


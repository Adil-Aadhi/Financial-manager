import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  OfflineHomeDashboard,
  type HomeAccount,
  type HomeTransaction,
} from "@/components/home/OfflineHomeDashboard";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { getTransactionMonthRange } from "@/lib/month";
import { getMonthlyBudgetOverview } from "@/lib/supabase/budget";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { normalizeTransactionDate } from "@/lib/transactions";

export const instant = false;

export const metadata: Metadata = {
  title: "Home | FinanceTracker",
  description: "Your balance, cash flow and recent activity.",
};

export default async function HomePage() {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");

  const name = profile.full_name || user.email?.split("@")[0] || "there";
  const month = getTransactionMonthRange();
  const supabase = await createClient();

  const [accountsResult, transactionsResult, budget] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, opening_balance, currency, include_in_summary, deleted_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("transactions")
      .select("id, account_id, category_id, type, amount, description, transaction_date, created_at, categories(name, icon)")
      .eq("user_id", user.id)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false }),
    getMonthlyBudgetOverview(supabase, user.id, profile.default_currency, month),
  ]);

  let accounts: HomeAccount[] = (accountsResult.data ?? []).map((account) => ({
    id: account.id,
    name: account.name,
    opening_balance: account.opening_balance,
    currency: account.currency,
    include_in_summary: account.include_in_summary,
    deleted_at: account.deleted_at ?? null,
    created_at: account.created_at,
  }));
  if (accountsResult.error?.code === "42703") {
    const preSummary = await supabase
      .from("accounts")
      .select("id, name, opening_balance, currency, deleted_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (!preSummary.error) {
      accounts = (preSummary.data ?? []).map((account) => ({
        id: account.id,
        name: account.name,
        opening_balance: account.opening_balance,
        currency: account.currency,
        include_in_summary: true,
        deleted_at: account.deleted_at ?? null,
        created_at: account.created_at,
      }));
    } else {
      const legacy = await supabase
        .from("accounts")
        .select("id, name, opening_balance, currency, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      accounts = (legacy.data ?? []).map((account) => ({
        id: account.id,
        name: account.name,
        opening_balance: account.opening_balance,
        currency: account.currency,
        include_in_summary: true,
        deleted_at: null,
        created_at: account.created_at,
      }));
      if (legacy.error) console.error("Error fetching dashboard accounts:", legacy.error.message);
    }
  } else if (accountsResult.error) {
    console.error("Error fetching dashboard accounts:", accountsResult.error.message);
  }
  if (transactionsResult.error) {
    console.error("Error fetching dashboard transactions:", transactionsResult.error.message);
  }

  const transactions: HomeTransaction[] = (transactionsResult.data ?? []).map((transaction) => {
    const value = transaction.categories;
    const category = Array.isArray(value) ? value[0] : value;
    return {
      id: transaction.id,
      account_id: transaction.account_id,
      category_id: transaction.category_id,
      type: transaction.type,
      amount: transaction.amount,
      description: transaction.description,
      transaction_date:
        normalizeTransactionDate(transaction.transaction_date) ??
        transaction.transaction_date,
      created_at: transaction.created_at,
      category: category ? { name: category.name, icon: category.icon } : null,
    };
  });

  return (
    <AppShell userName={name} userEmail={user.email} currency={profile.default_currency}>
      <PageHeader eyebrow="Overview" title={`Hi, ${name.split(" ")[0]}`} />
      <OfflineHomeDashboard
        ownerId={user.id}
        currency={profile.default_currency}
        month={month}
        serverSnapshot={{ accounts, transactions, budget }}
      />
    </AppShell>
  );
}

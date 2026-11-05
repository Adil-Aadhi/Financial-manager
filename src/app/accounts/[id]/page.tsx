import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AccountFABRegistrar } from "@/components/accounts/AccountFABRegistrar";
import { OfflineAccountDetails } from "@/components/accounts/OfflineAccountDetails";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Alert } from "@/components/ui/Alert";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeTransactionDate,
  type TransactionCategoryOption,
  type TransactionRecord,
  type TransactionType,
} from "@/lib/transactions";

export const instant = false;

interface AccountPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: AccountPageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Account ${id} | FinanceTracker`,
    description: "Account balance and transaction history.",
  };
}

function isTransactionType(value: string): value is TransactionType {
  return value === "income" || value === "expense";
}

export default async function AccountDetailsPage({ params }: AccountPageProps) {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");

  const { id } = await params;
  const supabase = await createClient();
  const accountResult = await supabase
    .from("accounts")
    .select("id, name, opening_balance, currency, created_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  let accountData = accountResult.data;
  if (accountResult.error?.code === "42703") {
    const legacyAccountResult = await supabase
      .from("accounts")
      .select("id, name, opening_balance, currency, created_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    accountData = legacyAccountResult.data;
  }
  if (!accountData) notFound();

  const withTimeResult = await supabase
    .from("transactions")
    .select(
      "id, account_id, category_id, type, amount, description, transaction_date, transaction_time, created_at, updated_at, categories(id, name, icon)"
    )
    .eq("user_id", user.id)
    .eq("account_id", id)
    .order("transaction_date", { ascending: false })
    .order("transaction_time", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const transactionTimeReady = withTimeResult.error?.code !== "42703";
  let transactionRows = withTimeResult.data ?? [];

  if (!transactionTimeReady) {
    const legacyTransactionsResult = await supabase
      .from("transactions")
      .select(
        "id, account_id, category_id, type, amount, description, transaction_date, created_at, updated_at, categories(id, name, icon)"
      )
      .eq("user_id", user.id)
      .eq("account_id", id)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false });
    transactionRows =
      legacyTransactionsResult.data?.map((row) => ({
        ...row,
        transaction_time: null,
      })) ?? [];
    if (legacyTransactionsResult.error) {
      console.error("Error fetching account transactions:", legacyTransactionsResult.error.message);
    }
  } else if (withTimeResult.error) {
    console.error("Error fetching account transactions:", withTimeResult.error.message);
  }

  const categoriesResult = await supabase
    .from("categories")
    .select("id, name, type, icon, is_default")
    .or(`is_default.eq.true,user_id.eq.${user.id}`)
    .order("is_default", { ascending: false })
    .order("name");

  if (categoriesResult.error) {
    console.error("Error fetching transaction categories:", categoriesResult.error.message);
  }

  const categories: TransactionCategoryOption[] = (categoriesResult.data ?? []).flatMap(
    (category) =>
      isTransactionType(category.type)
        ? [{ ...category, type: category.type }]
        : []
  );

  const transactions: TransactionRecord[] = (transactionRows ?? []).flatMap((row) => {
    if (!isTransactionType(row.type)) return [];
    const categoryValue = row.categories;
    const category = Array.isArray(categoryValue) ? categoryValue[0] : categoryValue;
    return [
      {
        id: row.id,
        account_id: row.account_id,
        category_id: row.category_id,
        type: row.type,
        amount: row.amount,
        description: row.description,
        transaction_date: normalizeTransactionDate(row.transaction_date),
        transaction_time: row.transaction_time ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        category: category
          ? { id: category.id, name: category.name, icon: category.icon }
          : null,
      },
    ];
  });

  const userName = profile.full_name || user.email?.split("@")[0] || "User";

  return (
    <AppShell userName={userName} userEmail={user.email} currency={profile.default_currency}>
      <AccountFABRegistrar account={{ id: accountData.id, name: accountData.name }} />

      <PageHeader
        eyebrow="Account Details"
        title={accountData.name}
        description="Balance, totals, and complete transaction history."
      />

      <div className="space-y-4 sm:space-y-6">
        {!transactionTimeReady && (
          <Alert variant="warning" title="Database update required">
            Existing transactions are available. Run the transaction-time migration to add or edit entries with time support.
          </Alert>
        )}

        <OfflineAccountDetails
          ownerId={user.id}
          account={accountData}
          transactions={transactions}
          categories={categories}
          fallbackCurrency={profile.default_currency}
        />
      </div>
    </AppShell>
  );
}

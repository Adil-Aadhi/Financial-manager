import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AddAccountButton } from "@/components/accounts/AddAccountButton";
import type { AccountListItem } from "@/components/accounts/AccountList";
import { OfflineAccountList } from "@/components/accounts/OfflineAccountList";
import { PageHeader } from "@/components/layout/AppShell";
import { Alert } from "@/components/ui/Alert";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export const metadata: Metadata = {
  title: "Transactions | AccountTracker",
  description: "Your accounts, income, and expenses.",
};

export default async function TransactionsPage() {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");

  const supabase = await createClient();
  const activeAccountsResult = await supabase
    .from("accounts")
    .select("id, name, opening_balance, currency, account_group, include_in_summary")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  let accounts: Omit<AccountListItem, "total_income" | "total_expense">[] | null =
    activeAccountsResult.data;
  let accountTrashReady = true;

  if (activeAccountsResult.error?.code === "42703") {
    // Before this migration, every account is included by default. Keep the
    // existing group/Trash behavior while the new column is being deployed.
    const preSummaryResult = await supabase
      .from("accounts")
      .select("id, name, opening_balance, currency, account_group")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (!preSummaryResult.error) {
      accounts = preSummaryResult.data?.map((account) => ({
        ...account,
        include_in_summary: true,
      })) ?? null;
    } else if (preSummaryResult.error.code === "42703") {
      accountTrashReady = false;
      const legacyAccountsResult = await supabase
        .from("accounts")
        .select("id, name, opening_balance, currency")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      accounts = legacyAccountsResult.data?.map((account) => ({
        ...account,
        include_in_summary: true,
      })) ?? null;
      if (legacyAccountsResult.error) {
        console.error("Error fetching accounts:", legacyAccountsResult.error.message);
      }
    } else {
      console.error("Error fetching accounts:", preSummaryResult.error.message);
    }
  } else if (activeAccountsResult.error) {
    console.error("Error fetching accounts:", activeAccountsResult.error.message);
  }

  const accountIds = (accounts ?? []).map((account) => account.id);
  const totalsByAccount = new Map<string, { income: number; expense: number }>();

  if (accountIds.length > 0) {
    const transactionsResult = await supabase
      .from("transactions")
      .select("account_id, type, amount")
      .eq("user_id", user.id)
      .in("account_id", accountIds);

    if (transactionsResult.error) {
      console.error("Error fetching account totals:", transactionsResult.error.message);
    } else {
      for (const transaction of transactionsResult.data ?? []) {
        const totals = totalsByAccount.get(transaction.account_id) ?? { income: 0, expense: 0 };
        if (transaction.type === "income") totals.income += Number(transaction.amount) || 0;
        if (transaction.type === "expense") totals.expense += Number(transaction.amount) || 0;
        totalsByAccount.set(transaction.account_id, totals);
      }
    }
  }

  const accountItems: AccountListItem[] = (accounts ?? []).map((account) => {
    const totals = totalsByAccount.get(account.id);
    return {
      ...account,
      include_in_summary: account.include_in_summary !== false,
      total_income: totals?.income ?? 0,
      total_expense: totals?.expense ?? 0,
    };
  });

  return (
    <>
      <PageHeader
        eyebrow="Activity"
        title="Transactions"
        description="Choose an account for its complete history, or use + to add a transaction."
        action={<AddAccountButton />}
      />

      <div className="space-y-5">
        {!accountTrashReady && (
          <Alert variant="warning" title="Database update required">
            Accounts remain available, but Edit and Trash require the account-trash migration.
          </Alert>
        )}

        {/* Renders the Primary/General tabs and the Accounts card. */}
        <OfflineAccountList
          ownerId={user.id}
          serverAccounts={accountItems}
          fallbackCurrency={profile.default_currency}
          actionsEnabled={accountTrashReady}
        />
      </div>
    </>
  );
}

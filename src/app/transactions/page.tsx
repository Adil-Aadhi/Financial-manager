import { Metadata } from "next";
import { redirect } from "next/navigation";
import { Landmark, ReceiptText } from "lucide-react";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Alert } from "@/components/ui/Alert";
import { AccountList } from "@/components/accounts/AccountList";

export const instant = false;

export const metadata: Metadata = {
  title: "Transactions | FinanceTracker",
  description: "Your income and expenses.",
};

export default async function TransactionsPage() {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");

  const name = profile.full_name || user.email?.split("@")[0] || "User";

  // Accounts for the signed-in user. RLS should also enforce ownership; the explicit
  // user_id filter keeps the query correct even if the SELECT policy is broad.
  const supabase = await createClient();
  const activeAccountsResult = await supabase
    .from("accounts")
    .select("id, name, opening_balance, currency")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  let accounts = activeAccountsResult.data;
  const accountTrashReady = activeAccountsResult.error?.code !== "42703";

  if (!accountTrashReady) {
    // Keep the page usable until the account-trash migration is applied.
    const legacyAccountsResult = await supabase
      .from("accounts")
      .select("id, name, opening_balance, currency")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    accounts = legacyAccountsResult.data;

    if (legacyAccountsResult.error) {
      console.error(
        "Error fetching accounts:",
        legacyAccountsResult.error.message
      );
    }
  } else if (activeAccountsResult.error) {
    console.error(
      "Error fetching accounts:",
      activeAccountsResult.error.message
    );
  }

  return (
    <AppShell userName={name} userEmail={user.email} currency={profile.default_currency}>
      <PageHeader
        eyebrow="Activity"
        title="Transactions"
        description="View your income, expenses, and manage your accounts."
      />
      <div className="space-y-5">
        {!accountTrashReady && (
          <Alert variant="warning" title="Database update required">
            Accounts remain available, but Edit and Trash will activate after
            the account-trash migration is run in Supabase.
          </Alert>
        )}

        <Card title="Accounts" bodyClassName="pt-2">
          {accounts && accounts.length > 0 ? (
            <AccountList
              accounts={accounts}
              fallbackCurrency={profile.default_currency}
              actionsEnabled={accountTrashReady}
            />
          ) : (
            <EmptyState
              icon={<Landmark className="h-5 w-5" />}
              title="No accounts yet"
              description="Click the floating button (+) to add an account and get started."
            />
          )}
        </Card>

        <Card>
          <EmptyState
            icon={<ReceiptText className="h-5 w-5" />}
            title="No transactions yet"
            description={
              accounts && accounts.length > 0
                ? "Open an account to record a transaction."
                : "Add an account first, then record transactions."
            }
            className="py-14"
          />
        </Card>
      </div>
    </AppShell>
  );
}

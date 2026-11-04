import { Metadata } from "next";
import { redirect } from "next/navigation";
import { Landmark, ReceiptText } from "lucide-react";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
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
  const { data: accounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id, name, opening_balance, currency")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (accountsError) {
    console.error("Error fetching accounts:", accountsError.message);
  }

  return (
    <AppShell userName={name} userEmail={user.email} currency={profile.default_currency}>
      <PageHeader
        eyebrow="Activity"
        title="Transactions"
        description="View your income, expenses, and manage your accounts."
      />
      <div className="space-y-5">
        <Card title="Accounts" bodyClassName="pt-2">
          {accounts && accounts.length > 0 ? (
            <AccountList accounts={accounts} fallbackCurrency={profile.default_currency} />
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

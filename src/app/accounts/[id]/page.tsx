import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Landmark, ReceiptText } from "lucide-react";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { AccountFABRegistrar } from "@/components/accounts/AccountFABRegistrar";
import { formatMoney } from "@/lib/format";

export const instant = false;

interface AccountPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: AccountPageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Account ${id} | FinanceTracker`,
    description: "Account details and transaction history.",
  };
}

export default async function AccountDetailsPage({ params }: AccountPageProps) {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");

  const { id } = await params;

  // Retrieve account details from Supabase accounts table
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

  const account = accountData;

  const userName = profile.full_name || user.email?.split("@")[0] || "User";
  const currency = account.currency || profile.default_currency;

  return (
    <AppShell
      userName={userName}
      userEmail={user.email}
      currency={profile.default_currency}
    >
      {/* Registers current account with FAB so clicking FAB opens Quick Transaction with this account */}
      <AccountFABRegistrar
        account={{ id: account.id, name: account.name }}
      />

      <PageHeader
        eyebrow="Account Details"
        title={account.name}
        description="View account balance, history, and record quick transactions."
      />

      <div className="space-y-6">
        {/* Account Summary Card */}
        <div className="glass-strong glass-edge rounded-3xl p-6 sm:p-7 space-y-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
              <Landmark className="h-4 w-4 text-accent" />
              Opening balance
            </span>
            <span className="rounded-full border border-line bg-glass-hover px-2.5 py-0.5 font-mono text-[11px] font-semibold text-fg-muted">
              {currency}
            </span>
          </div>

          <p className="font-mono text-3xl sm:text-4xl font-semibold text-fg">
            {formatMoney(account.opening_balance || 0, currency)}
          </p>

          <p className="text-xs text-fg-subtle">
            Click the floating action button (+) to quickly enter a transaction for this account.
          </p>
        </div>

        {/* Transactions Card */}
        <Card title="Activity" description="Transactions recorded for this account">
          <EmptyState
            icon={<ReceiptText className="h-5 w-5" />}
            title="No transactions yet"
            description="Use the + button to add a transaction for this account."
            className="py-12"
          />
        </Card>
      </div>
    </AppShell>
  );
}

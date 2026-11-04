import { Metadata } from "next";
import { redirect } from "next/navigation";
import { ReceiptText } from "lucide-react";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export const instant = false;

export const metadata: Metadata = {
  title: "Transactions | FinanceTracker",
  description: "Your income and expenses.",
};

export default async function TransactionsPage() {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");

  const name = profile.full_name || user.email?.split("@")[0] || "User";

  return (
    <AppShell userName={name} userEmail={user.email} currency={profile.default_currency}>
      <PageHeader
        eyebrow="Activity"
        title="Transactions"
        description="View your income, expenses, and manage your accounts."
      />
      <Card>
        <EmptyState
          icon={<ReceiptText className="h-5 w-5" />}
          title="No transactions yet"
          description="Click the floating button (+) to add an account and get started."
          className="py-14"
        />
      </Card>
    </AppShell>
  );
}

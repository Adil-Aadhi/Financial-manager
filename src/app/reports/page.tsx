import { Metadata } from "next";
import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export const instant = false;

export const metadata: Metadata = {
  title: "Reports | FinanceTracker",
  description: "Income, spending and savings trends.",
};

export default async function ReportsPage() {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");

  const name = profile.full_name || user.email?.split("@")[0] || "User";

  return (
    <AppShell userName={name} userEmail={user.email} currency={profile.default_currency}>
      <PageHeader title="Reports" />
      <Card>
        <EmptyState
          icon={<BarChart3 className="h-5 w-5" />}
          title="No data to report yet"
          description="Charts appear once you have transactions."
          className="py-14"
        />
      </Card>
    </AppShell>
  );
}

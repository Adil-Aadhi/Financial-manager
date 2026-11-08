import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { DailyBudgetTracker } from "@/components/dailyBudget/DailyBudgetTracker";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { dailyBudgetToday } from "@/lib/dailyBudget";
import { getDailyBudgetServerData } from "@/lib/supabase/dailyBudget";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export const metadata: Metadata = {
  title: "Daily budget | AccountTracker",
  description: "Your daily spending allowance, carry-forward balance and monthly history.",
};

export default async function DailyBudgetPage() {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");

  const name = profile.full_name || user.email?.split("@")[0] || "there";
  const supabase = await createClient();
  // Every month (history is browsable); the device copy replaces this once it is ready.
  const dailyBudget = await getDailyBudgetServerData(supabase, user.id);

  return (
    <AppShell userName={name} userEmail={user.email} currency={profile.default_currency}>
      <Link
        href="/home"
        className="mb-2 inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-semibold text-fg-muted transition-colors hover:bg-glass-hover hover:text-fg"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Home
      </Link>
      <PageHeader
        eyebrow="Budget"
        title="Daily budget"
        description="A daily allowance you track by hand. Separate from your accounts and transactions."
      />
      <DailyBudgetTracker
        ownerId={user.id}
        currency={profile.default_currency}
        server={dailyBudget}
        serverToday={dailyBudgetToday()}
      />
    </AppShell>
  );
}

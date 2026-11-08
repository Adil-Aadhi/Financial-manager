import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { InstallmentTracker } from "@/components/installments/InstallmentTracker";
import { installmentToday } from "@/lib/installments";
import { getInstallmentsServerData } from "@/lib/supabase/installments";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";

export const instant = false;
export const metadata: Metadata = {
  title: "Installments | FinanceTracker",
  description: "EMI and Buy Now Pay Later plans with schedules and payment history.",
};

export default async function InstallmentsPage({ searchParams }: { searchParams: Promise<{ selected?: string; add?: string; payment?: string }> }) {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");
  const server = await getInstallmentsServerData(await createClient(), user.id);
  const params = await searchParams;
  const name = profile.full_name || user.email?.split("@")[0] || "there";
  return (
    <AppShell userName={name} userEmail={user.email} currency={profile.default_currency}>
      <PageHeader eyebrow="Planning" title="Installments" description="EMIs and Pay Later plans. Paying from an account records one expense transaction." />
      <InstallmentTracker
        ownerId={user.id}
        currency={profile.default_currency}
        server={server}
        serverToday={installmentToday()}
        initialSelectedId={params.selected}
        initialPaymentId={params.payment}
        initiallyAdding={params.add === "1"}
      />
    </AppShell>
  );
}

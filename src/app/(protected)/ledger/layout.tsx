import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/AppShell";
import { LedgerNav } from "@/components/ledger/LedgerNav";
import { LedgerProvider } from "@/components/ledger/LedgerProvider";
import { dailyBudgetToday } from "@/lib/dailyBudget";
import { getLedgerServerData } from "@/lib/supabase/ledger";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

/**
 * Personal Ledger shell: one provider shared by every ledger page, so switching between
 * Overview, Recurring Dues, Shared Expenses, Manual Dues, People and Payment History reads the
 * same (offline-capable) data and keeps open forms and the add button working.
 */
export default async function LedgerLayout({ children }: { children: ReactNode }) {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");
  const server = await getLedgerServerData(await createClient(), user.id);

  return (
    <LedgerProvider ownerId={user.id} currency={profile.default_currency} server={server} serverToday={dailyBudgetToday()}>
      <PageHeader eyebrow="Tracking" title="Personal Ledger" description="Money other people owe you. Kept separate from your accounts and transactions." />
      <LedgerNav />
      {children}
    </LedgerProvider>
  );
}

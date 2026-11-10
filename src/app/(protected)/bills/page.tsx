import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/AppShell";
import { BillTracker } from "@/components/bills/BillTracker";
import { billToday } from "@/lib/bills";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { getBillsServerData } from "@/lib/supabase/bills";

export const instant = false;
export const metadata: Metadata = { title: "Bills | AccountTracker", description: "Track recurring bills and manually confirmed payments." };

export default async function BillsPage({ searchParams }: { searchParams: Promise<{ selected?: string; add?: string }> }) {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");
  const server = await getBillsServerData(await createClient(), user.id);
  const params = await searchParams;
  return <><PageHeader eyebrow="Planning" title="Bills" description="Household and recurring-payment reminders. No account balances are changed." /><BillTracker ownerId={user.id} currency={profile.default_currency} server={server} serverToday={billToday()} initialSelectedId={params.selected} initiallyAdding={params.add === "1"} /></>;
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { SubscriptionTracker } from "@/components/subscriptions/SubscriptionTracker";
import { getAuthenticatedUserProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { getSubscriptionsServerData } from "@/lib/supabase/subscriptions";
import { subscriptionToday } from "@/lib/subscriptions";

export const instant = false;

export const metadata: Metadata = {
  title: "Subscriptions | AccountTracker",
  description: "Track recurring services and manually confirm their payments.",
};

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ selected?: string; add?: string }>;
}) {
  const { user, profile } = await getAuthenticatedUserProfile();
  if (!user || !profile) redirect("/login");
  const supabase = await createClient();
  const server = await getSubscriptionsServerData(supabase, user.id);
  const params = await searchParams;
  const name = profile.full_name || user.email?.split("@")[0] || "there";

  return (
    <AppShell userName={name} userEmail={user.email} currency={profile.default_currency}>
      <PageHeader eyebrow="Planning" title="Subscriptions" description="Recurring-payment reminders and history. No account balances are changed." />
      <SubscriptionTracker
        ownerId={user.id}
        currency={profile.default_currency}
        server={server}
        serverToday={subscriptionToday()}
        initialSelectedId={params.selected}
        initiallyAdding={params.add === "1"}
      />
    </AppShell>
  );
}

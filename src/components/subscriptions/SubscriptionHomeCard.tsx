"use client";

import Link from "next/link";
import { Repeat2 } from "lucide-react";
import { SubscriptionCard } from "./SubscriptionCard";
import { Card, CardLink } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatMoney } from "@/lib/format";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import type { SubscriptionsServerData } from "@/lib/supabase/subscriptions";
import { monthlyEquivalent } from "@/lib/subscriptions";
import { useSubscriptionsData, useSubscriptionToday } from "./useSubscriptions";

export function SubscriptionHomeCard({
  ownerId,
  currency,
  server,
  serverToday,
}: {
  ownerId: string;
  currency: SupportedCurrency;
  server: SubscriptionsServerData;
  serverToday: string;
}) {
  const data = useSubscriptionsData(ownerId, server);
  const today = useSubscriptionToday(serverToday);
  const active = data.subscriptions.filter((item) => item.lifecycle === "active");
  const upcoming = [...active].sort((a, b) => a.next_payment_date.localeCompare(b.next_payment_date)).slice(0, 3);
  const monthly = active
    .filter((item) => item.currency === currency)
    .reduce((sum, item) => sum + monthlyEquivalent(item.amount, item.billing_cycle), 0);

  return (
    <Card
      title="Subscriptions"
      description={active.length ? `${active.length} active · ${formatMoney(monthly, currency, { compact: true })}/month expected` : undefined}
      action={<CardLink href="/subscriptions">View all</CardLink>}
    >
      {!data.available ? (
        <EmptyState icon={<Repeat2 className="h-5 w-5" />} title="Subscriptions need setup" description="Apply the subscriptions database migration to enable this feature." />
      ) : upcoming.length ? (
        <div className="grid gap-3 lg:grid-cols-3">
          {upcoming.map((item) => (
            <Link key={item.id} href={`/subscriptions?selected=${item.id}`} className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
              <SubscriptionCard subscription={item} today={today} compact />
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Repeat2 className="h-5 w-5" />}
          title="No active subscriptions"
          description="Track renewals and confirm payments without changing account balances."
          action={<Link href="/subscriptions?add=1" className="text-xs font-semibold text-accent hover:text-accent-strong">Add subscription</Link>}
        />
      )}
    </Card>
  );
}

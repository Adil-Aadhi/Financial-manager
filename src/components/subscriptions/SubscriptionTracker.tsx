"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Clock3, Repeat2, Search } from "lucide-react";
import { SubscriptionCard } from "./SubscriptionCard";
import { SubscriptionDetailsModal, SubscriptionFormModal } from "./SubscriptionModals";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionRefreshIndicator } from "@/components/ui/SectionRefreshIndicator";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import type { SubscriptionsServerData } from "@/lib/supabase/subscriptions";
import { monthlyEquivalent, subscriptionStatus } from "@/lib/subscriptions";
import { useSubscriptionsData, useSubscriptionToday } from "./useSubscriptions";

type Filter = "all" | "upcoming" | "pending" | "paid" | "overdue" | "paused";
const FILTERS: Filter[] = ["all", "upcoming", "pending", "paid", "overdue", "paused"];

export function SubscriptionTracker({
  ownerId,
  currency,
  server,
  serverToday,
  initialSelectedId,
  initiallyAdding,
}: {
  ownerId: string;
  currency: SupportedCurrency;
  server: SubscriptionsServerData;
  serverToday: string;
  initialSelectedId?: string;
  initiallyAdding?: boolean;
}) {
  const data = useSubscriptionsData(ownerId, server);
  const today = useSubscriptionToday(serverToday);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(Boolean(initiallyAdding));
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? null);
  const selected = data.subscriptions.find((item) => item.id === selectedId) ?? null;
  const paidIds = useMemo(() => new Set(data.payments.map((payment) => payment.subscription_id)), [data.payments]);

  const active = data.subscriptions.filter((item) => item.lifecycle === "active");
  const statuses = active.map((item) => subscriptionStatus(item, today));
  const monthly = active.filter((item) => item.currency === currency)
    .reduce((sum, item) => sum + monthlyEquivalent(item.amount, item.billing_cycle), 0);
  const otherCurrencyCount = active.filter((item) => item.currency !== currency).length;
  const visible = data.subscriptions
    .filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((item) => {
      if (filter === "all") return true;
      if (filter === "paid") return paidIds.has(item.id);
      return subscriptionStatus(item, today) === filter;
    })
    .sort((a, b) => a.next_payment_date.localeCompare(b.next_payment_date));

  return (
    <div className="space-y-4 sm:space-y-5">
      {!data.available && <Alert variant="warning" title="Database setup required">Apply the subscriptions migration before adding subscriptions.</Alert>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <OverviewTile label="Active" value={String(active.length)} icon={<Repeat2 className="h-4 w-4" />} />
        <OverviewTile label="Expected monthly" value={formatMoney(monthly, currency, { compact: true })} icon={<CalendarClock className="h-4 w-4" />} />
        <OverviewTile label="Upcoming" value={String(statuses.filter((value) => value === "upcoming").length)} icon={<Clock3 className="h-4 w-4" />} />
        <OverviewTile label="Pending" value={String(statuses.filter((value) => value === "pending").length)} icon={<CheckCircle2 className="h-4 w-4" />} />
        <OverviewTile label="Overdue" value={String(statuses.filter((value) => value === "overdue").length)} icon={<AlertCircle className="h-4 w-4" />} danger />
      </div>
      {otherCurrencyCount > 0 && <p className="text-xs text-fg-subtle">Monthly total includes {currency} subscriptions only; {otherCurrencyCount} active subscription{otherCurrencyCount === 1 ? " uses" : "s use"} another currency.</p>}

      <section className="glass glass-edge relative rounded-2xl p-4 sm:p-5">
        <SectionRefreshIndicator scope="subscriptions" className="absolute right-4 top-16 rounded-full bg-glass-strong px-2 py-1 sm:right-44 sm:top-5" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subscriptions" aria-label="Search subscriptions" className="h-11 w-full rounded-xl border border-line bg-glass-input pl-10 pr-4 text-base text-fg outline-none focus:border-accent/70 focus:ring-4 focus:ring-accent/15 sm:text-sm" />
          </div>
          <Button onClick={() => setAdding(true)} disabled={!data.available}>Add subscription</Button>
        </div>
        <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Subscription status">
          {FILTERS.map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition-colors", filter === value ? "border-accent/30 bg-accent/12 text-accent" : "border-line bg-glass-hover text-fg-muted hover:text-fg")}>{value}</button>)}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((item) => <SubscriptionCard key={item.id} subscription={item} today={today} onClick={() => setSelectedId(item.id)} />)}
        </div>
        {!visible.length && <EmptyState icon={<Repeat2 className="h-5 w-5" />} title={data.subscriptions.length ? "No matching subscriptions" : "No subscriptions yet"} description={data.subscriptions.length ? "Try another filter or search." : "Add a recurring service to start tracking its next payment."} action={!data.subscriptions.length && data.available ? <button type="button" onClick={() => setAdding(true)} className="text-xs font-semibold text-accent">Add subscription</button> : undefined} />}
      </section>

      {adding && <SubscriptionFormModal isOpen onClose={() => setAdding(false)} currency={currency} today={today} />}
      {selected && <SubscriptionDetailsModal subscription={selected} payments={data.payments} today={today} currency={currency} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function OverviewTile({ label, value, icon, danger = false }: { label: string; value: string; icon: React.ReactNode; danger?: boolean }) {
  return <div className="glass rounded-2xl p-3.5"><span className={cn("flex h-8 w-8 items-center justify-center rounded-xl", danger ? "bg-danger/12 text-danger" : "bg-accent-soft text-accent")}>{icon}</span><p className="mt-3 text-[11px] font-medium text-fg-subtle">{label}</p><p className={cn("mt-0.5 truncate font-money text-base font-bold", danger && Number(value) > 0 ? "text-danger" : "text-fg")}>{value}</p></div>;
}

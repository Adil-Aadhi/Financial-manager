"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Clock3, Layers, Plus, Search } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";
import { summarizePlan, type InstallmentPlanSummary } from "@/lib/installments";
import type { InstallmentsServerData } from "@/lib/supabase/installments";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { InstallmentPlanCard, money } from "./InstallmentCard";
import { InstallmentDetailsModal } from "./InstallmentDetailsModal";
import { InstallmentPlanFormModal } from "./InstallmentPlanForm";
import { useInstallmentToday, useInstallmentsData } from "./useInstallments";

type Filter = "all" | "active" | "upcoming" | "pending" | "overdue" | "completed" | "paused" | "cancelled";
const FILTERS: Filter[] = ["all", "active", "upcoming", "pending", "overdue", "completed", "paused", "cancelled"];

function matches(filter: Filter, lifecycle: string, summary: InstallmentPlanSummary) {
  if (filter === "all") return true;
  if (filter === "active") return lifecycle === "active";
  if (filter === "completed" || filter === "paused" || filter === "cancelled") return lifecycle === filter;
  return lifecycle === "active" && summary.status === filter;
}

export function InstallmentTracker({
  ownerId,
  currency,
  server,
  serverToday,
  initialSelectedId,
  initialPaymentId,
  initiallyAdding = false,
}: {
  ownerId: string;
  currency: SupportedCurrency;
  server: InstallmentsServerData;
  serverToday: string;
  initialSelectedId?: string;
  /** Opens this payment's editor (link from a read-only installment expense in Transactions). */
  initialPaymentId?: string;
  initiallyAdding?: boolean;
}) {
  const data = useInstallmentsData(ownerId, server);
  const today = useInstallmentToday(serverToday);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(initiallyAdding);
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? null);

  const summaries = useMemo(
    () => new Map(data.plans.map((plan) => [plan.id, summarizePlan(plan, data.payments, today)])),
    [data.plans, data.payments, today]
  );
  const selected = data.plans.find((plan) => plan.id === selectedId) ?? null;

  // Totals cover active plans in the profile currency only; amounts are never mixed across currencies.
  const active = data.plans.filter((plan) => plan.lifecycle === "active");
  const sameCurrency = active.filter((plan) => plan.currency === currency);
  let upcomingCents = 0;
  let pendingCents = 0;
  let overdueCents = 0;
  for (const plan of sameCurrency) {
    const summary = summaries.get(plan.id)!;
    for (const row of summary.overdueRows) overdueCents += Math.round(row.expectedAmount * 100);
    for (const row of summary.pendingRows) pendingCents += Math.round(row.expectedAmount * 100);
    if (summary.nextRow && summary.nextRow.status !== "overdue") upcomingCents += Math.round(summary.nextRow.expectedAmount * 100);
  }
  const completed = data.plans.filter((plan) => plan.lifecycle === "completed").length;
  const otherCurrencies = active.length - sameCurrency.length;

  const term = query.trim().toLowerCase();
  const visible = data.plans
    .filter((plan) => !term || plan.name.toLowerCase().includes(term) || plan.provider.toLowerCase().includes(term))
    .filter((plan) => matches(filter, plan.lifecycle, summaries.get(plan.id)!))
    .sort((a, b) => {
      const order = (lifecycle: string) => (lifecycle === "active" ? 0 : lifecycle === "paused" ? 1 : lifecycle === "completed" ? 2 : 3);
      const nextA = summaries.get(a.id)!.nextRow?.dueDate ?? "9999-12-31";
      const nextB = summaries.get(b.id)!.nextRow?.dueDate ?? "9999-12-31";
      return order(a.lifecycle) - order(b.lifecycle) || nextA.localeCompare(nextB) || a.name.localeCompare(b.name);
    });

  return (
    <div className="space-y-4 sm:space-y-5">
      {!data.available && <Alert variant="warning" title="Database setup required">Apply the Installments migration before adding plans.</Alert>}
      {data.available && !data.categoryAvailable && (
        <Alert variant="warning">The Installment Payment category is missing, so account payments can&apos;t be recorded yet. Apply the Installments migration.</Alert>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Overview label="Active plans" value={String(active.length)} icon={<Layers className="h-4 w-4" />} />
        <Overview label="Upcoming" value={money(upcomingCents / 100, currency)} icon={<CalendarClock className="h-4 w-4" />} money />
        <Overview label="Pending" value={money(pendingCents / 100, currency)} icon={<Clock3 className="h-4 w-4" />} money />
        <Overview label="Overdue" value={money(overdueCents / 100, currency)} icon={<AlertCircle className="h-4 w-4" />} money danger={overdueCents > 0} />
        <Overview label="Completed" value={String(completed)} icon={<CheckCircle2 className="h-4 w-4" />} />
      </div>
      {otherCurrencies > 0 && <p className="text-xs text-fg-subtle">{otherCurrencies} active plan{otherCurrencies === 1 ? " is" : "s are"} in another currency and not included in these totals.</p>}

      <section className="glass glass-edge rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-fg">Installment plans</h2>
            <p className="hidden text-xs text-fg-subtle sm:block">Only confirmed Linked Account payments create expense transactions.</p>
          </div>
          <Button onClick={() => setAdding(true)} disabled={!data.available} leftIcon={<Plus className="h-4 w-4" />}>New plan</Button>
        </div>
        <label className="mt-4 flex h-11 items-center gap-2 rounded-xl border border-line bg-glass-input px-3">
          <Search className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search plans or providers" aria-label="Search plans" className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle sm:text-sm" />
        </label>
        <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filter plans">
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold capitalize",
                filter === value ? "border-accent/30 bg-accent/12 text-accent" : "border-line bg-glass-hover text-fg-muted"
              )}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((plan) => (
            <InstallmentPlanCard key={plan.id} plan={plan} summary={summaries.get(plan.id)!} onClick={() => setSelectedId(plan.id)} />
          ))}
        </div>
        {!visible.length && (
          <EmptyState
            icon={<CalendarClock className="h-5 w-5" />}
            title={data.plans.length ? "No matching plans" : "No installment plans yet"}
            description={data.plans.length ? "Try another search or filter." : "Track EMIs and Pay Later plans with their schedule and payments."}
            action={!data.plans.length && data.available ? <button type="button" onClick={() => setAdding(true)} className="text-xs font-semibold text-accent">New plan</button> : undefined}
          />
        )}
      </section>

      {adding && <InstallmentPlanFormModal onClose={() => setAdding(false)} currency={currency} today={today} />}
      {selected && (
        <InstallmentDetailsModal
          ownerId={ownerId}
          plan={selected}
          data={data}
          today={today}
          currency={currency}
          initialPaymentId={selected.id === initialSelectedId ? initialPaymentId : undefined}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function Overview({ label, value, icon, danger = false, money: isMoney = false }: { label: string; value: string; icon: React.ReactNode; danger?: boolean; money?: boolean }) {
  return (
    <div className="glass rounded-2xl p-3.5">
      <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl", danger ? "bg-danger/12 text-danger" : "bg-accent-soft text-accent")}>{icon}</span>
      <p className="mt-3 text-[11px] font-medium text-fg-subtle">{label}</p>
      <p className={cn("mt-0.5 truncate text-base font-bold", isMoney && "font-money", danger ? "text-danger" : "text-fg")}>{value}</p>
    </div>
  );
}

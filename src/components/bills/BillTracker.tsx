"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Clock3, ReceiptText, Search } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionRefreshIndicator } from "@/components/ui/SectionRefreshIndicator";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import type { BillsServerData } from "@/lib/supabase/bills";
import { BILL_CATEGORIES, billMonthlyEstimate, billPaymentsForMonth, billStatus, type BillCategory } from "@/lib/bills";
import { BillCard } from "./BillCard";
import { BillDetailsModal, BillFormModal } from "./BillModals";
import { useBillsData, useBillToday } from "./useBills";

type Filter = "all" | "upcoming" | "pending" | "paid" | "overdue" | "paused" | "cancelled";
const FILTERS: Filter[] = ["all", "upcoming", "pending", "paid", "overdue", "paused", "cancelled"];

export function BillTracker({ ownerId, currency, server, serverToday, initialSelectedId, initiallyAdding = false }: { ownerId: string; currency: SupportedCurrency; server: BillsServerData; serverToday: string; initialSelectedId?: string; initiallyAdding?: boolean }) {
  const data = useBillsData(ownerId, server);
  const today = useBillToday(serverToday);
  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategory] = useState<"all" | BillCategory>("all");
  const [query, setQuery] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [adding, setAdding] = useState(initiallyAdding);
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? null);
  const selected = data.bills.find((bill) => bill.id === selectedId) ?? null;
  // Month summaries follow the billing cycle's due date, so a late December payment for a
  // November bill remains in November's history.
  const paidInMonth = billPaymentsForMonth(data.payments, selectedMonth);
  const paidBillIds = useMemo(() => new Set(paidInMonth.map((payment) => payment.bill_id)), [paidInMonth]);
  const actualPaid = paidInMonth.filter((payment) => data.bills.find((bill) => bill.id === payment.bill_id)?.currency === currency).reduce((sum, payment) => sum + Number(payment.actual_amount), 0);
  const active = data.bills.filter((bill) => bill.lifecycle === "active");
  const statuses = active.map((bill) => billStatus(bill, today));
  const estimate = active.filter((bill) => bill.currency === currency).reduce((sum, bill) => sum + billMonthlyEstimate(bill), 0);
  const visible = data.bills.filter((bill) => bill.name.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((bill) => category === "all" || bill.category === category)
    .filter((bill) => filter === "all" || (filter === "paid" ? paidBillIds.has(bill.id) : billStatus(bill, today) === filter))
    .sort((a, b) => a.next_due_date.localeCompare(b.next_due_date));
  return <div className="space-y-4 sm:space-y-5">
    {!data.available && <Alert variant="warning" title="Database setup required">Apply the Bills migration before adding bills.</Alert>}
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Overview label="Active" value={String(active.length)} icon={<ReceiptText className="h-4 w-4" />} />
      <Overview label="Monthly estimate" value={formatMoney(estimate, currency, { compact: true })} icon={<CalendarClock className="h-4 w-4" />} />
      <Overview label="Paid in month" value={String(paidInMonth.length)} icon={<CheckCircle2 className="h-4 w-4" />} />
      <Overview label="Pending" value={String(statuses.filter((value) => value === "pending").length)} icon={<Clock3 className="h-4 w-4" />} />
      <Overview label="Overdue" value={String(statuses.filter((value) => value === "overdue").length)} icon={<AlertCircle className="h-4 w-4" />} danger />
      <Overview label="Upcoming" value={String(statuses.filter((value) => value === "upcoming").length)} icon={<CalendarClock className="h-4 w-4" />} />
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-glass-hover px-4 py-3"><label className="flex items-center gap-2 text-xs font-medium text-fg-muted">History month <input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="h-9 rounded-xl border border-line bg-glass-input px-3 text-base text-fg outline-none sm:text-sm" /></label><p className="text-xs text-fg-muted">Actual paid: <span className="font-money font-semibold text-fg">{formatMoney(actualPaid, currency)}</span></p></div>
    <section className="glass glass-edge relative rounded-2xl p-4 sm:p-5">
      <SectionRefreshIndicator scope="bills" className="absolute right-4 top-16 rounded-full bg-glass-strong px-2 py-1 sm:right-32 sm:top-5" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold tracking-tight text-fg">All bills</h2><p className="text-xs text-fg-subtle">Expected amounts are estimates; paid amounts come from confirmations.</p></div><Button onClick={() => setAdding(true)} disabled={!data.available}>Add bill</Button></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_190px]"><label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-glass-input px-3"><Search className="h-4 w-4 text-fg-subtle" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search bills" className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle sm:text-sm" /></label><select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value as "all" | BillCategory)} className="h-11 rounded-xl border border-line bg-glass-input px-3 text-base text-fg outline-none sm:text-sm"><option value="all">All categories</option>{BILL_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
      <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist">{FILTERS.map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold capitalize", filter === value ? "border-accent/30 bg-accent/12 text-accent" : "border-line bg-glass-hover text-fg-muted")}>{value}</button>)}</div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map((bill) => <BillCard key={bill.id} bill={bill} today={today} onClick={() => setSelectedId(bill.id)} />)}</div>
      {!visible.length && <EmptyState icon={<ReceiptText className="h-5 w-5" />} title={data.bills.length ? "No matching bills" : "No bills yet"} description={data.bills.length ? "Try another search or filter." : "Add a recurring obligation to track its due date and payment history."} action={!data.bills.length && data.available ? <button type="button" onClick={() => setAdding(true)} className="text-xs font-semibold text-accent">Add bill</button> : undefined} />}
    </section>
    {adding && <BillFormModal isOpen onClose={() => setAdding(false)} currency={currency} today={today} />}
    {selected && <BillDetailsModal bill={selected} payments={data.payments} today={today} currency={currency} onClose={() => setSelectedId(null)} />}
  </div>;
}

function Overview({ label, value, icon, danger = false }: { label: string; value: string; icon: React.ReactNode; danger?: boolean }) {
  return <div className="glass rounded-2xl p-3.5"><span className={cn("flex h-8 w-8 items-center justify-center rounded-xl", danger ? "bg-danger/12 text-danger" : "bg-accent-soft text-accent")}>{icon}</span><p className="mt-3 text-[11px] font-medium text-fg-subtle">{label}</p><p className={cn("mt-0.5 truncate font-money text-base font-bold", danger && Number(value) > 0 ? "text-danger" : "text-fg")}>{value}</p></div>;
}

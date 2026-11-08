"use client";

import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { BillCard } from "./BillCard";
import { Card, CardLink } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatMoney } from "@/lib/format";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import type { BillsServerData } from "@/lib/supabase/bills";
import { billMonthlyEstimate, billStatus } from "@/lib/bills";
import { useBillsData, useBillToday } from "./useBills";

export function BillsHomeCard({ ownerId, currency, server, serverToday }: { ownerId: string; currency: SupportedCurrency; server: BillsServerData; serverToday: string }) {
  const data = useBillsData(ownerId, server);
  const today = useBillToday(serverToday);
  const active = data.bills.filter((bill) => bill.lifecycle === "active");
  const upcoming = [...active].sort((a, b) => a.next_due_date.localeCompare(b.next_due_date)).slice(0, 3);
  const estimate = active.filter((bill) => bill.currency === currency).reduce((sum, bill) => sum + billMonthlyEstimate(bill), 0);
  const overdue = active.filter((bill) => billStatus(bill, today) === "overdue").length;
  const pending = active.filter((bill) => billStatus(bill, today) === "pending").length;
  return <Card title="Upcoming Bills" description={active.length ? `${active.length} active · ${formatMoney(estimate, currency, { compact: true })}/month estimated${pending || overdue ? ` · ${pending} due · ${overdue} overdue` : ""}` : undefined} action={<CardLink href="/bills">View all</CardLink>}>
    {!data.available ? <EmptyState icon={<ReceiptText className="h-5 w-5" />} title="Bills need setup" description="Apply the Bills database migration to enable this feature." /> : upcoming.length ? <div className="grid gap-3 lg:grid-cols-3">{upcoming.map((bill) => <Link key={bill.id} href={`/bills?selected=${bill.id}`} className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"><BillCard bill={bill} today={today} compact /></Link>)}</div> : <EmptyState icon={<ReceiptText className="h-5 w-5" />} title="No active bills" description="Track bills without changing balances or creating transactions." action={<Link href="/bills?add=1" className="text-xs font-semibold text-accent">Add bill</Link>} />}
  </Card>;
}

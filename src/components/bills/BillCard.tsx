"use client";

import { CalendarDays } from "lucide-react";
import { BillIconTile } from "./BillIcon";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { billCategoryLabel, billCycleLabel, billProgress, billStatus, daysBetweenBillDates, formatBillDate, type BillRecord, type BillStatus } from "@/lib/bills";

export function BillStatusBadge({ status }: { status: BillStatus | "paid" }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
    status === "upcoming" && "bg-info/12 text-info", status === "pending" && "bg-warning/12 text-warning",
    status === "overdue" && "bg-danger/12 text-danger", status === "paid" && "bg-positive/12 text-positive",
    status === "paused" && "bg-glass-hover text-fg-muted", status === "cancelled" && "bg-glass-hover text-fg-subtle")}>{status}</span>;
}

export function BillCard({ bill, today, onClick, compact = false }: { bill: BillRecord; today: string; onClick?: () => void; compact?: boolean }) {
  const status = billStatus(bill, today);
  const days = daysBetweenBillDates(today, bill.next_due_date);
  const reminderDue = bill.lifecycle === "active" && days > 0 && days <= bill.reminder_days;
  const expected = bill.expected_amount === null ? "Amount not estimated" : formatMoney(Number(bill.expected_amount), bill.currency as SupportedCurrency);
  const content = <div className="flex items-start gap-3">
    <BillIconTile icon={bill.icon} />
    <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-fg">{bill.name}</p><p className="mt-0.5 truncate text-xs text-fg-muted"><span className="font-money font-semibold">{expected}</span> · {billCategoryLabel(bill.category)}</p></div><BillStatusBadge status={status} /></div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-fg-subtle"><span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{formatBillDate(bill.next_due_date)}</span>{bill.lifecycle === "active" && <span className={cn(days < 0 && "font-semibold text-danger", days === 0 && "font-semibold text-warning")}>{days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today" : `${days}d left`}</span>}</div>
      {!compact && <p className="mt-1 text-[11px] text-fg-subtle">{billCycleLabel(bill.billing_cycle, bill.billing_interval)}{reminderDue ? " · Reminder window" : ""}</p>}
      {bill.lifecycle === "active" && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><span className={cn("block h-full rounded-full", status === "overdue" ? "bg-danger" : status === "pending" ? "bg-warning" : "bg-brand")} style={{ width: `${billProgress(bill, today)}%` }} /></div>}
    </div>
  </div>;
  if (!onClick) return <div className="rounded-2xl border border-line bg-glass-hover p-3.5">{content}</div>;
  return <button type="button" onClick={onClick} className="w-full rounded-2xl border border-line bg-glass-hover p-3.5 text-left transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">{content}</button>;
}

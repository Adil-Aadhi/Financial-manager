"use client";

import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import {
  formatInstallmentDate,
  type InstallmentPlanRecord,
  type InstallmentPlanStatus,
  type InstallmentRowStatus,
  type InstallmentPlanSummary,
} from "@/lib/installments";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { InstallmentIconTile } from "./InstallmentIcon";

export function money(amount: number | string, currency: string, compact = false) {
  const value = Number(amount);
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return formatMoney(safe, currency as SupportedCurrency, { compact });
  } catch {
    return `${currency} ${safe.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  }
}

const STATUS_LABEL: Record<InstallmentPlanStatus | InstallmentRowStatus, string> = {
  paid: "Paid",
  closed: "Closed early",
  overdue: "Overdue",
  pending: "Pending",
  upcoming: "Upcoming",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function InstallmentStatusBadge({ status }: { status: InstallmentPlanStatus | InstallmentRowStatus }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        status === "upcoming" && "bg-info/12 text-info",
        status === "pending" && "bg-warning/12 text-warning",
        status === "overdue" && "bg-danger/12 text-danger",
        (status === "paid" || status === "completed") && "bg-positive/12 text-positive",
        status === "closed" && "bg-positive/12 text-positive",
        status === "active" && "bg-accent-soft text-accent",
        status === "paused" && "bg-glass-hover text-fg-muted",
        status === "cancelled" && "bg-glass-hover text-fg-subtle"
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function dueLabel(days: number) {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  return `${days}d left`;
}

export function InstallmentPlanCard({
  plan,
  summary,
  onClick,
}: {
  plan: InstallmentPlanRecord;
  summary: InstallmentPlanSummary;
  onClick?: () => void;
}) {
  const next = summary.nextRow;
  const content = (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <InstallmentIconTile icon={plan.icon} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">{plan.name}</p>
              <p className="mt-0.5 truncate text-xs text-fg-muted">{plan.provider}</p>
            </div>
            <InstallmentStatusBadge status={summary.status} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
        <Figure label="Installment" value={money(plan.default_installment_amount, plan.currency)} />
        <Figure label="Remaining" value={money(summary.remainingCents / 100, plan.currency)} />
        <Figure label="Total repayment" value={money(plan.total_repayment_amount, plan.currency)} />
        <Figure label="Financed" value={money(plan.financed_amount, plan.currency)} />
        <Figure label="Price" value={money(plan.original_amount, plan.currency)} />
        <Figure label="Paid" value={`${summary.settledCount}/${plan.installment_count}`} />
      </div>
      <div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-fg-subtle">
          <span className="flex items-center gap-1">
            <CalendarDays className="h-3 w-3" aria-hidden="true" />
            {next ? `Next ${formatInstallmentDate(next.dueDate)}` : "All installments settled"}
          </span>
          {next && plan.lifecycle === "active" && (
            <span className={cn(next.daysUntilDue < 0 && "font-semibold text-danger", next.daysUntilDue === 0 && "font-semibold text-warning")}>
              {dueLabel(next.daysUntilDue)}
            </span>
          )}
        </div>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={summary.progress}
          aria-label={`${summary.settledCount} of ${plan.installment_count} installments settled`}
        >
          <span
            className={cn("block h-full rounded-full", summary.status === "overdue" ? "bg-danger" : summary.status === "pending" ? "bg-warning" : "bg-brand")}
            style={{ width: `${summary.progress}%` }}
          />
        </div>
      </div>
    </div>
  );
  if (!onClick) return <div className="rounded-2xl border border-line bg-glass-hover p-3.5">{content}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl border border-line bg-glass-hover p-3.5 text-left transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      {content}
    </button>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-fg-subtle">{label}</p>
      <p className="truncate font-money text-xs font-semibold text-fg">{value}</p>
    </div>
  );
}

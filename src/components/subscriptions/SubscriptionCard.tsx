"use client";

import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import {
  cycleLabel,
  cycleProgress,
  daysRemaining,
  formatSubscriptionDate,
  subscriptionStatus,
  type SubscriptionRecord,
} from "@/lib/subscriptions";
import { SubscriptionIconTile } from "./SubscriptionIcon";

export function SubscriptionStatusBadge({ status }: { status: ReturnType<typeof subscriptionStatus> }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
        status === "upcoming" && "bg-info/12 text-info",
        status === "pending" && "bg-warning/12 text-warning",
        status === "overdue" && "bg-danger/12 text-danger",
        status === "paused" && "bg-glass-hover text-fg-muted",
        status === "cancelled" && "bg-glass-hover text-fg-subtle"
      )}
    >
      {status}
    </span>
  );
}

export function SubscriptionCard({
  subscription,
  today,
  onClick,
  compact = false,
}: {
  subscription: SubscriptionRecord;
  today: string;
  onClick?: () => void;
  compact?: boolean;
}) {
  const status = subscriptionStatus(subscription, today);
  const days = daysRemaining(subscription, today);
  const progress = cycleProgress(subscription, today);
  const content = (
    <>
      <div className="flex items-start gap-3">
        <SubscriptionIconTile icon={subscription.icon} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">{subscription.name}</p>
              <p className="mt-0.5 font-money text-xs font-semibold text-fg-muted">
                {formatMoney(Number(subscription.amount), subscription.currency as SupportedCurrency)} · {cycleLabel(subscription.billing_cycle)}
              </p>
            </div>
            <SubscriptionStatusBadge status={status} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-fg-subtle">
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3 w-3" /> {formatSubscriptionDate(subscription.next_payment_date, !compact)}
            </span>
            {subscription.lifecycle === "active" && (
              <span className={cn(days < 0 && "font-semibold text-danger", days === 0 && "font-semibold text-warning")}> 
                {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today" : `${days}d left`}
              </span>
            )}
          </div>
          {subscription.lifecycle === "active" && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-label={`${progress}% of billing cycle elapsed`}>
              <span className={cn("block h-full rounded-full", status === "overdue" ? "bg-danger" : status === "pending" ? "bg-warning" : "bg-brand")} style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      </div>
    </>
  );

  if (!onClick) return <div className="rounded-2xl border border-line bg-glass-hover p-3.5">{content}</div>;
  return (
    <button type="button" onClick={onClick} className="w-full cursor-pointer rounded-2xl border border-line bg-glass-hover p-3.5 text-left transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
      {content}
    </button>
  );
}

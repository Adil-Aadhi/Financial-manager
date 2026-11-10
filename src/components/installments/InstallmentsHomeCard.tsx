"use client";

import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Card, CardLink } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionRefreshIndicator } from "@/components/ui/SectionRefreshIndicator";
import { cn } from "@/lib/cn";
import { formatInstallmentDate, upcomingInstallments } from "@/lib/installments";
import type { InstallmentsServerData } from "@/lib/supabase/installments";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { InstallmentStatusBadge, dueLabel, money } from "./InstallmentCard";
import { InstallmentIconTile } from "./InstallmentIcon";
import { useInstallmentToday, useInstallmentsData } from "./useInstallments";

/** Next unpaid installment of every active plan. Paused, cancelled and completed plans are excluded. */
export function InstallmentsHomeCard({
  ownerId,
  currency,
  server,
  serverToday,
}: {
  ownerId: string;
  currency: SupportedCurrency;
  server: InstallmentsServerData;
  serverToday: string;
}) {
  const data = useInstallmentsData(ownerId, server);
  const today = useInstallmentToday(serverToday);
  const upcoming = upcomingInstallments(data.plans, data.payments, today);
  const totalCents = upcoming
    .filter((item) => item.plan.currency === currency)
    .reduce((sum, item) => sum + Math.round(item.row.expectedAmount * 100), 0);
  const description = upcoming.length
    ? `${upcoming.length} upcoming · ${money(totalCents / 100, currency)} expected`
    : undefined;

  return (
    <Card title="Upcoming Installments" description={description} action={<><SectionRefreshIndicator scope="installments" className="absolute right-20 top-4 sm:top-5" /><CardLink href="/installments">View all</CardLink></>}>
      {!data.available ? (
        <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="Installments need setup" description="Apply the Installments database migration to enable this feature." />
      ) : upcoming.length ? (
        <div className="grid gap-3 lg:grid-cols-3">
          {upcoming.slice(0, 3).map(({ plan, row, progressLabel, progress }) => (
            <Link
              key={plan.id}
              href={`/installments?selected=${plan.id}`}
              className="rounded-2xl border border-line bg-glass-hover p-3.5 transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <div className="flex items-start gap-3">
                <InstallmentIconTile icon={plan.icon} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-fg">{plan.name}</p>
                      <p className="truncate text-xs text-fg-muted">{plan.provider}</p>
                    </div>
                    <InstallmentStatusBadge status={row.status} />
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <p className="font-money text-sm font-bold text-fg">{money(row.expectedAmount, plan.currency)}</p>
                    <p className="text-[11px] text-fg-subtle">{progressLabel} paid</p>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-fg-subtle">
                    <span>{row.number}/{plan.installment_count} · {formatInstallmentDate(row.dueDate)}</span>
                    <span className={cn(row.daysUntilDue < 0 && "font-semibold text-danger", row.daysUntilDue === 0 && "font-semibold text-warning")}>{dueLabel(row.daysUntilDue)}</span>
                  </div>
                  {plan.lifecycle === "active" && (
                    <div
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress}
                      aria-label={`${progress}% of installment cycle elapsed`}
                    >
                      <span
                        className={cn(
                          "block h-full rounded-full",
                          row.status === "overdue"
                            ? "bg-danger"
                            : row.status === "pending"
                              ? "bg-warning"
                              : row.status === "paid" || row.status === "closed"
                                ? "bg-positive"
                                : "bg-brand"
                        )}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<CalendarClock className="h-5 w-5" />}
          title="No upcoming installments"
          description="Track EMIs and Pay Later plans; paying from an account records the expense."
          action={<Link href="/installments?add=1" className="text-xs font-semibold text-accent">New plan</Link>}
        />
      )}
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import { statusLabel, type LedgerChange, type ObligationBalance } from "@/lib/ledger";
import { markOfflineDataStale } from "@/lib/offline/bootstrap";
import { mutateLedger } from "@/lib/offline/ledgerMutations";
import type { SupportedCurrency } from "@/lib/supabase/profile";

export function ledgerMoney(cents: number, currency: string, compact = false) {
  const amount = cents / 100;
  try {
    return formatMoney(amount, currency as SupportedCurrency, { compact });
  } catch {
    return `${currency} ${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  }
}

export function StatusBadge({ balance }: { balance: Pick<ObligationBalance, "status" | "partial"> }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        balance.status === "paid" && "bg-positive/12 text-positive",
        balance.status === "pending" && "bg-info/12 text-info",
        balance.status === "partial" && "bg-warning/12 text-warning",
        balance.status === "overdue" && "bg-danger/12 text-danger"
      )}
    >
      {statusLabel(balance)}
    </span>
  );
}

export function StatTile({
  label,
  value,
  icon,
  danger = false,
  hint,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  danger?: boolean;
  hint?: string;
}) {
  return (
    <div className="glass rounded-2xl p-3.5">
      <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl", danger ? "bg-danger/12 text-danger" : "bg-accent-soft text-accent")}>{icon}</span>
      <p className="mt-3 text-[11px] font-medium text-fg-subtle">{label}</p>
      <p className={cn("mt-0.5 truncate text-base font-bold font-money", danger ? "text-danger" : "text-fg")}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-fg-subtle">{hint}</p>}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("glass glass-edge relative rounded-2xl p-4 sm:p-5", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-fg-subtle">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function FormSectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{children}</h3>;
}

/** Filter chips, the same look as the other trackers. */
export function FilterChips<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
}) {
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold",
            value === option.value ? "border-accent/30 bg-accent/12 text-accent" : "border-line bg-glass-hover text-fg-muted"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Saves ledger changes and reports the outcome. Changes saved on this device are picked up by the
 * live queries on their own; a change that went through the server also refreshes the local copy.
 */
export function useLedgerSave() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = (changes: LedgerChange[], onSuccess?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await mutateLedger(changes);
      if (!result.success) {
        setError(result.error ?? "Unable to save this change.");
        return;
      }
      if (!result.queued) {
        markOfflineDataStale(["ledger"]);
        router.refresh();
      }
      onSuccess?.();
    });
  };

  return { save, pending, error, setError };
}

export function newId() {
  return crypto.randomUUID();
}

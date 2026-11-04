import React from "react";
import Link from "next/link";
import { ArrowUpRight, Landmark } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { SupportedCurrency } from "@/lib/supabase/profile";

export interface AccountListItem {
  id: string;
  name: string;
  opening_balance: number | string | null;
  currency: string | null;
}

/** Account rows linking to /accounts/[id]. Same row style as the dashboard Accounts card. */
export function AccountList({
  accounts,
  fallbackCurrency,
}: {
  accounts: AccountListItem[];
  fallbackCurrency: SupportedCurrency;
}) {
  return (
    <div className="space-y-2 p-1">
      {accounts.map((acc) => (
        <Link
          key={acc.id}
          href={`/accounts/${acc.id}`}
          className="flex items-center justify-between rounded-xl border border-line bg-glass-hover p-3 transition-colors hover:border-accent/40"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Landmark className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-semibold text-fg">{acc.name}</p>
              <p className="font-mono text-[11px] text-fg-subtle">
                {formatMoney(
                  Number(acc.opening_balance) || 0,
                  (acc.currency as SupportedCurrency) || fallbackCurrency
                )}
              </p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-fg-subtle" />
        </Link>
      ))}
    </div>
  );
}

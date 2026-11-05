"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Landmark, Pencil, Trash2 } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { Button } from "@/components/ui/Button";
import {
  DeleteAccountModal,
  EditAccountModal,
} from "@/components/accounts/AccountModals";

export interface AccountListItem {
  id: string;
  name: string;
  opening_balance: number | string | null;
  currency: string | null;
  total_income?: number | string | null;
  total_expense?: number | string | null;
}

/** Account summary cards with edit, Trash, and detail actions. */
export function AccountList({
  accounts,
  fallbackCurrency,
  actionsEnabled = true,
}: {
  accounts: AccountListItem[];
  fallbackCurrency: SupportedCurrency;
  actionsEnabled?: boolean;
}) {
  const [editingAccount, setEditingAccount] =
    useState<AccountListItem | null>(null);
  const [deletingAccount, setDeletingAccount] =
    useState<AccountListItem | null>(null);

  return (
    <>
      <div className="grid gap-3 p-1 lg:grid-cols-2">
        {accounts.map((acc) => {
          const currency =
            (acc.currency as SupportedCurrency) || fallbackCurrency;
          const openingBalance = Number(acc.opening_balance) || 0;
          const totalIncome = Number(acc.total_income) || 0;
          const totalExpense = Number(acc.total_expense) || 0;
          const balance = openingBalance + totalIncome - totalExpense;

          const metrics = [
            {
              label: "Opening amount",
              amount: openingBalance,
              className: "text-fg",
            },
            {
              label: "Balance",
              amount: balance,
              className: "text-fg",
            },
            {
              label: "Total income",
              amount: totalIncome,
              className: "text-positive",
            },
            {
              label: "Total expense",
              amount: totalExpense,
              className: "text-danger",
            },
          ];

          return (
            <article
              key={acc.id}
              className="rounded-2xl border border-line bg-glass-hover p-4 transition-colors hover:border-accent/40"
            >
              <div className="flex items-center justify-between gap-3">
                <Link
                  href={`/accounts/${acc.id}`}
                  className="flex min-w-0 items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <Landmark className="h-4 w-4" />
                  </span>
                  <p className="truncate text-sm font-semibold text-fg">
                    {acc.name}
                  </p>
                </Link>

                <div className="flex shrink-0 items-center gap-1">
                  {actionsEnabled && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => setEditingAccount(acc)}
                        aria-label={`Edit ${acc.name}`}
                        title="Edit account"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-danger hover:bg-danger/10 hover:text-danger"
                        onClick={() => setDeletingAccount(acc)}
                        aria-label={`Delete ${acc.name}`}
                        title="Move to Trash"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  <Link
                    href={`/accounts/${acc.id}`}
                    aria-label={`Open ${acc.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-glass-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                {metrics.map((metric) => (
                  <div key={metric.label} className="min-w-0">
                    <dt className="text-[11px] font-medium text-fg-subtle">
                      {metric.label}
                    </dt>
                    <dd
                      className={`mt-1 truncate font-mono text-xs font-semibold ${metric.className}`}
                      title={formatMoney(metric.amount, currency)}
                    >
                      {formatMoney(metric.amount, currency)}
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          );
        })}
      </div>

      {editingAccount && (
        <EditAccountModal
          key={editingAccount.id}
          account={editingAccount}
          isOpen
          onClose={() => setEditingAccount(null)}
        />
      )}

      {deletingAccount && (
        <DeleteAccountModal
          key={deletingAccount.id}
          account={deletingAccount}
          isOpen
          onClose={() => setDeletingAccount(null)}
        />
      )}
    </>
  );
}

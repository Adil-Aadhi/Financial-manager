"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Landmark, Pencil, Trash2 } from "lucide-react";
import type { AccountGroup } from "@/lib/accounts";
import { cn } from "@/lib/cn";
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
  account_group?: AccountGroup | string | null;
  total_income?: number | string | null;
  total_expense?: number | string | null;
}

/** Account summary cards with edit, Trash, and detail actions. */
export function AccountList({
  accounts,
  fallbackCurrency,
  actionsEnabled = true,
  onAccountSaved,
}: {
  accounts: AccountListItem[];
  fallbackCurrency: SupportedCurrency;
  actionsEnabled?: boolean;
  /** Called after an account edit is saved, with the account's (possibly new) group. */
  onAccountSaved?: (group: AccountGroup) => void;
}) {
  const [editingAccount, setEditingAccount] =
    useState<AccountListItem | null>(null);
  const [deletingAccount, setDeletingAccount] =
    useState<AccountListItem | null>(null);

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        {accounts.map((acc) => {
          const currency =
            (acc.currency as SupportedCurrency) || fallbackCurrency;
          const openingBalance = Number(acc.opening_balance) || 0;
          const totalIncome = Number(acc.total_income) || 0;
          const totalExpense = Number(acc.total_expense) || 0;
          const balance = openingBalance + totalIncome - totalExpense;

          return (
            <article
              key={acc.id}
              className="relative overflow-hidden rounded-2xl border border-line bg-glass-hover p-4 transition-colors hover:border-accent/40"
            >
              <div className="pointer-events-none absolute -right-12 -top-14 h-36 w-36 rounded-full bg-[radial-gradient(circle,var(--aurora-1),transparent_70%)]" />

              <div className="relative flex items-center justify-between gap-3">
                <Link
                  href={`/accounts/${acc.id}`}
                  className="flex min-w-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand text-accent-fg shadow-glow">
                    <span className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent" />
                    <Landmark className="relative h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-fg">{acc.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-fg-subtle">
                      Opening{" "}
                      <span className="font-money font-semibold">
                        {formatMoney(openingBalance, currency)}
                      </span>
                    </p>
                  </div>
                </Link>

                <div className="flex shrink-0 items-center gap-0.5">
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
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              <Link
                href={`/accounts/${acc.id}`}
                tabIndex={-1}
                className="relative mt-4 block"
              >
                <p className="text-[11px] font-medium text-fg-subtle">Balance</p>
                <p
                  className={cn(
                    "mt-0.5 truncate font-money text-[26px] font-bold leading-tight tracking-tight",
                    balance > 0 ? "text-positive" : balance < 0 ? "text-danger" : "text-fg"
                  )}
                  title={formatMoney(balance, currency)}
                >
                  {formatMoney(balance, currency)}
                </p>
              </Link>

              <dl className="relative mt-3 grid grid-cols-2 gap-2">
                <FlowTile label="Income" value={formatMoney(totalIncome, currency)} tone="positive" />
                <FlowTile label="Expenses" value={formatMoney(totalExpense, currency)} tone="negative" />
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
          onSaved={onAccountSaved}
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

function FlowTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "negative";
}) {
  const positive = tone === "positive";
  return (
    <div className="min-w-0 rounded-xl border border-line bg-glass-input px-3 py-2.5">
      <dt
        className={cn(
          "flex items-center gap-1 text-[11px] font-medium",
          positive ? "text-positive" : "text-danger"
        )}
      >
        {positive ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
        {label}
      </dt>
      <dd className="mt-0.5 truncate font-money text-sm font-bold text-fg" title={value}>
        {value}
      </dd>
    </div>
  );
}

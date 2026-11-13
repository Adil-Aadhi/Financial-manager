"use client";

import { useState } from "react";
import { Plus, ReceiptText, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionRefreshIndicator } from "@/components/ui/SectionRefreshIndicator";
import { formatLedgerDate } from "@/lib/ledger";
import { useLedger } from "./LedgerProvider";
import { MigrationNotice } from "./OverviewView";
import { FilterChips, SectionCard, ledgerMoney } from "./ledgerUi";

type Filter = "all" | "outstanding" | "settled";

export function ExpensesView() {
  const { data, model, open } = useLedger();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const expenses = data.expenses
    .filter((expense) => {
      const outstanding = model.expenseSummaries.get(expense.id)?.outstandingCents ?? 0;
      return filter === "all" ? true : filter === "outstanding" ? outstanding > 0 : outstanding === 0;
    })
    .filter((expense) => !term || expense.title.toLowerCase().includes(term) || (expense.category ?? "").toLowerCase().includes(term))
    .sort((a, b) => b.expense_date.localeCompare(a.expense_date) || b.created_at.localeCompare(a.created_at));

  return (
    <div className="space-y-4">
      <MigrationNotice />
      <SectionCard
        title="Shared expenses"
        description="Bills you paid that other people owe a share of."
        action={
          <div className="flex items-center gap-2">
            <SectionRefreshIndicator scope="ledger" className="rounded-full bg-glass-strong px-2 py-1" />
            <Button size="sm" disabled={!data.available} leftIcon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "expense" })}>
              New expense
            </Button>
          </div>
        }
      >
        <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-glass-input px-3">
          <Search className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search expenses" aria-label="Search expenses" className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle sm:text-sm" />
        </label>
        <div className="mt-4">
          <FilterChips
            label="Filter expenses"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "outstanding", label: "Outstanding" },
              { value: "settled", label: "Settled" },
            ]}
          />
        </div>

        <ul className="mt-4 space-y-2">
          {expenses.map((expense) => {
            const summary = model.expenseSummaries.get(expense.id);
            const shareCount = data.obligations.filter((obligation) => obligation.expense_id === expense.id).length;
            return (
              <li key={expense.id}>
                <button
                  type="button"
                  onClick={() => open({ kind: "expenseDetails", expenseId: expense.id })}
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-glass-hover/50 px-3 py-3 text-left transition-colors hover:bg-glass-hover"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <ReceiptText className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg">{expense.title}</span>
                    <span className="block truncate text-xs text-fg-subtle">
                      {formatLedgerDate(expense.expense_date)} · {shareCount} {shareCount === 1 ? "person" : "people"}
                      {expense.category ? ` · ${expense.category}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-money text-sm font-bold text-fg">{ledgerMoney(Math.round(Number(expense.total_amount) * 100), expense.currency)}</span>
                    <span className={(summary?.outstandingCents ?? 0) > 0 ? "block text-[11px] font-medium text-warning" : "block text-[11px] font-medium text-positive"}>
                      {(summary?.outstandingCents ?? 0) > 0 ? `${ledgerMoney(summary!.outstandingCents, expense.currency)} owed` : "Settled"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {expenses.length === 0 && (
          <EmptyState
            icon={<ReceiptText className="h-5 w-5" />}
            title={data.expenses.length ? "No matching expenses" : "No shared expenses yet"}
            description={data.expenses.length ? "Try another search or filter." : "Split a bill between people and track who has paid you back."}
            action={
              !data.expenses.length && data.available ? (
                <Button size="sm" onClick={() => open({ kind: "expense" })}>
                  New expense
                </Button>
              ) : undefined
            }
          />
        )}
      </SectionCard>
    </div>
  );
}

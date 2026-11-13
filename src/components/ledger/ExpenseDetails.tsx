"use client";

import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatLedgerDate } from "@/lib/ledger";
import { useLedger } from "./LedgerProvider";
import { ObligationRow } from "./ObligationParts";
import { ledgerMoney } from "./ledgerUi";

/** A shared expense: the total, who owes what and what has been collected so far. */
export function ExpenseDetailsModal({ expenseId }: { expenseId: string }) {
  const { data, model, open, close } = useLedger();
  const expense = data.expenses.find((item) => item.id === expenseId);

  if (!expense) {
    return (
      <Modal isOpen onClose={close} title="Expense" size="lg">
        <p className="text-sm text-fg-muted">This expense no longer exists.</p>
      </Modal>
    );
  }

  const summary = model.expenseSummaries.get(expense.id);
  const shares = data.obligations
    .filter((obligation) => obligation.expense_id === expense.id)
    .sort((a, b) => (data.people.find((p) => p.id === a.person_id)?.name ?? "").localeCompare(data.people.find((p) => p.id === b.person_id)?.name ?? ""));
  const totalCents = Math.round(Number(expense.total_amount) * 100);

  return (
    <Modal
      isOpen
      onClose={close}
      title={expense.title}
      description={[formatLedgerDate(expense.expense_date), expense.category, expense.description].filter(Boolean).join(" · ")}
      size="lg"
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          {[
            ["You paid", ledgerMoney(totalCents, expense.currency)],
            ["Owed by others", ledgerMoney(summary?.allocatedCents ?? 0, expense.currency)],
            ["Collected", ledgerMoney(summary?.collectedCents ?? 0, expense.currency)],
            ["Outstanding", ledgerMoney(summary?.outstandingCents ?? 0, expense.currency)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line bg-glass-hover px-2 py-2.5">
              <p className="text-[10px] font-medium text-fg-subtle">{label}</p>
              <p className="font-money text-sm font-bold text-fg">{value}</p>
            </div>
          ))}
        </div>
        {(summary?.unallocatedCents ?? 0) > 0 && (
          <p className="rounded-xl border border-line bg-glass-hover px-3 py-2 text-xs text-fg-muted">
            {ledgerMoney(summary!.unallocatedCents, expense.currency)} is unallocated: nobody owes it.
          </p>
        )}

        <Button size="sm" variant="outline" leftIcon={<Pencil className="h-4 w-4" />} onClick={() => open({ kind: "expense", expenseId: expense.id })}>
          Edit expense
        </Button>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Shares</h3>
          <div className="space-y-1.5">
            {shares.map((share) => (
              <ObligationRow key={share.id} obligation={share} />
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}

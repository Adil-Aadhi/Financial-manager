"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import { dueDeleteBlock, formatLedgerDate, periodLabel, type LedgerObligationRecord } from "@/lib/ledger";
import { useLedger } from "./LedgerProvider";
import { StatusBadge, ledgerMoney, useLedgerSave } from "./ledgerUi";

/** Where a due came from, in words: "Spotify Family · November 2026", "KSEB bill", "Manual". */
export function useObligationSource() {
  const { data } = useLedger();
  return (obligation: LedgerObligationRecord) => {
    if (obligation.source === "recurring") {
      const group = data.groups.find((item) => item.id === obligation.group_id);
      return group && obligation.period_start ? `${group.name} · ${periodLabel(group, obligation.period_start)}` : "Recurring";
    }
    return obligation.source === "shared" ? "Shared expense" : "Manual due";
  };
}

/** One due: who, what, how much is left and its status, with a Pay shortcut. */
export function ObligationRow({ obligation, showPerson = true }: { obligation: LedgerObligationRecord; showPerson?: boolean }) {
  const { data, model, open } = useLedger();
  const sourceLabel = useObligationSource();
  const balance = model.balances.get(obligation.id);
  if (!balance) return null;
  const person = data.people.find((item) => item.id === obligation.person_id);

  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-glass-hover/50 pr-2 transition-colors hover:bg-glass-hover">
      <button
        type="button"
        onClick={() => open({ kind: "obligation", obligationId: obligation.id })}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-fg">{showPerson ? person?.name ?? "Unknown" : obligation.title}</p>
            <StatusBadge balance={balance} />
          </div>
          <p className="truncate text-xs text-fg-muted">
            {showPerson ? `${obligation.title} · ` : ""}
            {sourceLabel(obligation)}
          </p>
          <p className="text-[11px] text-fg-subtle">Due {formatLedgerDate(obligation.due_date)}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("font-money text-sm font-bold", balance.outstandingCents > 0 ? "text-fg" : "text-positive")}>
            {balance.outstandingCents > 0 ? ledgerMoney(balance.outstandingCents, obligation.currency) : "Settled"}
          </p>
          {balance.paidCents > 0 && balance.outstandingCents > 0 && (
            <p className="text-[11px] text-fg-subtle">of {ledgerMoney(balance.amountCents, obligation.currency)}</p>
          )}
        </div>
      </button>
      {balance.outstandingCents > 0 && (
        <Button size="sm" variant="secondary" onClick={() => open({ kind: "payment", obligationId: obligation.id })} aria-label={`Record payment for ${person?.name ?? "this due"}`}>
          Pay
        </Button>
      )}
    </div>
  );
}

/** Full detail for one due, including every payment (voided ones stay visible). */
export function ObligationDetailsModal({ obligationId }: { obligationId: string }) {
  const { data, model, today, open, close } = useLedger();
  const sourceLabel = useObligationSource();
  const { save, pending, error, setError } = useLedgerSave();
  const [confirming, setConfirming] = useState(false);
  const obligation = data.obligations.find((item) => item.id === obligationId);
  const balance = obligation ? model.balances.get(obligation.id) : null;

  if (!obligation || !balance) {
    return (
      <Modal isOpen onClose={close} title="Due" size="md">
        <p className="text-sm text-fg-muted">This due no longer exists.</p>
      </Modal>
    );
  }
  const person = data.people.find((item) => item.id === obligation.person_id);
  const payments = [...(model.paymentsByObligation.get(obligation.id) ?? [])].sort((a, b) => b.paid_on.localeCompare(a.paid_on) || b.created_at.localeCompare(a.created_at));
  const percent = balance.amountCents > 0 ? Math.min(100, Math.round((balance.paidCents / balance.amountCents) * 100)) : 0;
  // Every due can be adjusted: a recurring due's amount or date can be changed for just that period.
  const editable = true;
  // The due's origin decides (the database enforces the same): manual, earlier-period and
  // future advance dues without payments can be deleted; generated and shared dues, and any due
  // with payment history, are kept.
  const deleteBlock = dueDeleteBlock({ obligation, groups: data.groups, hasPayments: payments.length > 0, today });

  return (
    <Modal isOpen onClose={close} title={obligation.title} description={`${person?.name ?? "Unknown"} · ${sourceLabel(obligation)}`} size="md">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge balance={balance} />
          <p className="text-xs text-fg-subtle">Due {formatLedgerDate(obligation.due_date)}</p>
        </div>

        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            ["Owed", ledgerMoney(balance.amountCents, obligation.currency)],
            ["Paid", ledgerMoney(balance.paidCents, obligation.currency)],
            ["Remaining", ledgerMoney(balance.outstandingCents, obligation.currency)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line bg-glass-hover px-2 py-2.5">
              <dt className="text-[10px] font-medium text-fg-subtle">{label}</dt>
              <dd className="font-money text-sm font-bold text-fg">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Paid so far">
          <div className="h-full rounded-full bg-positive transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </div>
        {obligation.note && <p className="rounded-xl border border-line bg-glass-hover px-3 py-2 text-xs text-fg-muted">{obligation.note}</p>}

        <div className="flex flex-wrap gap-2">
          {balance.outstandingCents > 0 && (
            <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "payment", obligationId: obligation.id })}>
              Record payment
            </Button>
          )}
          {editable && (
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Pencil className="h-4 w-4" />}
              onClick={() =>
                obligation.source === "shared" && obligation.expense_id
                  ? open({ kind: "expense", expenseId: obligation.expense_id })
                  : open({ kind: "due", obligationId: obligation.id })
              }
            >
              {obligation.source === "shared" ? "Edit expense" : "Edit due"}
            </Button>
          )}
        </div>

        {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}
        {obligation.source !== "shared" && (
          <div>
            {deleteBlock ? (
              <p className="text-[11px] text-fg-subtle">{deleteBlock}</p>
            ) : confirming ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/25 bg-danger/8 px-3 py-2.5">
                <p className="mr-auto text-xs text-fg">Delete this due? This can&apos;t be undone.</p>
                <Button size="sm" variant="danger" isLoading={pending} onClick={() => save([{ entity: "ledger_obligation", op: "DELETE", id: obligation.id, payload: {} }], close)}>
                  Delete
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirming(true)}>
                Delete due
              </Button>
            )}
          </div>
        )}

        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Payments</h3>
          {payments.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-fg-subtle">No payments yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {payments.map((payment) => (
                <li key={payment.id}>
                  <button
                    type="button"
                    onClick={() => open({ kind: "payment", paymentId: payment.id })}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-glass-hover/50 px-3 py-2 text-left hover:bg-glass-hover"
                  >
                    <span className="min-w-0">
                      <span className={cn("block font-money text-sm font-semibold text-fg", payment.voided_at && "line-through opacity-60")}>
                        {ledgerMoney(Math.round(Number(payment.amount) * 100), obligation.currency)}
                      </span>
                      <span className="block truncate text-[11px] text-fg-subtle">
                        {formatLedgerDate(payment.paid_on)}
                        {payment.note ? ` · ${payment.note}` : ""}
                      </span>
                    </span>
                    {payment.voided_at && <span className="rounded-full bg-glass-hover px-2 py-0.5 text-[10px] font-semibold text-fg-muted">Voided</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

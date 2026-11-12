"use client";

import { useMemo, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import { MAX_ADVANCE_PERIODS, periodLabel, planMemberPayment, type LedgerChange } from "@/lib/ledger";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";
import { useLedger } from "./LedgerProvider";
import { ledgerMoney, newId, useLedgerSave } from "./ledgerUi";

/**
 * Receive any amount from a group member. It is spread over what they owe, oldest period first
 * (each due gets at most what is left on it), and anything extra can go toward upcoming periods,
 * so a person who pays ahead, or pays a different amount than a full month, is recorded exactly.
 */
export function MemberPaymentModal({ memberId }: { memberId: string }) {
  const { data, model, today, close } = useLedger();
  const online = useOnlineStatus();
  const member = data.members.find((item) => item.id === memberId);
  const group = member ? data.groups.find((item) => item.id === member.group_id) : undefined;
  const person = member ? data.people.find((item) => item.id === member.person_id) : undefined;

  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState("");
  const [advance, setAdvance] = useState(true);
  const { save, pending, error, setError } = useLedgerSave();
  // One payment id per due for this confirmation, so a retried save is the same payment, never a second one.
  const paymentIds = useRef(new Map<string, string>());

  const cents = Math.round(Number(amount) * 100) || 0;
  const plan = useMemo(
    () =>
      member && group
        ? planMemberPayment({ group, member, spans: data.spans, rates: data.rates, obligations: data.obligations, balances: model.balances, amountCents: cents, today, advance })
        : null,
    [member, group, data.spans, data.rates, data.obligations, model.balances, cents, today, advance]
  );
  const owedCents = member
    ? data.obligations.filter((obligation) => obligation.member_id === member.id).reduce((sum, obligation) => sum + (model.balances.get(obligation.id)?.outstandingCents ?? 0), 0)
    : 0;

  if (!member || !group || !person) {
    return (
      <Modal isOpen onClose={close} title="Receive payment" size="sm">
        <p className="text-sm text-fg-muted">This member no longer exists.</p>
      </Modal>
    );
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!(cents > 0)) return setError("Enter the amount received.");
    if (!plan || plan.applications.length === 0) return setError("There is nothing to apply this payment to.");
    if (plan.unappliedCents > 0) {
      return setError(
        advance
          ? `${ledgerMoney(plan.unappliedCents, group.currency)} is more than what they owe plus the next ${MAX_ADVANCE_PERIODS} periods. Enter a smaller amount.`
          : `${ledgerMoney(plan.unappliedCents, group.currency)} is more than they owe. Tick "Put extra toward upcoming periods" to record it in advance.`
      );
    }
    const changes: LedgerChange[] = [];
    for (const application of plan.applications) {
      if (application.newDue) {
        changes.push({
          entity: "ledger_obligation",
          op: "CREATE",
          id: application.obligationId,
          payload: {
            person_id: member.person_id,
            source: "recurring",
            origin: "advance",
            group_id: group.id,
            member_id: member.id,
            period_start: application.periodStart,
            title: group.name,
            amount: application.newDue.amount,
            due_date: application.newDue.dueDate,
            currency: group.currency,
            note: "Paid in advance",
          },
        });
      }
      let paymentId = paymentIds.current.get(application.obligationId);
      if (!paymentId) {
        paymentId = newId();
        paymentIds.current.set(application.obligationId, paymentId);
      }
      changes.push({
        entity: "ledger_payment",
        op: "CREATE",
        id: paymentId,
        payload: { obligation_id: application.obligationId, amount: application.amountCents / 100, paid_on: paidOn, note, voided_at: null },
      });
    }
    save(changes, close);
  };

  return (
    <Modal isOpen onClose={close} title="Receive payment" description={`${person.name} · ${group.name}`} size="md">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}
        {!online && <Alert variant="info">Saved on this device and synced when you reconnect.</Alert>}

        <div className="rounded-xl border border-line bg-glass-hover px-3 py-2.5 text-xs text-fg-muted">
          Currently owes <span className="font-money font-semibold text-fg">{ledgerMoney(owedCents, group.currency)}</span>
        </div>

        <Input
          label="Amount received"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
          className="text-base font-money sm:text-sm"
        />
        <Input label="Payment date" type="date" value={paidOn} max={today} onChange={(event) => setPaidOn(event.target.value)} required className="text-base sm:text-sm" />
        <Input label="Note (optional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} className="text-base sm:text-sm" />
        <Checkbox
          checked={advance}
          onChange={(event) => setAdvance(event.target.checked)}
          label="Put extra toward upcoming periods"
          description="Anything beyond what they owe is applied to the next periods. A part-paid period stays partly owed."
        />

        {plan && cents > 0 && (
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Where it goes</h3>
            {plan.applications.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-3 py-3 text-center text-xs text-fg-subtle">Nothing owed to apply this to.</p>
            ) : (
              <ul className="space-y-1.5">
                {plan.applications.map((application) => (
                  <li key={application.obligationId} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-glass-hover/50 px-3 py-2">
                    <span className="min-w-0 text-sm text-fg">
                      {periodLabel(group, application.periodStart)}
                      {application.upcoming && <span className="ml-2 rounded-full bg-info/12 px-2 py-0.5 text-[10px] font-semibold text-info">Upcoming</span>}
                    </span>
                    <span className="shrink-0 font-money text-sm font-semibold text-positive">{ledgerMoney(application.amountCents, group.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
            {plan.unappliedCents > 0 && (
              <p className={cn("mt-2 text-xs", "text-warning")} role="status">
                {ledgerMoney(plan.unappliedCents, group.currency)} can&apos;t be applied.
              </p>
            )}
          </div>
        )}

        <Button type="submit" className="w-full" isLoading={pending} disabled={!(cents > 0)}>
          Record payment
        </Button>
      </form>
    </Modal>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Ban, RotateCcw } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { formatLedgerDate } from "@/lib/ledger";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";
import { useLedger } from "./LedgerProvider";
import { ledgerMoney, newId, useLedgerSave } from "./ledgerUi";

/**
 * Record a payment against one due, or edit / void an existing one. A payment can never exceed
 * what is still owed; a mistaken payment is voided and stays in the history.
 */
export function PaymentModal({ obligationId, paymentId }: { obligationId?: string; paymentId?: string }) {
  const { data, model, today, currency, close } = useLedger();
  const online = useOnlineStatus();
  const existing = paymentId ? data.payments.find((payment) => payment.id === paymentId) ?? null : null;
  const [selected, setSelected] = useState(existing?.obligation_id ?? obligationId ?? "");
  // One id for this confirmation: a retried save is recognised as the same payment, never a second one.
  const [id] = useState(() => existing?.id ?? newId());
  const people = useMemo(() => new Map(data.people.map((person) => [person.id, person])), [data.people]);

  const payable = useMemo(
    () =>
      data.obligations
        .filter((obligation) => (model.balances.get(obligation.id)?.outstandingCents ?? 0) > 0 && obligation.currency === currency)
        .sort((a, b) => (people.get(a.person_id)?.name ?? "").localeCompare(people.get(b.person_id)?.name ?? "") || a.due_date.localeCompare(b.due_date)),
    [data.obligations, model.balances, people, currency]
  );

  const obligation = data.obligations.find((item) => item.id === selected) ?? null;
  const balance = obligation ? model.balances.get(obligation.id) ?? null : null;
  // What this payment may be: what is still owed, plus this payment's own amount when editing it.
  const ownCents = existing && !existing.voided_at ? Math.round(Number(existing.amount) * 100) : 0;
  const remainingCents = balance ? balance.outstandingCents + ownCents : 0;

  const [amount, setAmount] = useState(() => {
    if (existing) return String(Number(existing.amount));
    const start = obligationId ? model.balances.get(obligationId)?.outstandingCents ?? 0 : 0;
    return start > 0 ? String(start / 100) : "";
  });
  const [paidOn, setPaidOn] = useState(existing?.paid_on ?? today);
  const [note, setNote] = useState(existing?.note ?? "");
  const { save, pending, error, setError } = useLedgerSave();

  const choose = (value: string) => {
    setSelected(value);
    const outstanding = model.balances.get(value)?.outstandingCents ?? 0;
    setAmount(outstanding > 0 ? String(outstanding / 100) : "");
  };

  const submit = (event: React.FormEvent, voided = false) => {
    event.preventDefault();
    if (!obligation) return setError("Choose the due this payment is for.");
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return setError("Enter an amount greater than zero.");
    if (!voided && cents > remainingCents) {
      return setError(remainingCents <= 0 ? "This due is already fully paid." : `That is more than the remaining ${ledgerMoney(remainingCents, obligation.currency)}.`);
    }
    save(
      [
        {
          entity: "ledger_payment",
          op: existing ? "UPDATE" : "CREATE",
          id,
          payload: {
            obligation_id: obligation.id,
            amount: cents / 100,
            paid_on: paidOn,
            note,
            voided_at: voided ? existing?.voided_at ?? new Date().toISOString() : null,
          },
        },
      ],
      close
    );
  };

  const isVoided = !!existing?.voided_at;

  return (
    <Modal isOpen onClose={close} title={existing ? "Payment" : "Record payment"} description={existing ? "Edit it, or void it if it was a mistake." : undefined} size="sm">
      <form onSubmit={(event) => submit(event, false)} className="space-y-4" noValidate>
        {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}
        {!online && <Alert variant="info">Saved on this device and synced when you reconnect.</Alert>}
        {isVoided && <Alert variant="warning">This payment is voided and doesn&apos;t count. Restore it to count it again.</Alert>}

        {existing || obligationId ? (
          obligation && (
            <div className="rounded-xl border border-line bg-glass-hover p-3">
              <p className="text-sm font-semibold text-fg">{people.get(obligation.person_id)?.name ?? "Unknown"}</p>
              <p className="text-xs text-fg-muted">{obligation.title}</p>
            </div>
          )
        ) : (
          <Select label="Due" value={selected} onChange={(event) => choose(event.target.value)} required className="text-base sm:text-sm">
            <option value="">Choose what is being paid</option>
            {payable.map((item) => (
              <option key={item.id} value={item.id}>
                {people.get(item.person_id)?.name ?? "Unknown"} · {item.title} · {ledgerMoney(model.balances.get(item.id)?.outstandingCents ?? 0, item.currency)} due
              </option>
            ))}
          </Select>
        )}

        {obligation && balance && (
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Owed", ledgerMoney(balance.amountCents, obligation.currency)],
              ["Paid", ledgerMoney(balance.paidCents - ownCents, obligation.currency)],
              ["Remaining", ledgerMoney(remainingCents, obligation.currency)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-line bg-glass-hover px-2 py-2">
                <dt className="text-[10px] font-medium text-fg-subtle">{label}</dt>
                <dd className="font-money text-xs font-bold text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        <Input
          label="Amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          helperText={obligation && remainingCents > 0 ? `Up to ${ledgerMoney(remainingCents, obligation.currency)}` : undefined}
          required
          className="text-base font-money sm:text-sm"
        />
        <Input label="Payment date" type="date" value={paidOn} max={today} onChange={(event) => setPaidOn(event.target.value)} required className="text-base sm:text-sm" />
        <Input label="Note (optional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} className="text-base sm:text-sm" />
        {obligation && existing && <p className="text-xs text-fg-subtle">Recorded {formatLedgerDate(existing.paid_on)}</p>}

        <Button type="submit" className="w-full" isLoading={pending} disabled={!obligation}>
          {existing ? "Save payment" : "Record payment"}
        </Button>
        {existing && (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            leftIcon={isVoided ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
            disabled={pending}
            onClick={(event) => submit(event as unknown as React.FormEvent, !isVoided)}
          >
            {isVoided ? "Restore payment" : "Void payment"}
          </Button>
        )}
      </form>
    </Modal>
  );
}

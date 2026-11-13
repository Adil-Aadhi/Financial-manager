"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { LedgerChange } from "@/lib/ledger";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";
import { useLedger } from "./LedgerProvider";
import { EMPTY_PERSON_CHOICE, PersonPicker, resolvePersonChoice, type PersonChoice } from "./PersonPicker";
import { newId, useLedgerSave } from "./ledgerUi";

/** Quickly record that someone owes you money, without a group or a shared expense. */
export function ManualDueFormModal({ obligationId }: { obligationId?: string }) {
  const { data, today, currency, close } = useLedger();
  const online = useOnlineStatus();
  const existing = obligationId ? data.obligations.find((item) => item.id === obligationId) ?? null : null;
  const [id] = useState(() => existing?.id ?? newId());
  const [choice, setChoice] = useState<PersonChoice>(EMPTY_PERSON_CHOICE);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [amount, setAmount] = useState(existing ? String(Number(existing.amount)) : "");
  const [dueDate, setDueDate] = useState(existing?.due_date ?? today);
  const [note, setNote] = useState(existing?.note ?? "");
  const { save, pending, error, setError } = useLedgerSave();

  const hasPayments = !!existing && data.payments.some((payment) => payment.obligation_id === existing.id);
  const person = existing ? data.people.find((item) => item.id === existing.person_id) : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return setError("Describe what this is for, e.g. Personal borrowing.");
    if (!(Number(amount) > 0)) return setError("Enter an amount greater than zero.");
    const changes: LedgerChange[] = [];
    let personId = existing?.person_id ?? "";
    if (!existing) {
      const resolved = resolvePersonChoice(choice, data.people, new Map());
      if ("error" in resolved) return setError(resolved.error);
      personId = resolved.id;
      if (resolved.change) changes.push(resolved.change);
    }
    changes.push({
      entity: "ledger_obligation",
      op: existing ? "UPDATE" : "CREATE",
      id,
      payload: existing
        ? { title, amount: Number(amount), due_date: dueDate, note }
        : { person_id: personId, source: "manual", origin: "manual", title, amount: Number(amount), due_date: dueDate, currency, note },
    });
    save(changes, close);
  };

  return (
    <Modal
      isOpen
      onClose={close}
      title={existing ? "Edit due" : "New due"}
      description={existing?.source === "recurring" ? "Changes only this period. Other periods keep their amounts." : "Money someone owes you. It doesn't touch your accounts or transactions."}
      size="sm"
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}
        {!online && <Alert variant="info">Saved on this device and synced when you reconnect.</Alert>}
        {existing ? (
          <div className="rounded-xl border border-line bg-glass-hover p-3 text-sm font-semibold text-fg">{person?.name ?? "Unknown"}</div>
        ) : (
          <PersonPicker label="Who owes you?" people={data.people} value={choice} onChange={setChoice} />
        )}
        <Input label="What for?" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Personal borrowing" required className="text-base sm:text-sm" />
        <Input label={`Amount (${existing?.currency ?? currency})`} type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} required className="text-base font-money sm:text-sm" />
        <Input label={existing?.source === "recurring" ? "Due date" : "Date"} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required className="text-base sm:text-sm" />
        <Input label="Note (optional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} className="text-base sm:text-sm" />
        <Button type="submit" className="w-full" isLoading={pending}>
          {existing ? "Save changes" : "Add due"}
        </Button>
        {existing && existing.source === "manual" && (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leftIcon={<Trash2 className="h-4 w-4" />}
              disabled={pending || hasPayments}
              onClick={() => save([{ entity: "ledger_obligation", op: "DELETE", id, payload: {} }], close)}
            >
              Delete due
            </Button>
            {hasPayments && <p className="mt-1 text-[11px] text-fg-subtle">A due with payments is kept for the history.</p>}
          </div>
        )}
      </form>
    </Modal>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import { splitEqually, type LedgerChange } from "@/lib/ledger";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";
import { useLedger } from "./LedgerProvider";
import { EMPTY_PERSON_CHOICE, PersonPicker, resolvePersonChoice, type PersonChoice } from "./PersonPicker";
import { FormSectionTitle, ledgerMoney, newId, useLedgerSave } from "./ledgerUi";

interface ShareRow {
  key: string;
  /** The share's id: an existing share keeps its id so its payments stay attached. */
  id: string;
  choice: PersonChoice;
  amount: string;
  paidCents: number;
}

const CATEGORY_SUGGESTIONS = ["Electricity", "Water", "Internet", "Rent", "Groceries", "Travel", "Food", "Subscription", "Other"];

/** Create or edit a shared expense: you paid, and people owe a share. Editing never loses payments. */
export function ExpenseFormModal({ expenseId }: { expenseId?: string }) {
  const { data, model, today, currency, close } = useLedger();
  const online = useOnlineStatus();
  const existing = expenseId ? data.expenses.find((item) => item.id === expenseId) ?? null : null;
  const [id] = useState(() => existing?.id ?? newId());

  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [total, setTotal] = useState(existing ? String(Number(existing.total_amount)) : "");
  const [date, setDate] = useState(existing?.expense_date ?? today);
  const [category, setCategory] = useState(existing?.category ?? "");
  const [allowUnallocated, setAllowUnallocated] = useState(existing?.allow_unallocated ?? false);
  const [rows, setRows] = useState<ShareRow[]>(() => {
    if (existing) {
      return data.obligations
        .filter((obligation) => obligation.expense_id === existing.id)
        .map((obligation) => ({
          key: obligation.id,
          id: obligation.id,
          choice: { personId: obligation.person_id, newName: "", newPhone: "" },
          amount: String(Number(obligation.amount)),
          paidCents: model.balances.get(obligation.id)?.paidCents ?? 0,
        }));
    }
    return [0, 1].map(() => blankRow());
  });
  const { save, pending, error, setError } = useLedgerSave();

  const hasPayments = rows.some((row) => row.paidCents > 0) || (!!existing && data.obligations.some((o) => o.expense_id === existing.id && (model.paymentsByObligation.get(o.id)?.length ?? 0) > 0));
  const expenseCurrency = existing?.currency ?? currency;
  const totalCents = Math.round(Number(total) * 100) || 0;
  const allocatedCents = rows.reduce((sum, row) => sum + (Math.round(Number(row.amount) * 100) || 0), 0);
  const unallocatedCents = totalCents - allocatedCents;
  const chosenIds = useMemo(() => rows.map((row) => row.choice.personId).filter((value) => value && value !== "new"), [rows]);

  const setRow = (key: string, patch: Partial<ShareRow>) => setRows((list) => list.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const splitAll = () => {
    if (!(totalCents > 0) || rows.length === 0) return setError("Enter the total and add people first.");
    const shares = splitEqually(totalCents, rows.length);
    setRows((list) => list.map((row, index) => ({ ...row, amount: String(shares[index] / 100) })));
    setAllowUnallocated(false);
    setError(null);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return setError("Enter a title, e.g. KSEB electricity bill.");
    if (!(totalCents > 0)) return setError("Enter the total amount.");
    if (rows.length === 0) return setError("Add at least one person.");
    const changes: LedgerChange[] = [];
    const pendingPeople = new Map<string, string>();
    const shares: Array<{ id: string; person_id: string; amount: number }> = [];
    for (const row of rows) {
      const resolved = resolvePersonChoice(row.choice, data.people, pendingPeople);
      if ("error" in resolved) return setError(resolved.error);
      if (resolved.change) changes.push(resolved.change);
      if (shares.some((share) => share.person_id === resolved.id)) return setError("Each person can appear only once.");
      const cents = Math.round(Number(row.amount) * 100);
      if (!(cents > 0)) return setError("Give every person an amount greater than zero, or remove them.");
      shares.push({ id: row.id, person_id: resolved.id, amount: cents / 100 });
    }
    if (allocatedCents > totalCents) return setError("The shares add up to more than the total.");
    if (allocatedCents < totalCents && !allowUnallocated) {
      return setError(`${ledgerMoney(totalCents - allocatedCents, expenseCurrency)} isn't allocated. Split it, or allow an unallocated balance.`);
    }
    changes.push({
      entity: "ledger_expense",
      op: existing ? "UPDATE" : "CREATE",
      id,
      payload: {
        title,
        description,
        total_amount: totalCents / 100,
        expense_date: date,
        category,
        allow_unallocated: allowUnallocated,
        currency: expenseCurrency,
        shares,
      },
    });
    save(changes, close);
  };

  return (
    <Modal isOpen onClose={close} title={existing ? "Edit shared expense" : "New shared expense"} description="You paid; these people owe you their share." size="lg">
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}
        {!online && <Alert variant="info">Saved on this device and synced when you reconnect.</Alert>}

        <section className="space-y-4">
          <FormSectionTitle>Expense</FormSectionTitle>
          <Input label="Title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="KSEB electricity bill" required className="text-base sm:text-sm" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={`Total paid (${expenseCurrency})`} type="number" inputMode="decimal" step="0.01" min="0" value={total} onChange={(event) => setTotal(event.target.value)} required className="text-base font-money sm:text-sm" />
            <Input label="Date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required className="text-base sm:text-sm" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Input label="Category (optional)" list="ledger-expense-categories" value={category} onChange={(event) => setCategory(event.target.value)} maxLength={40} className="text-base sm:text-sm" />
              <datalist id="ledger-expense-categories">
                {CATEGORY_SUGGESTIONS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </div>
            <Input label="Description (optional)" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} className="text-base sm:text-sm" />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <FormSectionTitle>Who owes a share</FormSectionTitle>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={splitAll}>
                Split equally
              </Button>
              <Button type="button" size="sm" variant="secondary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setRows((list) => [...list, blankRow()])}>
                Person
              </Button>
            </div>
          </div>
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.key} className="space-y-2 rounded-xl border border-line bg-glass-hover/50 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <PersonPicker
                      label="Person"
                      people={data.people}
                      value={row.choice}
                      onChange={(choice) => setRow(row.key, { choice })}
                      excludeIds={chosenIds.filter((value) => value !== row.choice.personId)}
                      disabled={row.paidCents > 0 || !!existing?.id && data.obligations.some((o) => o.id === row.id)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Remove person"
                    disabled={row.paidCents > 0}
                    onClick={() => setRows((list) => list.filter((item) => item.key !== row.key))}
                    className="mt-6 px-2"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <Input
                  label="Amount"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={row.amount}
                  onChange={(event) => setRow(row.key, { amount: event.target.value })}
                  helperText={row.paidCents > 0 ? `Already paid ${ledgerMoney(row.paidCents, expenseCurrency)}. Can't go below that.` : undefined}
                  className="text-base font-money sm:text-sm"
                />
              </li>
            ))}
          </ul>

          <div
            className={cn(
              "rounded-xl border px-3 py-2.5 text-xs",
              unallocatedCents === 0 ? "border-positive/25 bg-positive/8 text-positive" : "border-warning/25 bg-warning/8 text-warning"
            )}
            role="status"
          >
            Allocated {ledgerMoney(allocatedCents, expenseCurrency)} of {ledgerMoney(totalCents, expenseCurrency)}
            {unallocatedCents !== 0 && (unallocatedCents > 0 ? ` · ${ledgerMoney(unallocatedCents, expenseCurrency)} left` : ` · ${ledgerMoney(-unallocatedCents, expenseCurrency)} over`)}
          </div>
          <Checkbox
            checked={allowUnallocated}
            onChange={(event) => setAllowUnallocated(event.target.checked)}
            label="Leave the rest unallocated"
            description="Use this when part of the bill is yours or isn't owed by anyone."
          />
        </section>

        <Button type="submit" className="w-full" isLoading={pending}>
          {existing ? "Save changes" : "Add expense"}
        </Button>
        {existing && (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leftIcon={<Trash2 className="h-4 w-4" />}
              disabled={pending || hasPayments}
              onClick={() => save([{ entity: "ledger_expense", op: "DELETE", id, payload: {} }], close)}
            >
              Delete expense
            </Button>
            {hasPayments && <p className="mt-1 text-[11px] text-fg-subtle">An expense with payments is kept for the history.</p>}
          </div>
        )}
      </form>
    </Modal>
  );
}

function blankRow(): ShareRow {
  const id = newId();
  return { key: id, id, choice: EMPTY_PERSON_CHOICE, amount: "", paidCents: 0 };
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Building2, Link2, NotebookPen, Plus, Search, Undo2 } from "lucide-react";
import { deleteInstallmentPaymentAction, saveInstallmentPaymentAction } from "@/app/actions/installments";
import { CategoryTile } from "@/components/categories/CategoryIcon";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import {
  INSTALLMENT_CATEGORY_ICON,
  INSTALLMENT_CATEGORY_NAME,
  closureExpectedCents,
  expectedInstallmentCents,
  formatInstallmentDate,
  installmentDueDate,
  installmentTransactionDescription,
  validatePaymentFields,
  type InstallmentPaymentKind,
  type InstallmentPaymentMethod,
  type InstallmentPaymentRecord,
  type InstallmentPlanRecord,
} from "@/lib/installments";
import {
  deleteInstallmentPaymentLocally,
  runMutation,
  saveInstallmentPaymentLocally,
  type LocalInstallmentPaymentInput,
} from "@/lib/offline/mutations";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";
import type { InstallmentAccountOption, InstallmentTransactionOption } from "@/lib/supabase/installments";
import { transactionDateTimeDefaults } from "@/lib/transactions";
import { money } from "./InstallmentCard";
import { completeInstallmentMutation } from "./InstallmentPlanForm";
import { readLastInstallmentAccount, rememberInstallmentAccount } from "./useInstallments";

const METHODS: Array<{ value: InstallmentPaymentMethod; label: string; icon: React.ReactNode }> = [
  { value: "account", label: "Linked account", icon: <Building2 className="h-4 w-4" /> },
  { value: "cash", label: "Cash", icon: <Banknote className="h-4 w-4" /> },
  { value: "manual", label: "Other / Manual", icon: <NotebookPen className="h-4 w-4" /> },
];

export interface PaymentTarget {
  kind: InstallmentPaymentKind;
  installmentNumber: number;
  coversThrough: number;
  payment: InstallmentPaymentRecord | null;
}

function newUuid() {
  return crypto.randomUUID();
}

export function InstallmentPaymentModal({
  ownerId,
  plan,
  payments,
  accounts,
  transactions,
  categoryAvailable,
  today,
  target,
  onClose,
}: {
  ownerId: string;
  plan: InstallmentPlanRecord;
  payments: InstallmentPaymentRecord[];
  accounts: InstallmentAccountOption[];
  transactions: InstallmentTransactionOption[];
  categoryAvailable: boolean;
  today: string;
  target: PaymentTarget;
  onClose: () => void;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const existing = target.payment;
  const activeAccounts = useMemo(() => accounts.filter((account) => !account.deleted_at), [accounts]);
  const accountName = (id: string | null) => accounts.find((account) => account.id === id)?.name ?? "Unknown account";

  // Stable ids for this confirmation: a retried save sends the same payment and transaction ids,
  // which the server recognises as already applied instead of recording a second expense.
  const [paymentId] = useState(() => existing?.id ?? newUuid());
  const [createdTransactionId] = useState(() =>
    existing?.transaction_origin === "created" && existing.transaction_id ? existing.transaction_id : newUuid()
  );

  const siblings = payments.filter((payment) => payment.installment_plan_id === plan.id && payment.id !== existing?.id);
  // Same as the database: the schedule amount, or for a closure what remains after actual payments.
  const expectedCents =
    target.kind === "closure" ? Math.max(0, closureExpectedCents(plan, siblings)) : expectedInstallmentCents(plan, target.installmentNumber);
  const expected = expectedCents / 100;
  const dueDate = installmentDueDate(plan, target.installmentNumber);

  const lastAccount = typeof window === "undefined" ? null : readLastInstallmentAccount(ownerId);
  const defaultAccount =
    (existing?.account_id && activeAccounts.some((account) => account.id === existing.account_id) ? existing.account_id : null) ??
    (lastAccount && activeAccounts.some((account) => account.id === lastAccount) ? lastAccount : null) ??
    activeAccounts[0]?.id ??
    "";

  const [method, setMethod] = useState<InstallmentPaymentMethod>(existing?.payment_method ?? (activeAccounts.length ? "account" : "cash"));
  const [accountId, setAccountId] = useState(defaultAccount);
  const [source, setSource] = useState<"create" | "link">(existing?.transaction_origin === "linked" ? "link" : "create");
  const [linkedId, setLinkedId] = useState<string | null>(existing?.transaction_origin === "linked" ? existing.transaction_id : null);
  const [actual, setActual] = useState(existing ? String(Number(existing.actual_amount)) : expected ? String(expected) : "");
  const [paymentDate, setPaymentDate] = useState(existing?.payment_date ?? today);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [query, setQuery] = useState("");
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const linked = linkedId ? transactions.find((transaction) => transaction.id === linkedId) ?? null : null;
  const amount = method === "account" && source === "link" && linked ? Number(linked.amount) : Number(actual);
  const description = installmentTransactionDescription(plan.name, target.installmentNumber, plan.installment_count, target.kind, target.coversThrough);

  const existingId = existing?.id ?? null;
  const candidates = useMemo(() => {
    const term = query.trim().toLowerCase();
    // One transaction can record at most one installment payment.
    const usedByOthers = new Set(
      payments.filter((payment) => payment.id !== existingId && payment.transaction_id).map((payment) => payment.transaction_id as string)
    );
    return transactions
      .filter((transaction) => transaction.type === "expense" && !usedByOthers.has(transaction.id) && transaction.id !== createdTransactionId)
      .filter((transaction) => !accountId || transaction.account_id === accountId)
      .filter((transaction) => !term || (transaction.description ?? "").toLowerCase().includes(term) || String(transaction.amount).includes(term))
      .sort((a, b) => {
        const target = Number(actual) || expected;
        const byAmount = Math.abs(Number(a.amount) - target) - Math.abs(Number(b.amount) - target);
        return byAmount || b.transaction_date.localeCompare(a.transaction_date);
      })
      .slice(0, 20);
  }, [transactions, payments, existingId, accountId, query, actual, expected, createdTransactionId]);

  const previousCreated = existing?.transaction_origin === "created" && existing.transaction_id ? existing : null;
  const createdStillExists = previousCreated ? transactions.some((transaction) => transaction.id === previousCreated.transaction_id) : false;
  let changeNote: string | null = null;
  if (previousCreated && createdStillExists) {
    if (method !== "account" || source === "link") {
      changeNote = `The ${money(previousCreated.actual_amount, plan.currency)} expense recorded from ${accountName(previousCreated.account_id)} will be deleted, restoring that balance.`;
    } else if (accountId !== previousCreated.account_id) {
      changeNote = `The expense moves from ${accountName(previousCreated.account_id)} to ${accountName(accountId)}: the first is credited back and the second is debited.`;
    }
  } else if (existing?.transaction_origin === "linked" && (method !== "account" || source === "create" || linkedId !== existing.transaction_id)) {
    changeNote = "The previously linked transaction stays in Transactions; only the link is removed.";
  }

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (method === "account" && source === "create" && !categoryAvailable) {
      return setError("Apply the Installments migration first: the Installment Payment category is missing.");
    }
    if (method === "account" && source === "link" && !linked) return setError("Choose the transaction to link.");
    const origin = method === "account" ? (source === "link" ? "linked" : "created") : null;
    const transactionId = method === "account" ? (source === "link" ? linkedId : createdTransactionId) : null;
    const keepTime =
      existing?.transaction_origin === "created" && existing.payment_date === paymentDate
        ? transactions.find((transaction) => transaction.id === existing.transaction_id)?.transaction_time?.slice(0, 5) ?? ""
        : "";
    const input: LocalInstallmentPaymentInput = {
      paymentId,
      planId: plan.id,
      installmentNumber: target.installmentNumber,
      kind: target.kind,
      coversThrough: target.coversThrough,
      actualAmount: amount,
      paymentDate,
      paymentMethod: method,
      accountId: method === "account" ? accountId || null : null,
      transactionOrigin: origin,
      transactionId,
      notes,
      transactionTime: keepTime || (paymentDate === today ? transactionDateTimeDefaults().time : ""),
      paidAt: existing?.paid_at ?? new Date().toISOString(),
    };
    const invalid = validatePaymentFields(
      {
        installmentNumber: input.installmentNumber,
        kind: input.kind,
        coversThrough: input.coversThrough,
        actualAmount: input.actualAmount,
        paymentDate: input.paymentDate,
        paymentMethod: input.paymentMethod,
        accountId: input.accountId,
        transactionOrigin: input.transactionOrigin,
        transactionId: input.transactionId,
        notes: input.notes,
      },
      plan.installment_count
    );
    if (invalid) return setError(invalid);
    startTransition(async () => {
      const result = await runMutation({
        local: (owner) => saveInstallmentPaymentLocally(owner, input),
        remote: () => saveInstallmentPaymentAction(input, !existing),
      });
      if (!result.success) return setError(result.error ?? "Unable to save this payment.");
      if (method === "account" && input.accountId) rememberInstallmentAccount(ownerId, input.accountId);
      onClose();
      completeInstallmentMutation(result, router);
    });
  };

  const undo = () =>
    existing &&
    startTransition(async () => {
      const result = await runMutation({
        local: (owner) => deleteInstallmentPaymentLocally(owner, existing.id),
        remote: () => deleteInstallmentPaymentAction(existing.id),
      });
      if (!result.success) return setError(result.error ?? "Unable to undo this payment.");
      onClose();
      completeInstallmentMutation(result, router);
    });

  const title =
    target.kind === "closure"
      ? existing ? "Edit early closure" : "Close plan early"
      : existing ? `Edit installment ${target.installmentNumber}` : "Confirm payment";

  // The button names the account that will be charged, so it's visible right at confirmation.
  const amountText = money(Number.isFinite(amount) ? amount : 0, plan.currency);
  const submitLabel = existing
    ? "Save payment"
    : method === "account" && source === "create" && accountId
      ? `Pay ${amountText} from ${accountName(accountId)}`
      : method === "account" && source === "link"
        ? "Link and confirm"
        : method === "cash"
          ? `Record ${amountText} cash payment`
          : target.kind === "closure"
            ? "Confirm closure"
            : "Confirm payment";

  if (confirmUndo && existing) {
    const removesExpense = existing.transaction_origin === "created" && existing.transaction_id && createdStillExists;
    return (
      <Modal isOpen onClose={() => setConfirmUndo(false)} title="Undo this payment?" description={`${plan.name} · ${target.kind === "closure" ? "early closure" : `installment ${target.installmentNumber}/${plan.installment_count}`}`} size="sm">
        <div className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <p className="text-sm leading-relaxed text-fg-muted">
            {removesExpense
              ? `The ${money(existing.actual_amount, plan.currency)} expense recorded from ${accountName(existing.account_id)} is deleted too, restoring that balance.`
              : existing.transaction_origin === "linked"
                ? "The linked transaction stays in Transactions; only the link is removed."
                : "No account balance changes: this was recorded without an account."}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setConfirmUndo(false)}>Keep</Button>
            <Button variant="danger" size="lg" isLoading={pending} onClick={undo}>Undo payment</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen onClose={onClose} title={title} description={`${plan.name} · ${plan.provider}`} size="md">
      <form onSubmit={save} className="space-y-5" noValidate>
        {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}
        {!online && <Alert variant="info">Saved on this device and synced when you reconnect.</Alert>}

        <dl className="grid grid-cols-3 gap-2 rounded-2xl border border-line bg-glass-hover p-3 text-xs">
          <div className="min-w-0">
            <dt className="text-fg-subtle">{target.kind === "closure" ? "Installments" : "Installment"}</dt>
            <dd className="mt-0.5 font-money text-sm font-semibold text-fg">
              {target.kind === "closure" && target.coversThrough > target.installmentNumber
                ? `${target.installmentNumber}–${target.coversThrough}/${plan.installment_count}`
                : `${target.installmentNumber}/${plan.installment_count}`}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-fg-subtle">Due</dt>
            <dd className="mt-0.5 truncate text-sm font-semibold text-fg">{formatInstallmentDate(dueDate)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-fg-subtle">Expected</dt>
            <dd className="mt-0.5 truncate font-money text-sm font-semibold text-fg">{money(expected, plan.currency)}</dd>
          </div>
        </dl>

        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-fg-muted">Payment method</legend>
          <div className="glass-track grid grid-cols-3 gap-1 rounded-xl p-1" role="radiogroup" aria-label="Payment method">
            {METHODS.map((option) => {
              const disabled = option.value === "account" && activeAccounts.length === 0;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={method === option.value}
                  disabled={disabled}
                  onClick={() => setMethod(option.value)}
                  className={cn(
                    "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 sm:flex-row sm:gap-1.5 sm:text-xs",
                    method === option.value ? "bg-accent text-accent-fg shadow-glow" : "text-fg-muted hover:text-fg"
                  )}
                >
                  {option.icon}
                  {option.label}
                </button>
              );
            })}
          </div>
          {activeAccounts.length === 0 && <p className="text-xs text-fg-subtle">No accounts yet: record this as Cash or Other / Manual.</p>}
          {method !== "account" && <p className="text-xs text-fg-subtle">Recorded in this plan&apos;s history only. No transaction is created and no balance changes.</p>}
        </fieldset>

        {method === "account" && (
          <div className="space-y-4">
            <Select label="Paid from account" value={accountId} onChange={(event) => { setAccountId(event.target.value); if (source === "link") setLinkedId(null); }} required className="text-base sm:text-sm">
              {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.currency ? ` · ${account.currency}` : ""}</option>)}
            </Select>
            <div className="glass-track grid grid-cols-2 gap-1 rounded-xl p-1" role="radiogroup" aria-label="Transaction">
              {([
                { value: "create", label: "Record new expense", icon: <Plus className="h-3.5 w-3.5" /> },
                { value: "link", label: "Link existing", icon: <Link2 className="h-3.5 w-3.5" /> },
              ] as const).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={source === option.value}
                  onClick={() => setSource(option.value)}
                  className={cn(
                    "flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors",
                    source === option.value ? "bg-accent/12 text-accent" : "text-fg-muted hover:text-fg"
                  )}
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {method === "account" && source === "link" ? (
          <div className="space-y-2">
            <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-glass-input px-3">
              <Search className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this account's expenses" aria-label="Search expenses" className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle sm:text-sm" />
            </label>
            <div className="max-h-56 divide-y divide-line overflow-y-auto rounded-2xl border border-line bg-glass-hover" role="listbox" aria-label="Expense transactions">
              {candidates.map((transaction) => (
                <button
                  key={transaction.id}
                  type="button"
                  role="option"
                  aria-selected={linkedId === transaction.id}
                  onClick={() => setLinkedId(transaction.id)}
                  className={cn("flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-xs", linkedId === transaction.id && "bg-accent/10")}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg">{transaction.description || "Expense"}</span>
                    <span className="text-fg-subtle">{formatInstallmentDate(transaction.transaction_date)}</span>
                  </span>
                  <span className="shrink-0 font-money font-semibold text-danger">−{money(transaction.amount, plan.currency)}</span>
                </button>
              ))}
              {!candidates.length && <p className="px-3 py-4 text-center text-xs text-fg-subtle">No unlinked expenses from this account.</p>}
            </div>
            <p className="text-xs text-fg-subtle">
              The amount, date and account come from the linked transaction and follow it if you edit it in Transactions. No new expense is created; undoing only unlinks it.
            </p>
          </div>
        ) : (
          <Input label="Amount paid" type="number" inputMode="decimal" min="0.01" step="0.01" value={actual} onChange={(event) => setActual(event.target.value)} required className="text-base sm:text-sm" />
        )}

        {!(method === "account" && source === "link") && <Input label="Payment date" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required className="text-base sm:text-sm" helperText={paymentDate > dueDate ? `Paid ${Math.round((Date.parse(paymentDate) - Date.parse(dueDate)) / 86_400_000)} days after the due date.` : undefined} />}

        <Input label="Notes (optional)" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} className="text-base sm:text-sm" />

        {method === "account" && source === "create" && accountId && (
          <div className="rounded-2xl border border-line bg-glass-hover p-3" aria-live="polite">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Transaction preview</p>
            <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-danger/25 bg-danger/8 px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-sm text-fg">
                <Building2 className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                <span className="truncate">
                  Charged to <span className="font-semibold">{accountName(accountId)}</span>
                </span>
              </span>
              <span className="shrink-0 font-money text-sm font-semibold text-danger">−{money(Number.isFinite(amount) ? amount : 0, plan.currency)}</span>
            </div>
            <div className="mt-2.5 flex items-center gap-3">
              <CategoryTile icon={INSTALLMENT_CATEGORY_ICON} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{description}</p>
                <p className="truncate text-xs text-fg-subtle">{INSTALLMENT_CATEGORY_NAME} · {Number.isFinite(Date.parse(paymentDate)) ? formatInstallmentDate(paymentDate) : "—"} · new expense in Transactions</p>
              </div>
            </div>
            {!categoryAvailable && <p className="mt-2 text-xs text-danger">The Installment Payment category is missing. Apply the Installments migration.</p>}
          </div>
        )}
        {method === "account" && source === "link" && linked && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-glass-hover px-3 py-2.5 text-sm" aria-live="polite">
            <span className="flex min-w-0 items-center gap-2 text-fg">
              <Link2 className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              <span className="truncate">
                Already charged to <span className="font-semibold">{accountName(linked.account_id)}</span> · no new expense
              </span>
            </span>
            <span className="shrink-0 font-money font-semibold text-fg">{money(linked.amount, plan.currency)}</span>
          </div>
        )}

        {changeNote && <Alert variant="warning">{changeNote}</Alert>}

        <div className={existing ? "grid grid-cols-[auto_1fr] gap-2" : ""}>
          {existing && (
            <Button type="button" variant="outline" size="lg" onClick={() => setConfirmUndo(true)} disabled={pending} leftIcon={<Undo2 className="h-4 w-4" />}>
              Undo
            </Button>
          )}
          <Button type="submit" size="lg" className="w-full" isLoading={pending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CalendarClock, Trash2 } from "lucide-react";
import {
  addDailyExpenseAction,
  deleteDailyExpenseAction,
  setDailyLimitAction,
  updateDailyExpenseAction,
} from "@/app/actions/dailyBudget";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import {
  addDays,
  formatDayLabel,
  formatMonthLabel,
  isDateKey,
  limitOn,
  MAX_DAILY_EXPENSE_DESCRIPTION,
  monthOfDate,
  validateDailyExpenseInput,
  validateDailyLimitInput,
  type DailyExpenseRecord,
  type DailyLimitRecord,
} from "@/lib/dailyBudget";
import { formatMoney } from "@/lib/format";
import { markOfflineDataStale } from "@/lib/offline/bootstrap";
import {
  addDailyExpenseLocally,
  deleteDailyExpenseLocally,
  runMutation,
  setDailyLimitLocally,
  updateDailyExpenseLocally,
  type MutationOutcome,
} from "@/lib/offline/mutations";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { currencySymbol, sanitizeAmount } from "./format";

function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Runs a daily-budget change on the right path and refreshes after a server write. */
export function useDailyBudgetMutation() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const run = (
    mutation: Parameters<typeof runMutation>[0],
    onDone: (outcome: MutationOutcome) => void
  ) => {
    startTransition(async () => {
      const outcome = await runMutation(mutation);
      onDone(outcome);
      if (!outcome.success || outcome.queued) return; // queued: the page reads IndexedDB
      markOfflineDataStale();
      router.refresh();
    });
  };
  return { run, isPending };
}

function AmountField({
  id,
  label,
  value,
  onChange,
  currency,
  error,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  currency: SupportedCurrency;
  error: string | null;
  disabled: boolean;
}) {
  return (
    <div className="rounded-2xl border border-line bg-glass-hover px-4 pb-4 pt-3 text-center">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-medium text-fg-muted">
          {label}
        </label>
        <span className="rounded-full border border-line bg-glass-input px-2.5 py-0.5 font-mono text-[11px] font-semibold text-fg-muted">
          {currency}
        </span>
      </div>
      <div className="mt-3 flex items-baseline justify-center gap-1">
        <span className="font-money text-2xl font-medium text-fg-subtle">{currencySymbol(currency)}</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={value}
          onChange={(event) => onChange(sanitizeAmount(event.target.value))}
          disabled={disabled}
          autoFocus
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          style={{ width: `${Math.max(value.length, 1) + 0.5}ch` }}
          className="min-w-[2ch] max-w-full bg-transparent text-center font-money text-[40px] font-bold leading-none tracking-tight text-fg outline-none placeholder:text-fg-subtle/50"
        />
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-2 flex animate-fade items-center justify-center gap-1.5 text-xs font-medium text-danger">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

/** Which month the chosen date belongs to, so an entry never lands in the wrong month by accident. */
function MonthIndicator({ date, today }: { date: string; today: string }) {
  if (!isDateKey(date)) return null;
  const month = monthOfDate(date);
  const currentMonth = monthOfDate(today);
  const previous = month < currentMonth;
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-2xl border p-3 text-xs",
        previous ? "border-warning/25 bg-warning/8" : "border-line bg-glass-hover"
      )}
      aria-live="polite"
    >
      <CalendarClock className={cn("mt-px h-4 w-4 shrink-0", previous ? "text-warning" : "text-accent")} aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold text-fg">
          Counts toward {formatMonthLabel(month)}
          {previous && (
            <span className="ml-1.5 rounded-full bg-warning/15 px-2 py-px text-[10px] font-semibold text-warning">
              Previous month
            </span>
          )}
        </p>
        <p className="mt-0.5 text-fg-muted">
          {previous
            ? `${formatMonthLabel(month)} has ended. This updates ${formatDayLabel(date)} and the rest of ${formatMonthLabel(month)} only. ${formatMonthLabel(currentMonth)} isn't affected.`
            : `Recorded on ${formatDayLabel(date, true)}.`}
        </p>
      </div>
    </div>
  );
}

export function ExpenseModal({
  onClose,
  currency,
  today,
  expense,
  defaultDate,
}: {
  onClose: () => void;
  currency: SupportedCurrency;
  today: string;
  /** Set when editing. */
  expense?: DailyExpenseRecord;
  defaultDate: string;
}) {
  const isOnline = useOnlineStatus();
  const { run, isPending } = useDailyBudgetMutation();
  // A stable id for this entry: a retried submit reuses it, so it can never be added twice.
  const [entryId] = useState(() => expense?.id ?? newId());
  const [amount, setAmount] = useState(expense ? String(Number(expense.amount)) : "");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [date, setDate] = useState(expense?.expense_date ?? defaultDate);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) return;
    setError(null);
    const value = Number(amount);
    if (!amount.trim()) return setAmountError("Enter the amount you spent.");
    const input = { amount: value, expenseDate: date, description };
    const invalid = validateDailyExpenseInput(input, today);
    if (invalid) {
      if (/amount|decimal|large|zero/i.test(invalid)) setAmountError(invalid);
      else setFieldError(invalid);
      return;
    }
    run(
      expense
        ? {
            local: (ownerId) => updateDailyExpenseLocally(ownerId, { ...input, expenseId: expense.id }),
            remote: () => updateDailyExpenseAction({ ...input, expenseId: expense.id }),
          }
        : {
            local: (ownerId) => addDailyExpenseLocally(ownerId, { ...input, id: entryId }),
            remote: () => addDailyExpenseAction({ ...input, id: entryId }),
          },
      (outcome) => (outcome.success ? onClose() : setError(outcome.error ?? "Unable to save this expense."))
    );
  };

  const remove = () => {
    if (!expense || isPending) return;
    run(
      {
        local: (ownerId) => deleteDailyExpenseLocally(ownerId, expense.id),
        remote: () => deleteDailyExpenseAction(expense.id),
      },
      (outcome) => {
        if (outcome.success) return onClose();
        setError(outcome.error ?? "Unable to delete this expense.");
        setConfirmingDelete(false);
      }
    );
  };

  if (confirmingDelete && expense) {
    return (
      <Modal isOpen onClose={onClose} title="Delete this expense?" description="The balance for that day and the rest of its month is recalculated." size="sm">
        <div className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-danger/25 bg-danger/8 p-3.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">{expense.description}</p>
              <p className="text-[11px] text-fg-subtle">{formatDayLabel(expense.expense_date, true)}</p>
            </div>
            <span className="shrink-0 font-money text-base font-bold text-fg">{formatMoney(Number(expense.amount), currency)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setConfirmingDelete(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="danger" size="lg" onClick={remove} isLoading={isPending} disabled={isPending}>
              {isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={expense ? "Edit expense" : "Add expense"}
      description="Only counts toward your daily budget. Accounts and transactions aren't changed."
      size="sm"
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {error && (
          <Alert variant="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {!isOnline && <Alert variant="info">You are offline. This is saved on this device and syncs later.</Alert>}
        <AmountField
          id="daily-expense-amount"
          label="Amount spent"
          value={amount}
          onChange={(value) => {
            setAmount(value);
            setAmountError(null);
          }}
          currency={currency}
          error={amountError}
          disabled={isPending}
        />
        <Input
          label="Description"
          required
          value={description}
          maxLength={MAX_DAILY_EXPENSE_DESCRIPTION}
          placeholder="e.g. Lunch, auto fare"
          onChange={(event) => {
            setDescription(event.target.value);
            setFieldError(null);
          }}
          disabled={isPending}
        />
        <Input
          label="Date"
          type="date"
          required
          value={date}
          min="2000-01-01"
          max={today}
          onChange={(event) => {
            setDate(event.target.value);
            setFieldError(null);
          }}
          disabled={isPending}
          helperText="You can pick any earlier date, including previous months."
        />
        <MonthIndicator date={date} today={today} />
        {fieldError && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-danger" role="alert">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {fieldError}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" isLoading={isPending} disabled={isPending}>
          {isPending ? "Saving…" : expense ? "Save changes" : "Add expense"}
        </Button>
        {expense && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setConfirmingDelete(true);
            }}
            disabled={isPending}
            className="mx-auto flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete expense
          </button>
        )}
      </form>
    </Modal>
  );
}

export function LimitModal({
  onClose,
  currency,
  today,
  limits,
  isSetup,
}: {
  onClose: () => void;
  currency: SupportedCurrency;
  today: string;
  limits: DailyLimitRecord[];
  isSetup: boolean;
}) {
  const isOnline = useOnlineStatus();
  const { run, isPending } = useDailyBudgetMutation();
  const current = limitOn(limits, today);
  const [amount, setAmount] = useState(current !== null && !isSetup ? String(current) : "");
  const [effectiveDate, setEffectiveDate] = useState(isSetup ? `${monthOfDate(today)}-01` : today);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const replaces = limits.find((limit) => limit.effective_date === effectiveDate);
  // The limit in force the day before the new one starts (what earlier days keep).
  const before = isDateKey(effectiveDate) ? limitOn(limits, addDays(effectiveDate, -1)) : null;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) return;
    setError(null);
    if (!amount.trim()) return setAmountError("Enter your daily limit.");
    const input = { amount: Number(amount), effectiveDate };
    const invalid = validateDailyLimitInput(input, today);
    if (invalid) {
      if (/date|year/i.test(invalid)) setDateError(invalid);
      else setAmountError(invalid);
      return;
    }
    run(
      {
        local: (ownerId) => setDailyLimitLocally(ownerId, input),
        remote: () => setDailyLimitAction(input),
      },
      (outcome) => (outcome.success ? onClose() : setError(outcome.error ?? "Unable to save your daily limit."))
    );
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isSetup ? "Set up your daily budget" : "Change daily limit"}
      description={
        isSetup
          ? "The allowance is added automatically every day from the start date."
          : "The new limit applies from the date you choose. Earlier days keep their limit."
      }
      size="sm"
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {error && (
          <Alert variant="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {!isOnline && <Alert variant="info">You are offline. This is saved on this device and syncs later.</Alert>}
        <AmountField
          id="daily-limit-amount"
          label="Daily allowance"
          value={amount}
          onChange={(value) => {
            setAmount(value);
            setAmountError(null);
          }}
          currency={currency}
          error={amountError}
          disabled={isPending}
        />
        <Input
          label={isSetup ? "Start date" : "Applies from"}
          type="date"
          required
          value={effectiveDate}
          min="2000-01-01"
          onChange={(event) => {
            setEffectiveDate(event.target.value);
            setDateError(null);
          }}
          error={dateError ?? undefined}
          disabled={isPending}
        />
        {isDateKey(effectiveDate) && amount.trim() && Number.isFinite(Number(amount)) && (
          <p className="rounded-2xl border border-line bg-glass-hover p-3 text-xs text-fg-muted" aria-live="polite">
            From <span className="font-semibold text-fg">{formatDayLabel(effectiveDate, true)}</span>:{" "}
            <span className="font-money font-semibold text-fg">{formatMoney(Number(amount), currency)}</span> per day.
            {replaces
              ? ` This replaces the ${formatMoney(Number(replaces.amount), currency)} limit set for that date.`
              : before !== null && !isSetup
                ? ` Before that, days keep ${formatMoney(before, currency)}.`
                : ""}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" isLoading={isPending} disabled={isPending}>
          {isPending ? "Saving…" : isSetup ? "Start daily budget" : "Save new limit"}
        </Button>
      </form>
    </Modal>
  );
}

export function ConfirmModal({
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  isPending,
  error,
  children,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
  error: string | null;
  children?: React.ReactNode;
}) {
  return (
    <Modal isOpen onClose={onClose} title={title} description={description} size="sm">
      <div className="space-y-4">
        {error && <Alert variant="error">{error}</Alert>}
        {children}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="danger" size="lg" onClick={onConfirm} isLoading={isPending} disabled={isPending}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

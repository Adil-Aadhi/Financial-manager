"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Trash2 } from "lucide-react";
import { deleteMonthlyBudgetAction, saveMonthlyBudgetAction } from "@/app/actions/budget";
import { markOfflineDataStale } from "@/lib/offline/bootstrap";
import { deleteBudgetLocally, runMutation, saveBudgetLocally } from "@/lib/offline/mutations";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { validateBudgetAmount } from "@/lib/budget";
import { formatMoney } from "@/lib/format";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";

function currencySymbol(code: string) {
  try {
    return (
      new Intl.NumberFormat("en-IN", { style: "currency", currency: code })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? code
    );
  } catch {
    return code;
  }
}

/** Keep digits and one decimal point, max two decimals. */
function sanitizeAmount(value: string) {
  const cleaned = value.replace(/[^\d.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  if (rest.length === 0) return whole.slice(0, 12);
  return `${whole.slice(0, 12)}.${rest.join("").slice(0, 2)}`;
}

export function MonthlyBudgetModal({
  isOpen,
  onClose,
  currency,
  currentAmount,
}: {
  isOpen: boolean;
  onClose: () => void;
  currency: SupportedCurrency;
  /** Existing limit when editing; null when setting for the first time. */
  currentAmount: number | null;
}) {
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const isEditing = currentAmount !== null;
  const [amount, setAmount] = useState(isEditing ? String(currentAmount) : "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  const symbol = currencySymbol(currency);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) return;
    setError(null);

    if (!amount.trim()) {
      setFieldError("Enter your monthly budget.");
      return;
    }
    const value = Number(amount);
    const validationError = validateBudgetAmount(value);
    if (validationError) {
      setFieldError(validationError);
      return;
    }

    startTransition(async () => {
      const result = await runMutation({
        local: (ownerId) => saveBudgetLocally(ownerId, value),
        remote: () => saveMonthlyBudgetAction(value),
      });
      if (!result.success) {
        setError(result.error ?? "Unable to save your budget.");
        return;
      }
      onClose();
      if (result.queued) return; // Saved on this device; Home reads it from IndexedDB.
      markOfflineDataStale(["monthly-budget", "dashboard"]);
      router.refresh();
    });
  };

  const handleRemove = () => {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await runMutation({
        local: (ownerId) => deleteBudgetLocally(ownerId),
        remote: () => deleteMonthlyBudgetAction(),
      });
      if (!result.success) {
        setError(result.error ?? "Unable to remove your budget.");
        setIsConfirmingRemove(false);
        return;
      }
      onClose();
      if (result.queued) return;
      markOfflineDataStale(["monthly-budget", "dashboard"]);
      router.refresh();
    });
  };

  if (isConfirmingRemove) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Remove monthly budget?"
        description="Your spending history stays. You can set a new budget anytime."
        size="sm"
      >
        <div className="space-y-4">
          {!isOnline && <Alert variant="info">You are offline. Removing the budget is saved on this device and syncs later.</Alert>}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-danger/25 bg-danger/8 p-3.5">
            <span className="text-sm font-medium text-fg-muted">Current limit</span>
            <span className="font-money text-base font-bold text-fg">
              {formatMoney(currentAmount ?? 0, currency)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => setIsConfirmingRemove(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="lg"
              onClick={handleRemove}
              isLoading={isPending}
              disabled={isPending}
            >
              {isPending ? "Removing…" : "Remove"}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? "Edit monthly budget" : "Set monthly budget"}
      description="Covers expenses from all your accounts. Spending resets each month."
      size="sm"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {error && (
          <Alert variant="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {!isOnline && <Alert variant="info">You are offline. Budget changes are saved on this device and sync later.</Alert>}

        <div className="rounded-2xl border border-line bg-glass-hover px-4 pb-4 pt-3 text-center">
          <div className="flex items-center justify-between">
            <label htmlFor="budget-amount" className="text-xs font-medium text-fg-muted">
              Monthly budget amount
            </label>
            <span className="rounded-full border border-line bg-glass-input px-2.5 py-0.5 font-mono text-[11px] font-semibold text-fg-muted">
              {currency}
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-center gap-1">
            <span className="font-money text-2xl font-medium text-fg-subtle">{symbol}</span>
            <input
              id="budget-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amount}
              onChange={(event) => {
                setAmount(sanitizeAmount(event.target.value));
                setFieldError(null);
              }}
              disabled={isPending}
              autoFocus
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? "budget-amount-error" : undefined}
              style={{ width: `${Math.max(amount.length, 1) + 0.5}ch` }}
              className="min-w-[2ch] max-w-full bg-transparent text-center font-money text-[40px] font-bold leading-none tracking-tight text-fg outline-none placeholder:text-fg-subtle/50"
            />
          </div>
          {fieldError && (
            <p
              id="budget-amount-error"
              className="mt-2 flex animate-fade items-center justify-center gap-1.5 text-xs font-medium text-danger"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {fieldError}
            </p>
          )}
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          isLoading={isPending}
          disabled={isPending}
        >
          {isPending ? "Saving…" : isEditing ? "Save changes" : "Set budget"}
        </Button>

        {isEditing && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setIsConfirmingRemove(true);
            }}
            disabled={isPending}
            className="mx-auto flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove budget
          </button>
        )}
      </form>
    </Modal>
  );
}

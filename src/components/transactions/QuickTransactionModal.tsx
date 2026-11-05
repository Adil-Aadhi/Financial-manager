"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  Landmark,
  PenLine,
  Trash2,
} from "lucide-react";
import {
  createTransactionAction,
  getTransactionFormOptionsAction,
  updateTransactionAction,
} from "@/app/actions/transactions";
import { CategoryTile } from "@/components/categories/CategoryIcon";
import { markOfflineDataStale } from "@/lib/offline/bootstrap";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import type {
  TransactionFormOptions,
  TransactionRecord,
  TransactionType,
} from "@/lib/transactions";

export interface QuickTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAccount?: { id?: string; name: string } | null;
  transaction?: TransactionRecord | null;
  onSaved?: (message: string) => void;
  /** Edit mode only: shows a delete button next to Save. */
  onDelete?: () => void;
  lockAccount?: boolean;
}

function getLocalDateAndTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return { date: `${year}-${month}-${day}`, time: `${hours}:${minutes}` };
}

function currencySymbol(code?: string | null) {
  if (!code) return "";
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
  if (rest.length === 0) return whole.slice(0, 10);
  return `${whole.slice(0, 10)}.${rest.join("").slice(0, 2)}`;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 flex animate-fade items-center gap-1.5 text-xs font-medium text-danger">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

function SectionLabel({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <p id={id} className="mb-2 text-xs font-medium text-fg-muted">
      {children}
    </p>
  );
}

export function QuickTransactionModal({
  isOpen,
  onClose,
  selectedAccount,
  transaction,
  onSaved,
  onDelete,
  lockAccount,
}: QuickTransactionModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const localDefaults = useMemo(() => getLocalDateAndTime(), []);

  const isEditing = Boolean(transaction);

  const routeAccountId = useMemo(() => {
    if (pathname.startsWith("/accounts/") && pathname !== "/accounts") {
      const parts = pathname.split("/");
      return parts[2] || "";
    }
    return "";
  }, [pathname]);

  // Account detail page: locked to the current account for additions,
  // while preserving account switching when editing an existing transaction.
  const isAccountDetailPage = Boolean(
    !isEditing &&
      (lockAccount ?? (Boolean(routeAccountId) || Boolean(selectedAccount?.id)))
  );

  const effectiveAccountId = isAccountDetailPage
    ? selectedAccount?.id || routeAccountId || ""
    : transaction?.account_id ?? selectedAccount?.id ?? "";

  const [type, setType] = useState<TransactionType>(transaction?.type ?? "expense");
  const [amount, setAmount] = useState(transaction ? String(Number(transaction.amount)) : "");
  const [accountId, setAccountId] = useState(effectiveAccountId);
  const [categoryId, setCategoryId] = useState(transaction?.category_id ?? "");
  const [transactionDate, setTransactionDate] = useState(
    transaction?.transaction_date ?? localDefaults.date
  );
  const [transactionTime, setTransactionTime] = useState(
    transaction?.transaction_time?.slice(0, 5) ?? (transaction ? "" : localDefaults.time)
  );
  const [remark, setRemark] = useState(transaction?.description ?? "");
  const [options, setOptions] = useState<TransactionFormOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [isPending, startTransition] = useTransition();

  const currentAccountId = isAccountDetailPage ? effectiveAccountId : accountId;
  const currentAccount = options?.accounts.find((acc) => acc.id === currentAccountId);
  const activeAccountName = selectedAccount?.name || currentAccount?.name || null;
  const symbol = currencySymbol(currentAccount?.currency ?? options?.accounts[0]?.currency);

  const isSelectedAccountActive =
    !isAccountDetailPage ||
    !options ||
    !effectiveAccountId ||
    options.accounts.some((acc) => acc.id === effectiveAccountId);

  useEffect(() => {
    let cancelled = false;
    getTransactionFormOptionsAction().then((result) => {
      if (cancelled) return;
      if (!result.success || !result.options) {
        setError(result.error ?? "Unable to load the transaction form.");
      } else {
        const loaded = result.options;
        setOptions(loaded);
        // Quick entry: preselect the first account when nothing is chosen yet.
        setAccountId((current) => current || loaded.accounts[0]?.id || "");
      }
      setIsLoadingOptions(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredCategories = useMemo(
    () => options?.categories.filter((category) => category.type === type) ?? [],
    [options, type]
  );

  const clearFieldError = (field: string) => {
    setFieldErrors((current) => ({ ...current, [field]: "" }));
  };

  const chooseType = (nextType: TransactionType) => {
    setType(nextType);
    if (
      !options?.categories.some(
        (category) => category.id === categoryId && category.type === nextType
      )
    ) {
      setCategoryId("");
    }
    clearFieldError("category");
  };

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      nextErrors.amount = "Enter an amount greater than zero.";
    }
    if (!currentAccountId) nextErrors.account = "Choose an account.";
    if (!categoryId) nextErrors.category = "Choose a category.";
    if (!transactionDate) nextErrors.date = "Choose a date.";
    if (remark.trim().length > 200) nextErrors.remark = "Use 200 characters or fewer.";
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!validate()) return;

    startTransition(async () => {
      const input = {
        transactionId: transaction?.id,
        type,
        amount: Number(amount),
        accountId: currentAccountId,
        categoryId,
        transactionDate,
        transactionTime,
        remark,
      };
      const result = isEditing
        ? await updateTransactionAction(input)
        : await createTransactionAction(input);

      if (!result.success) {
        setError(result.error ?? "Unable to save this transaction.");
        return;
      }

      markOfflineDataStale();
      onSaved?.(isEditing ? "Transaction updated." : "Transaction added.");
      onClose();
      router.refresh();
    });
  };

  const disabled = isPending || isLoadingOptions;
  const isIncome = type === "income";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? "Edit transaction" : isIncome ? "New income" : "New expense"}
      description={isAccountDetailPage && activeAccountName ? activeAccountName : undefined}
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {error && (
          <Alert variant="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {isAccountDetailPage && !isLoadingOptions && !isSelectedAccountActive && (
          <Alert variant="error">This account is no longer active or available.</Alert>
        )}

        {/* Type switch */}
        <div
          role="radiogroup"
          aria-label="Transaction type"
          className="glass-track grid grid-cols-2 gap-1 rounded-full p-1"
        >
          {(["expense", "income"] as const).map((option) => {
            const active = type === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => chooseType(option)}
                disabled={isPending}
                className={cn(
                  "flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full text-xs font-semibold capitalize transition-all duration-200 disabled:cursor-not-allowed",
                  active
                    ? cn("glass", option === "income" ? "text-positive" : "text-danger")
                    : "text-fg-subtle hover:text-fg"
                )}
              >
                {option === "income" ? (
                  <ArrowDownLeft className="h-3.5 w-3.5" />
                ) : (
                  <ArrowUpRight className="h-3.5 w-3.5" />
                )}
                {option}
              </button>
            );
          })}
        </div>

        {/* Amount hero */}
        <div className="text-center">
          <label htmlFor="tx-amount" className="sr-only">
            Amount
          </label>
          <div className="flex items-baseline justify-center gap-1">
            {symbol && (
              <span className="font-money text-2xl font-medium text-fg-subtle">{symbol}</span>
            )}
            <input
              id="tx-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amount}
              onChange={(event) => {
                setAmount(sanitizeAmount(event.target.value));
                clearFieldError("amount");
              }}
              disabled={disabled}
              autoFocus
              aria-invalid={Boolean(fieldErrors.amount)}
              style={{ width: `${Math.max(amount.length, 1) + 0.5}ch` }}
              className={cn(
                "min-w-[2ch] max-w-full bg-transparent text-center font-money text-[44px] font-bold leading-none tracking-tight outline-none placeholder:text-fg-subtle/50 sm:text-5xl",
                isIncome ? "text-positive" : "text-fg"
              )}
            />
          </div>
          <div className="flex justify-center">
            <FieldError message={fieldErrors.amount} />
          </div>
        </div>

        {/* Account */}
        {isAccountDetailPage ? null : (
          <div>
            <SectionLabel id="tx-account-label">Account</SectionLabel>
            {isLoadingOptions ? (
              <div className="flex gap-2">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-9 w-24 animate-pulse rounded-full bg-glass-hover" />
                ))}
              </div>
            ) : (
              <div
                role="radiogroup"
                aria-labelledby="tx-account-label"
                className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
              >
                {options?.accounts.map((account) => {
                  const active = account.id === accountId;
                  return (
                    <button
                      key={account.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={isPending}
                      onClick={() => {
                        setAccountId(account.id);
                        clearFieldError("account");
                      }}
                      className={cn(
                        "flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-all duration-200",
                        active
                          ? "border-accent/40 bg-accent-soft text-accent"
                          : "border-line bg-glass-input text-fg-muted hover:border-line-strong hover:text-fg"
                      )}
                    >
                      <Landmark className="h-3.5 w-3.5" />
                      {account.name}
                    </button>
                  );
                })}
              </div>
            )}
            <FieldError message={fieldErrors.account} />
          </div>
        )}

        {/* Category grid */}
        <div>
          <SectionLabel id="tx-category-label">Category</SectionLabel>
          <div
            role="radiogroup"
            aria-labelledby="tx-category-label"
            className="grid grid-cols-4 gap-x-2 gap-y-3 rounded-2xl border border-line bg-glass-hover p-3 sm:grid-cols-5"
          >
            {isLoadingOptions
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-1.5">
                    <span className="h-11 w-11 animate-pulse rounded-2xl bg-line" />
                    <span className="h-2.5 w-10 animate-pulse rounded bg-line" />
                  </div>
                ))
              : filteredCategories.map((category) => {
                  const active = category.id === categoryId;
                  return (
                    <button
                      key={category.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={isPending}
                      onClick={() => {
                        setCategoryId(category.id);
                        clearFieldError("category");
                      }}
                      className="group flex min-w-0 cursor-pointer flex-col items-center gap-1.5 rounded-xl py-0.5 focus-visible:outline-none"
                    >
                      <CategoryTile
                        icon={category.icon}
                        size="md"
                        className={cn(
                          "h-11 w-11 rounded-2xl transition-transform duration-200 group-active:scale-90",
                          active
                            ? "scale-105 outline-2 outline-offset-2 outline-(--tile-from)"
                            : "opacity-90 group-hover:opacity-100",
                          "group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent"
                        )}
                      />
                      <span
                        className={cn(
                          "w-full truncate text-center text-[11px] leading-tight",
                          active ? "font-semibold text-fg" : "text-fg-muted"
                        )}
                      >
                        {category.name}
                      </span>
                    </button>
                  );
                })}
            {!isLoadingOptions && filteredCategories.length === 0 && (
              <p className="col-span-full py-3 text-center text-xs text-fg-subtle">
                No {type} categories yet.
              </p>
            )}
          </div>
          <FieldError message={fieldErrors.category} />
        </div>

        {/* Date + time pills */}
        <div className="grid grid-cols-2 gap-2">
          <label className="glass-track flex h-11 min-w-0 items-center gap-2 rounded-xl px-3 focus-within:border-accent/60">
            <CalendarDays className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <span className="sr-only">Date</span>
            <input
              type="date"
              value={transactionDate}
              onChange={(event) => {
                setTransactionDate(event.target.value);
                clearFieldError("date");
              }}
              disabled={disabled}
              required
              className="w-full min-w-0 bg-transparent text-base font-medium text-fg outline-none sm:text-sm"
            />
          </label>
          <label className="glass-track flex h-11 min-w-0 items-center gap-2 rounded-xl px-3 focus-within:border-accent/60">
            <Clock3 className="h-4 w-4 shrink-0 text-info" aria-hidden="true" />
            <span className="sr-only">Time</span>
            <input
              type="time"
              value={transactionTime}
              onChange={(event) => setTransactionTime(event.target.value)}
              disabled={disabled}
              className="w-full min-w-0 bg-transparent text-base font-medium text-fg outline-none sm:text-sm"
            />
          </label>
        </div>
        <FieldError message={fieldErrors.date} />

        {/* Note */}
        <div>
          <label className="glass-track flex h-11 items-center gap-2 rounded-xl px-3 focus-within:border-accent/60">
            <PenLine className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
            <span className="sr-only">Note</span>
            <input
              value={remark}
              onChange={(event) => {
                setRemark(event.target.value);
                clearFieldError("remark");
              }}
              maxLength={200}
              placeholder="Add a note"
              disabled={disabled}
              className="w-full min-w-0 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle sm:text-sm"
            />
          </label>
          <FieldError message={fieldErrors.remark} />
        </div>

        {!isAccountDetailPage && options && options.accounts.length === 0 && (
          <Alert variant="warning">Add an active account before recording a transaction.</Alert>
        )}

        <div className="flex gap-2 pt-1">
          {isEditing && onDelete && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={onDelete}
              disabled={isPending}
              aria-label="Delete transaction"
              className="w-12 shrink-0 px-0 text-danger hover:bg-danger/10"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            isLoading={isPending}
            disabled={
              isLoadingOptions ||
              (isAccountDetailPage
                ? !effectiveAccountId || !isSelectedAccountActive
                : !options?.accounts.length)
            }
          >
            {isPending
              ? "Saving…"
              : isEditing
                ? "Save changes"
                : isIncome
                  ? "Save income"
                  : "Save expense"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

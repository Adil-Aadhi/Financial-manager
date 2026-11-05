"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Pencil, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { deleteTransactionAction } from "@/app/actions/transactions";
import { markOfflineDataStale } from "@/lib/offline/bootstrap";
import { CategoryTile } from "@/components/categories/CategoryIcon";
import { QuickTransactionModal } from "@/components/transactions/QuickTransactionModal";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import {
  normalizeTransactionDate,
  transactionSortValue,
  type TransactionCategoryOption,
  type TransactionRecord,
  type TransactionType,
} from "@/lib/transactions";

type TransactionFilter = "all" | TransactionType;

function localDateKey(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDayHeading(value: string) {
  if (!value) return "Undated";
  if (value === localDateKey()) return "Today";
  if (value === localDateKey(-1)) return "Yesterday";

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return "Undated";

  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: year === new Date().getFullYear() ? undefined : "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatTransactionTime(value: string | null) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function signedAmount(transaction: TransactionRecord, currency: SupportedCurrency) {
  const prefix = transaction.type === "income" ? "+" : "−";
  return `${prefix}${formatMoney(Number(transaction.amount) || 0, currency)}`;
}

function signedTotal(total: number, currency: SupportedCurrency) {
  const prefix = total > 0 ? "+" : total < 0 ? "−" : "";
  return `${prefix}${formatMoney(Math.abs(total), currency)}`;
}

export function TransactionHistory({
  transactions,
  currency,
  categories,
}: {
  transactions: TransactionRecord[];
  currency: SupportedCurrency;
  categories: TransactionCategoryOption[];
}) {
  const [filter, setFilter] = useState<TransactionFilter>("all");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [draftStartDate, setDraftStartDate] = useState("");
  const [draftEndDate, setDraftEndDate] = useState("");
  const [draftCategoryId, setDraftCategoryId] = useState("");
  const [editingTransaction, setEditingTransaction] = useState<TransactionRecord | null>(null);
  const [deletingTransaction, setDeletingTransaction] = useState<TransactionRecord | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const visibleTransactions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...transactions]
      .filter((transaction) => filter === "all" || transaction.type === filter)
      .filter((transaction) =>
        query
          ? `${transaction.description ?? ""} ${transaction.category?.name ?? ""}`
              .toLocaleLowerCase()
              .includes(query)
          : true
      )
      .filter((transaction) => !categoryId || transaction.category_id === categoryId)
      .filter((transaction) => !startDate || transaction.transaction_date >= startDate)
      .filter((transaction) => !endDate || transaction.transaction_date <= endDate)
      .sort((a, b) => transactionSortValue(b).localeCompare(transactionSortValue(a)));
  }, [categoryId, endDate, filter, search, startDate, transactions]);

  const groups = useMemo(() => {
    const byDay = new Map<string, { items: TransactionRecord[]; total: number }>();
    for (const transaction of visibleTransactions) {
      const key = normalizeTransactionDate(transaction.transaction_date);
      const group = byDay.get(key) ?? { items: [], total: 0 };
      const value = Number(transaction.amount) || 0;
      group.items.push(transaction);
      group.total += transaction.type === "income" ? value : -value;
      byDay.set(key, group);
    }
    return [...byDay.entries()];
  }, [visibleTransactions]);

  const hasAdvancedFilter = Boolean(startDate || endDate || categoryId);
  const hasFilters = Boolean(search || hasAdvancedFilter || filter !== "all");
  const invalidDraftRange = Boolean(
    draftStartDate && draftEndDate && draftStartDate > draftEndDate
  );

  const openFilters = () => {
    setDraftStartDate(startDate);
    setDraftEndDate(endDate);
    setDraftCategoryId(categoryId);
    setIsFilterOpen(true);
  };

  const applyFilters = () => {
    if (invalidDraftRange) return;
    setStartDate(draftStartDate);
    setEndDate(draftEndDate);
    setCategoryId(draftCategoryId);
    setIsFilterOpen(false);
  };

  return (
    <>
      <div className="space-y-4">
        {message && (
          <Alert variant="success" onClose={() => setMessage(null)}>
            {message}
          </Alert>
        )}

        {/* Search + filters */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <label className="glass-track flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full px-3.5 focus-within:border-accent/60">
              <Search className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
              <span className="sr-only">Search transactions</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search"
                className="w-full min-w-0 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle sm:text-sm"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="cursor-pointer text-fg-subtle hover:text-fg"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>
            <button
              type="button"
              onClick={openFilters}
              aria-haspopup="dialog"
              aria-label="Filter transactions"
              className={cn(
                "relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors",
                hasAdvancedFilter
                  ? "border-accent/40 bg-accent-soft text-accent"
                  : "border-line bg-glass-input text-fg-muted hover:text-fg"
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {hasAdvancedFilter && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />
              )}
            </button>
          </div>

          <div role="tablist" aria-label="Filter transactions" className="no-scrollbar flex gap-2 overflow-x-auto">
            {(["all", "income", "expense"] as const).map((option) => {
              const active = filter === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(option)}
                  className={cn(
                    "h-8 shrink-0 cursor-pointer rounded-full border px-3.5 text-xs font-semibold capitalize transition-all duration-200",
                    active
                      ? option === "income"
                        ? "border-positive/30 bg-positive/12 text-positive"
                        : option === "expense"
                          ? "border-danger/30 bg-danger/10 text-danger"
                          : "border-transparent bg-brand text-accent-fg shadow-glow"
                      : "border-line bg-glass-input text-fg-muted hover:text-fg"
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>

        {groups.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-5 w-5" />}
            title={hasFilters ? "No matches" : "No transactions yet"}
            description={hasFilters ? "Try another filter." : "Tap + to add one."}
            className="py-10"
          />
        ) : (
          <div className="space-y-4">
            {groups.map(([day, group]) => (
              <section key={day || "undated"} aria-label={formatDayHeading(day)}>
                <header className="mb-1.5 flex items-center justify-between px-1 text-xs">
                  <h3 className="font-semibold text-fg-muted">{formatDayHeading(day)}</h3>
                  <span
                    className={cn(
                      "font-money font-medium",
                      group.total > 0 ? "text-positive" : group.total < 0 ? "text-danger" : "text-fg-subtle"
                    )}
                  >
                    {signedTotal(group.total, currency)}
                  </span>
                </header>
                <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-glass-hover">
                  {group.items.map((transaction) => (
                    <TransactionRow
                      key={transaction.id}
                      transaction={transaction}
                      currency={currency}
                      onEdit={() => setEditingTransaction(transaction)}
                      onDelete={() => setDeletingTransaction(transaction)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        title="Filter transactions"
        description="Choose a date range or category."
        size="md"
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <Input
              label="From"
              type="date"
              value={draftStartDate}
              max={draftEndDate || undefined}
              onChange={(event) => setDraftStartDate(event.target.value)}
              className="text-base sm:text-sm"
            />
            <Input
              label="To"
              type="date"
              value={draftEndDate}
              min={draftStartDate || undefined}
              onChange={(event) => setDraftEndDate(event.target.value)}
              className="text-base sm:text-sm"
            />
          </div>

          {invalidDraftRange && (
            <Alert variant="warning">The end date must be on or after the start date.</Alert>
          )}

          <div>
            <p className="mb-2 text-[13px] font-medium text-fg-muted">Category</p>
            <button
              type="button"
              onClick={() => setDraftCategoryId("")}
              className={cn(
                "mb-3 h-9 cursor-pointer rounded-full border px-4 text-xs font-semibold transition-colors",
                !draftCategoryId
                  ? "border-transparent bg-brand text-accent-fg shadow-glow"
                  : "border-line bg-glass-input text-fg-muted hover:text-fg"
              )}
            >
              All categories
            </button>

            <div className="space-y-4">
              {(["income", "expense"] as const).map((categoryType) => {
                const typeCategories = categories.filter(
                  (category) => category.type === categoryType
                );
                if (typeCategories.length === 0) return null;

                return (
                  <section key={categoryType}>
                    <h3 className="mb-2 text-xs font-semibold capitalize text-fg-subtle">
                      {categoryType}
                    </h3>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {typeCategories.map((category) => {
                        const selected = draftCategoryId === category.id;
                        return (
                          <button
                            key={category.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setDraftCategoryId(category.id)}
                            className={cn(
                              "flex min-w-0 cursor-pointer flex-col items-center gap-1.5 rounded-2xl border p-2 text-center transition-colors",
                              selected
                                ? "border-accent/50 bg-accent-soft text-accent"
                                : "border-line bg-glass-input text-fg-muted hover:border-line-strong hover:text-fg"
                            )}
                          >
                            <CategoryTile icon={category.icon} size="sm" />
                            <span className="w-full truncate text-[11px] font-medium">
                              {category.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-line pt-4">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => {
                setDraftStartDate("");
                setDraftEndDate("");
                setDraftCategoryId("");
              }}
            >
              Reset
            </Button>
            <Button size="lg" onClick={applyFilters} disabled={invalidDraftRange}>
              Apply filters
            </Button>
          </div>
        </div>
      </Modal>

      {editingTransaction && (
        <QuickTransactionModal
          key={editingTransaction.id}
          isOpen
          transaction={editingTransaction}
          onClose={() => setEditingTransaction(null)}
          onSaved={setMessage}
          onDelete={() => {
            setDeletingTransaction(editingTransaction);
            setEditingTransaction(null);
          }}
        />
      )}

      {deletingTransaction && (
        <DeleteTransactionModal
          key={deletingTransaction.id}
          transaction={deletingTransaction}
          currency={currency}
          onClose={() => setDeletingTransaction(null)}
          onDeleted={() => setMessage("Transaction deleted.")}
        />
      )}
    </>
  );
}

/** Tap the row to edit (delete lives in the edit sheet). Hover icons on desktop. */
function TransactionRow({
  transaction,
  currency,
  onEdit,
  onDelete,
}: {
  transaction: TransactionRecord;
  currency: SupportedCurrency;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const income = transaction.type === "income";
  const title = transaction.description || transaction.category?.name || (income ? "Income" : "Expense");
  const time = formatTransactionTime(transaction.transaction_time);
  const meta = [transaction.description ? transaction.category?.name : null, time]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="group relative flex items-center">
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${title}`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-glass-hover active:bg-glass-hover sm:px-4 sm:py-3"
      >
        <CategoryTile icon={transaction.category?.icon} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">{title}</p>
          {meta && <p className="mt-0.5 truncate text-[11px] text-fg-subtle">{meta}</p>}
        </div>
        <p
          className={cn(
            "shrink-0 font-money text-[13px] font-semibold sm:text-sm",
            income ? "text-positive" : "text-danger"
          )}
        >
          {signedAmount(transaction, currency)}
        </p>
      </button>
      <div className="hidden shrink-0 gap-1 pr-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 lg:flex">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onEdit} aria-label={`Edit ${title}`}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-danger hover:bg-danger/10 hover:text-danger"
          onClick={onDelete}
          aria-label={`Delete ${title}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

function DeleteTransactionModal({
  transaction,
  currency,
  onClose,
  onDeleted,
}: {
  transaction: TransactionRecord;
  currency: SupportedCurrency;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      const result = await deleteTransactionAction(transaction.id);
      if (!result.success) {
        setError(result.error ?? "Unable to delete this transaction.");
        return;
      }
      markOfflineDataStale();
      onClose();
      onDeleted();
      router.refresh();
    });
  };

  return (
    <Modal isOpen onClose={onClose} title="Delete transaction?" description="This can't be undone." size="sm">
      <div className="space-y-4">
        {error && <Alert variant="error">{error}</Alert>}
        <div className="flex items-center gap-3 rounded-2xl border border-danger/25 bg-danger/8 p-3.5">
          <CategoryTile icon={transaction.category?.icon} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-fg">
              {transaction.description || transaction.category?.name || "Transaction"}
            </p>
            <p
              className={cn(
                "mt-0.5 font-money text-base font-semibold",
                transaction.type === "income" ? "text-positive" : "text-danger"
              )}
            >
              {signedAmount(transaction, currency)}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="danger" size="lg" onClick={handleDelete} isLoading={isPending}>
            {isPending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

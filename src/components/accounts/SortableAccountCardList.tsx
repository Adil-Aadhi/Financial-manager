"use client";

import React, { useMemo, useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Landmark, Pencil, Trash2 } from "lucide-react";
import type { AccountListItem } from "@/components/accounts/AccountList";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import {
  applyCardOrder,
  getCardOrderStorageKey,
  hasCustomCardOrder,
  loadCardOrder,
  mergeCardOrder,
  saveCardOrder,
  subscribeToCardOrder,
} from "@/lib/transactionCardOrder";

/**
 * Hook to subscribe to localStorage card order using useSyncExternalStore.
 * Ensures hydration safety and instant reactivity without cascading renders.
 */
export function useTransactionCardOrder(ownerId?: string) {
  const storageKey = getCardOrderStorageKey(ownerId);

  const rawJson = useSyncExternalStore(
    subscribeToCardOrder,
    () => {
      try {
        if (typeof window === "undefined" || !window.localStorage) return "";
        return window.localStorage.getItem(storageKey) ?? "";
      } catch {
        return "";
      }
    },
    () => ""
  );

  return useMemo(() => {
    if (!rawJson) return [];
    try {
      const parsed = JSON.parse(rawJson);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0
      );
    } catch {
      return [];
    }
  }, [rawJson]);
}

export interface SortableAccountCardListProps {
  accounts: AccountListItem[];
  ownerId?: string;
  fallbackCurrency: SupportedCurrency;
  actionsEnabled?: boolean;
  onEdit: (account: AccountListItem) => void;
  onDelete: (account: AccountListItem) => void;
  onCustomOrderChange?: (hasCustom: boolean) => void;
}

export function SortableAccountCardList({
  accounts,
  ownerId,
  fallbackCurrency,
  actionsEnabled = true,
  onEdit,
  onDelete,
  onCustomOrderChange,
}: SortableAccountCardListProps) {
  const dndId = React.useId();
  const savedOrder = useTransactionCardOrder(ownerId);

  const items = useMemo(() => {
    if (!savedOrder || savedOrder.length === 0) {
      return accounts;
    }
    return applyCardOrder(accounts, savedOrder);
  }, [accounts, savedOrder]);

  const isCustomActive = useMemo(
    () => hasCustomCardOrder(accounts, items),
    [accounts, items]
  );

  // Notify parent of custom order status
  React.useEffect(() => {
    onCustomOrderChange?.(isCustomActive);
  }, [isCustomActive, onCustomOrderChange]);

  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: {
      distance: 8,
    },
  });

  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      delay: 250,
      tolerance: 5,
    },
  });

  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });

  const sensors = useSensors(mouseSensor, touchSensor, keyboardSensor);

  const itemIds = useMemo(() => items.map((acc) => acc.id), [items]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = items.findIndex((acc) => acc.id === active.id);
      const newIndex = items.findIndex((acc) => acc.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = arrayMove(items, oldIndex, newIndex);
        const currentSaved = loadCardOrder(ownerId);
        const merged = mergeCardOrder(
          currentSaved,
          reordered.map((acc) => acc.id)
        );
        saveCardOrder(ownerId, merged);
      }
    },
    [items, ownerId]
  );

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={itemIds} strategy={rectSortingStrategy}>
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((acc) => (
            <SortableAccountCard
              key={acc.id}
              account={acc}
              fallbackCurrency={fallbackCurrency}
              actionsEnabled={actionsEnabled}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableAccountCard({
  account,
  fallbackCurrency,
  actionsEnabled,
  onEdit,
  onDelete,
}: {
  account: AccountListItem;
  fallbackCurrency: SupportedCurrency;
  actionsEnabled: boolean;
  onEdit: (account: AccountListItem) => void;
  onDelete: (account: AccountListItem) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: account.id,
    attributes: {
      role: "region",
      roleDescription: "sortable account card",
    },
  });

  const currency =
    (account.currency as SupportedCurrency) || fallbackCurrency;
  const openingBalance = Number(account.opening_balance) || 0;
  const totalIncome = Number(account.total_income) || 0;
  const totalExpense = Number(account.total_expense) || 0;
  const balance = openingBalance + totalIncome - totalExpense;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    touchAction: "pan-y",
    WebkitTouchCallout: "none",
    WebkitUserSelect: "none",
    userSelect: "none",
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onDragStart={(e) => e.preventDefault()}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-line bg-glass-hover p-4 transition-colors",
        isDragging
          ? "z-50 border-accent/50 bg-glass opacity-85 shadow-2xl ring-1 ring-accent/30 scale-[1.01]"
          : "hover:border-accent/40"
      )}
    >
      <div className="pointer-events-none absolute -right-12 -top-14 h-36 w-36 rounded-full bg-[radial-gradient(circle,var(--aurora-1),transparent_70%)]" />

      <div className="relative flex items-center justify-between gap-3">
        <Link
          href={`/accounts/${account.id}`}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          className="flex min-w-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand text-accent-fg shadow-glow">
            <span className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent" />
            <Landmark className="relative h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-fg">{account.name}</p>
            <p className="mt-0.5 truncate text-[11px] text-fg-subtle">
              Opening{" "}
              <span className="font-money font-semibold">
                {formatMoney(openingBalance, currency)}
              </span>
            </p>
          </div>
        </Link>

        <div
          data-no-dnd="true"
          className="flex shrink-0 items-center gap-0.5"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          {actionsEnabled && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => onEdit(account)}
                aria-label={`Edit ${account.name}`}
                title="Edit account"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-danger hover:bg-danger/10 hover:text-danger"
                onClick={() => onDelete(account)}
                aria-label={`Delete ${account.name}`}
                title="Move to Trash"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Link
            href={`/accounts/${account.id}`}
            draggable={false}
            aria-label={`Open ${account.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-glass-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <Link
        href={`/accounts/${account.id}`}
        tabIndex={-1}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        className="relative mt-4 block"
      >
        <p className="text-[11px] font-medium text-fg-subtle">Balance</p>
        <p
          className={cn(
            "mt-0.5 truncate font-money text-[26px] font-bold leading-tight tracking-tight",
            balance > 0 ? "text-positive" : balance < 0 ? "text-danger" : "text-fg"
          )}
          title={formatMoney(balance, currency)}
        >
          {formatMoney(balance, currency)}
        </p>
      </Link>

      <dl className="relative mt-3 grid grid-cols-2 gap-2">
        <FlowTile label="Income" value={formatMoney(totalIncome, currency)} tone="positive" />
        <FlowTile label="Expenses" value={formatMoney(totalExpense, currency)} tone="negative" />
      </dl>
    </article>
  );
}

function FlowTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "negative";
}) {
  const positive = tone === "positive";
  return (
    <div className="min-w-0 rounded-xl border border-line bg-glass-input px-3 py-2.5">
      <dt
        className={cn(
          "flex items-center gap-1 text-[11px] font-medium",
          positive ? "text-positive" : "text-danger"
        )}
      >
        {positive ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
        {label}
      </dt>
      <dd className="mt-0.5 truncate font-money text-sm font-bold text-fg" title={value}>
        {value}
      </dd>
    </div>
  );
}

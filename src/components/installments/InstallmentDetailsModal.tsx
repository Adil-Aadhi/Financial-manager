"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Banknote, Building2, Check, FastForward, NotebookPen, Pause, Pencil, Play, Trash2, XCircle } from "lucide-react";
import {
  deleteInstallmentPlanAction,
  setInstallmentPlanLifecycleAction,
} from "@/app/actions/installments";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SectionRefreshIndicator } from "@/components/ui/SectionRefreshIndicator";
import { cn } from "@/lib/cn";
import {
  formatInstallmentDate,
  installmentCycleLabel,
  paymentMethodLabel,
  planTypeLabel,
  productCategoryLabel,
  summarizePlan,
  type InstallmentLifecycle,
  type InstallmentPaymentMethod,
  type InstallmentPaymentRecord,
  type InstallmentPlanRecord,
  type InstallmentScheduleRow,
} from "@/lib/installments";
import { deleteInstallmentPlanLocally, runMutation, setInstallmentPlanLifecycleLocally } from "@/lib/offline/mutations";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { InstallmentStatusBadge, dueLabel, money } from "./InstallmentCard";
import { InstallmentIconTile } from "./InstallmentIcon";
import { InstallmentPaymentModal, type PaymentTarget } from "./InstallmentPaymentModal";
import { InstallmentPlanFormModal, completeInstallmentMutation } from "./InstallmentPlanForm";
import type { InstallmentsData } from "./useInstallments";

export function InstallmentDetailsModal({
  ownerId,
  plan,
  data,
  today,
  currency,
  initialPaymentId,
  onClose,
}: {
  initialPaymentId?: string;
  ownerId: string;
  plan: InstallmentPlanRecord;
  data: InstallmentsData;
  today: string;
  currency: SupportedCurrency;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"details" | "edit" | "delete">("details");
  const [target, setTarget] = useState<PaymentTarget | null>(() => {
    const payment = initialPaymentId ? data.payments.find((item) => item.id === initialPaymentId && item.installment_plan_id === plan.id) : undefined;
    return payment ? { kind: payment.kind, installmentNumber: payment.installment_number, coversThrough: payment.covers_through, payment } : null;
  });
  const [tab, setTab] = useState<"schedule" | "history">("schedule");
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<InstallmentLifecycle | "delete" | null>(null);
  const [pending, startTransition] = useTransition();

  const summary = summarizePlan(plan, data.payments, today);
  const history = data.payments
    .filter((payment) => payment.installment_plan_id === plan.id)
    .sort((a, b) => b.installment_number - a.installment_number);
  const accountName = (id: string | null) => (id ? data.accounts.find((account) => account.id === id)?.name ?? "Removed account" : "—");
  const transactionFor = (id: string | null) => (id ? data.transactions.find((transaction) => transaction.id === id) ?? null : null);
  const unpaid = summary.rows.filter((row) => row.status !== "paid" && row.status !== "closed");
  // An early closure settles everything from the first unpaid installment to the last, so it is
  // only offered when no later installment was already paid out of order.
  const canCloseEarly =
    unpaid.length > 0 && summary.rows.every((row) => row.number < unpaid[0].number || (row.status !== "paid" && row.status !== "closed"));
  const canPay = plan.lifecycle !== "cancelled";

  if (mode === "edit") {
    return <InstallmentPlanFormModal key={`${plan.id}:${plan.updated_at ?? ""}`} onClose={() => setMode("details")} currency={currency} today={today} plan={plan} />;
  }
  if (target) {
    return (
      <InstallmentPaymentModal
        ownerId={ownerId}
        plan={plan}
        payments={data.payments}
        accounts={data.accounts}
        transactions={data.transactions}
        categoryAvailable={data.categoryAvailable}
        today={today}
        target={target}
        onClose={() => setTarget(null)}
      />
    );
  }

  const mutate = (action: InstallmentLifecycle | "delete", local: (owner: string) => Promise<void>, remote: () => Promise<{ success: boolean; error?: string }>, after?: () => void) => {
    setPendingAction(action);
    startTransition(async () => {
      const result = await runMutation({ local, remote });
      if (!result.success) return setError(result.error ?? "Unable to update this plan.");
      completeInstallmentMutation(result, router);
      after?.();
    });
  };
  const lifecycle = (value: InstallmentLifecycle) =>
    mutate(value, (owner) => setInstallmentPlanLifecycleLocally(owner, plan.id, value), () => setInstallmentPlanLifecycleAction(plan.id, value));

  if (mode === "delete") {
    return (
      <Modal isOpen onClose={() => setMode("details")} title="Delete plan?" description={plan.name} size="sm">
        <div className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <p className="text-sm leading-relaxed text-fg-muted">
            The schedule and its payment history are removed. Expenses already recorded in Transactions stay there, so account balances don&apos;t change. To keep the history, cancel the plan instead.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setMode("details")} disabled={pending}>Keep</Button>
            <Button variant="danger" size="lg" isLoading={pending && pendingAction === "delete"} disabled={pending} onClick={() => mutate("delete", (owner) => deleteInstallmentPlanLocally(owner, plan.id), () => deleteInstallmentPlanAction(plan.id), onClose)}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  const openRow = (row: InstallmentScheduleRow) => {
    if (row.status === "paid" && row.payment) {
      return setTarget({ kind: row.payment.kind, installmentNumber: row.payment.installment_number, coversThrough: row.payment.covers_through, payment: row.payment });
    }
    if (row.status === "closed" && row.closure) {
      return setTarget({ kind: "closure", installmentNumber: row.closure.installment_number, coversThrough: row.closure.covers_through, payment: row.closure });
    }
    if (canPay) setTarget({ kind: "installment", installmentNumber: row.number, coversThrough: row.number, payment: null });
  };

  return (
    <Modal isOpen onClose={onClose} title={plan.name} description={`${planTypeLabel(plan.plan_type)} · ${plan.provider}`} size="lg">
      <div className="relative space-y-5">
        <SectionRefreshIndicator scope="installments" className="absolute right-0 -top-4 rounded-full bg-glass-strong px-2 py-1" />
        {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}

        <div className="flex items-center gap-3 rounded-2xl border border-line bg-glass-hover p-4">
          <InstallmentIconTile icon={plan.icon} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-fg-subtle">Remaining</p>
            <p className="font-money text-xl font-bold text-fg">{money(summary.remainingCents / 100, plan.currency)}</p>
            <p className="truncate text-xs text-fg-subtle">
              {summary.settledCount}/{plan.installment_count} settled · {installmentCycleLabel(plan.billing_cycle, plan.billing_interval)}
              {summary.nextRow ? ` · next ${formatInstallmentDate(summary.nextRow.dueDate)}` : ""}
            </p>
          </div>
          <InstallmentStatusBadge status={summary.status} />
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.progress} aria-label="Repayment progress">
          <span className={cn("block h-full rounded-full", summary.status === "overdue" ? "bg-danger" : "bg-brand")} style={{ width: `${summary.progress}%` }} />
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
          <Fact label="Purchase price" value={money(plan.original_amount, plan.currency)} />
          <Fact label="Down payment" value={money(plan.down_payment, plan.currency)} />
          <Fact label="Financed" value={money(plan.financed_amount, plan.currency)} />
          <Fact label="Interest + fees" value={money(Number(plan.interest_amount) + Number(plan.additional_fees), plan.currency)} />
          <Fact label="Total repayment" value={money(plan.total_repayment_amount, plan.currency)} />
          <Fact label="Installment" value={money(plan.default_installment_amount, plan.currency)} />
          <Fact label="Paid so far" value={money(summary.paidCents / 100, plan.currency)} positive />
          <Fact label="Category" value={productCategoryLabel(plan.product_category)} plain />
          <Fact label="Purchased" value={formatInstallmentDate(plan.start_date)} plain />
          <Fact label="First due" value={formatInstallmentDate(plan.first_due_date)} plain />
          <Fact label="Reminder" value={`${plan.reminder_days} day${plan.reminder_days === 1 ? "" : "s"} before`} plain />
          <Fact label="Currency" value={plan.currency} plain />
        </dl>
        {(plan.description || plan.notes) && (
          <div className="space-y-1 rounded-xl border border-line bg-glass-input p-3 text-sm text-fg-muted">
            {plan.description && <p>{plan.description}</p>}
            {plan.notes && <p className="text-xs text-fg-subtle">{plan.notes}</p>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {plan.lifecycle === "cancelled" ? (
            <Button onClick={() => lifecycle("active")} leftIcon={<Play className="h-4 w-4" />} isLoading={pending && pendingAction === "active"} disabled={pending}>Reactivate</Button>
          ) : summary.nextRow ? (
            <Button onClick={() => openRow(summary.nextRow!)} leftIcon={<Check className="h-4 w-4" />} disabled={pending}>Mark {summary.nextRow.number}/{plan.installment_count} paid</Button>
          ) : null}
          <Button variant="secondary" onClick={() => setMode("edit")} leftIcon={<Pencil className="h-4 w-4" />} disabled={pending}>Edit</Button>
          {plan.lifecycle === "active" && <Button variant="outline" onClick={() => lifecycle("paused")} leftIcon={<Pause className="h-4 w-4" />} isLoading={pending && pendingAction === "paused"} disabled={pending}>Pause</Button>}
          {plan.lifecycle === "paused" && <Button variant="outline" onClick={() => lifecycle("active")} leftIcon={<Play className="h-4 w-4" />} isLoading={pending && pendingAction === "active"} disabled={pending}>Resume</Button>}
          {canPay && canCloseEarly && (
            <Button
              variant="outline"
              onClick={() => setTarget({ kind: "closure", installmentNumber: unpaid[0].number, coversThrough: plan.installment_count, payment: null })}
              leftIcon={<FastForward className="h-4 w-4" />}
              disabled={pending}
            >
              Close early
            </Button>
          )}
          {plan.lifecycle !== "cancelled" && plan.lifecycle !== "completed" && (
            <Button variant="ghost" onClick={() => lifecycle("cancelled")} leftIcon={<XCircle className="h-4 w-4" />} isLoading={pending && pendingAction === "cancelled"} disabled={pending}>Cancel plan</Button>
          )}
        </div>

        <div className="glass-track grid grid-cols-2 gap-1 rounded-xl p-1" role="tablist" aria-label="Plan details">
          {(["schedule", "history"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn("min-h-9 rounded-lg text-xs font-semibold", tab === value ? "bg-accent text-accent-fg shadow-glow" : "text-fg-muted hover:text-fg")}
            >
              {value === "schedule" ? `Schedule (${plan.installment_count})` : `Payment history (${history.length})`}
            </button>
          ))}
        </div>

        {tab === "schedule" ? (
          <ol className="divide-y divide-line rounded-2xl border border-line bg-glass-hover px-3">
            {summary.rows.map((row) => {
              const payment = row.payment;
              const interactive = row.status === "paid" || row.status === "closed" || canPay;
              return (
                <li key={row.number}>
                  <button
                    type="button"
                    onClick={() => openRow(row)}
                    disabled={!interactive}
                    className="flex w-full items-center gap-3 py-3 text-left disabled:cursor-default"
                  >
                    <span className="w-12 shrink-0 font-money text-xs font-semibold text-fg-muted">{row.number}/{plan.installment_count}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-fg">{formatInstallmentDate(row.dueDate)}</span>
                      <span className="block truncate text-[11px] text-fg-subtle">
                        {payment
                          ? `${payment.kind === "closure" ? "Early closure" : "Paid"} ${money(payment.actual_amount, plan.currency)} · ${formatInstallmentDate(payment.payment_date)} · ${payment.payment_method === "account" ? accountName(payment.account_id) : paymentMethodLabel(payment.payment_method)}`
                          : row.status === "closed"
                            ? "Settled by early closure"
                            : plan.lifecycle === "active"
                              ? dueLabel(row.daysUntilDue)
                              : "—"}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-money text-sm font-semibold text-fg">{money(row.expectedAmount, plan.currency)}</span>
                      <InstallmentStatusBadge status={row.status} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : history.length ? (
          <ul className="space-y-2">
            {history.map((payment) => (
              <PaymentHistoryItem
                key={payment.id}
                plan={plan}
                payment={payment}
                accountName={accountName(payment.account_id)}
                transaction={transactionFor(payment.transaction_id)}
                onEdit={() => setTarget({ kind: payment.kind, installmentNumber: payment.installment_number, coversThrough: payment.covers_through, payment })}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-line bg-glass-hover p-4 text-center text-xs text-fg-subtle">No confirmed payments yet.</p>
        )}

        <button type="button" onClick={() => setMode("delete")} disabled={pending} className="mx-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-55">
          <Trash2 className="h-3.5 w-3.5" />
          Delete plan
        </button>
      </div>
    </Modal>
  );
}

const METHOD_ICON: Record<InstallmentPaymentMethod, React.ReactNode> = {
  account: <Building2 className="h-3 w-3" aria-hidden="true" />,
  cash: <Banknote className="h-3 w-3" aria-hidden="true" />,
  manual: <NotebookPen className="h-3 w-3" aria-hidden="true" />,
};

function PaymentHistoryItem({
  plan,
  payment,
  accountName,
  transaction,
  onEdit,
}: {
  plan: InstallmentPlanRecord;
  payment: InstallmentPaymentRecord;
  accountName: string;
  transaction: { id: string; description: string | null } | null;
  onEdit: () => void;
}) {
  const number =
    payment.kind === "closure" && payment.covers_through > payment.installment_number
      ? `${payment.installment_number}–${payment.covers_through}/${plan.installment_count}`
      : `${payment.installment_number}/${plan.installment_count}`;
  const missingTransaction = payment.payment_method === "account" && (!payment.transaction_id || !transaction);
  return (
    <li>
      <button type="button" onClick={onEdit} className="w-full rounded-2xl border border-line bg-glass-hover p-3 text-left transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-fg">
              {payment.kind === "closure" ? "Early closure" : "Installment"} {number}
            </p>
            <p className="text-[11px] text-fg-subtle">
              Due {formatInstallmentDate(payment.due_date)} · paid {formatInstallmentDate(payment.payment_date)}
              {payment.payment_date > payment.due_date ? " (late)" : ""}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-money text-sm font-semibold text-fg">{money(payment.actual_amount, plan.currency)}</p>
            <p className="text-[11px] text-fg-subtle">of {money(payment.expected_amount, plan.currency)}</p>
            <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-accent">
              <Pencil className="h-3 w-3" aria-hidden="true" />
              Edit
            </span>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
              payment.payment_method === "account" ? "bg-accent-soft text-accent" : payment.payment_method === "cash" ? "bg-positive/12 text-positive" : "bg-glass-input text-fg-muted"
            )}
          >
            {METHOD_ICON[payment.payment_method]}
            {payment.payment_method === "account" ? "Account" : paymentMethodLabel(payment.payment_method)}
          </span>
          {payment.payment_method === "account" && <span className="text-fg-muted">{accountName}</span>}
          {payment.payment_method === "account" && transaction && (
            <span className="min-w-0 truncate text-fg-subtle">
              · {payment.transaction_origin === "linked" ? "Linked" : "Expense"}: {transaction.description || "Expense"} · #{transaction.id.slice(0, 8)}
            </span>
          )}
          {payment.payment_method !== "account" && <span className="text-fg-subtle">No account or transaction</span>}
        </div>
        {missingTransaction && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-warning">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Its transaction was removed elsewhere. Open to record or link it again.
          </p>
        )}
        {payment.notes && <p className="mt-1.5 text-[11px] text-fg-muted">{payment.notes}</p>}
      </button>
    </li>
  );
}

function Fact({ label, value, positive = false, plain = false }: { label: string; value: string; positive?: boolean; plain?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className={cn("mt-0.5 truncate text-sm font-semibold", !plain && "font-money", positive ? "text-positive" : "text-fg")}>{value}</dd>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import {
  createSubscriptionAction,
  deleteSubscriptionAction,
  markSubscriptionPaidAction,
  setSubscriptionLifecycleAction,
  undoSubscriptionPaymentAction,
  updateSubscriptionAction,
} from "@/app/actions/subscriptions";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { markOfflineDataStale } from "@/lib/offline/bootstrap";
import {
  createSubscriptionLocally,
  deleteSubscriptionLocally,
  markSubscriptionPaidLocally,
  runMutation,
  setSubscriptionLifecycleLocally,
  undoSubscriptionPaymentLocally,
  updateSubscriptionLocally,
} from "@/lib/offline/mutations";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import {
  DEFAULT_SUBSCRIPTION_ICON,
  SUBSCRIPTION_CYCLES,
  SUBSCRIPTION_ICON_OPTIONS,
  addBillingCycle,
  cycleLabel,
  formatSubscriptionDate,
  subscriptionStatus,
  validateSubscriptionInput,
  isSubscriptionIcon,
  type BillingCycle,
  type SubscriptionIconName,
  type SubscriptionPaymentRecord,
  type SubscriptionRecord,
  type SubscriptionLifecycle,
} from "@/lib/subscriptions";
import { SubscriptionStatusBadge } from "./SubscriptionCard";
import { SubscriptionIconTile } from "./SubscriptionIcon";

const CURRENCIES: SupportedCurrency[] = ["INR", "USD", "AED"];

function completeMutation(result: { queued: boolean }, router: ReturnType<typeof useRouter>) {
  if (!result.queued) {
    markOfflineDataStale();
    router.refresh();
  }
}

export function SubscriptionFormModal({
  isOpen,
  onClose,
  currency,
  today,
  subscription,
}: {
  isOpen: boolean;
  onClose: () => void;
  currency: SupportedCurrency;
  today: string;
  subscription?: SubscriptionRecord | null;
}) {
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const [name, setName] = useState(subscription?.name ?? "");
  const [icon, setIcon] = useState<SubscriptionIconName>(
    isSubscriptionIcon(subscription?.icon) ? subscription.icon : DEFAULT_SUBSCRIPTION_ICON
  );
  const [amount, setAmount] = useState(subscription ? String(subscription.amount) : "");
  const [selectedCurrency, setSelectedCurrency] = useState(subscription?.currency ?? currency);
  const [cycle, setCycle] = useState<BillingCycle>(subscription?.billing_cycle ?? "monthly");
  const [nextDate, setNextDate] = useState(subscription?.next_payment_date ?? today);
  const [notes, setNotes] = useState(subscription?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    const invalid = validateSubscriptionInput({
      name,
      icon,
      amount: value,
      currency: selectedCurrency,
      billingCycle: cycle,
      nextPaymentDate: nextDate,
      notes,
    });
    if (invalid) {
      setError(invalid);
      return;
    }
    const id = subscription?.id ?? crypto.randomUUID();
    const [, , anchorDay] = nextDate.split("-").map(Number);
    const input = {
      id,
      name: name.trim(),
      icon,
      amount: value,
      currency: selectedCurrency,
      billingCycle: cycle,
      billingAnchorDay: anchorDay,
      startDate: subscription?.start_date ?? today,
      nextPaymentDate: nextDate,
      lifecycle: subscription?.lifecycle ?? ("active" as const),
      notes: notes.trim(),
    };
    startTransition(async () => {
      const result = await runMutation({
        local: (ownerId) => subscription
          ? updateSubscriptionLocally(ownerId, input)
          : createSubscriptionLocally(ownerId, input),
        remote: () => subscription ? updateSubscriptionAction(input) : createSubscriptionAction(input),
      });
      if (!result.success) {
        setError(result.error ?? "Unable to save this subscription.");
        return;
      }
      onClose();
      completeMutation(result, router);
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={subscription ? "Edit subscription" : "Add subscription"} description="A reminder only—this never creates a transaction." size="md">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}
        {!isOnline && <Alert variant="info">Changes are saved on this device and sync when you reconnect.</Alert>}
        <Input label="Subscription name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required autoFocus />
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-fg-muted">Icon</legend>
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-10">
            {SUBSCRIPTION_ICON_OPTIONS.map((option) => {
              const selected = icon === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  title={option.label}
                  aria-label={option.label}
                  aria-pressed={selected}
                  onClick={() => setIcon(option.value)}
                  className="flex min-h-11 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  <SubscriptionIconTile
                    icon={option.value}
                    size="sm"
                    className={selected ? "outline-2 outline-offset-2 outline-(--tile-from)" : "opacity-75 transition-opacity hover:opacity-100"}
                  />
                </button>
              );
            })}
          </div>
          <p className="text-xs text-fg-subtle">Selected: {SUBSCRIPTION_ICON_OPTIONS.find((option) => option.value === icon)?.label}</p>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
          <Select label="Currency" value={selectedCurrency} onChange={(event) => setSelectedCurrency(event.target.value)} required>
            {CURRENCIES.map((code) => <option key={code}>{code}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Billing cycle" value={cycle} onChange={(event) => setCycle(event.target.value as BillingCycle)} required>
            {SUBSCRIPTION_CYCLES.map((value) => <option key={value} value={value}>{cycleLabel(value)}</option>)}
          </Select>
          <Input label="Next payment date" type="date" value={nextDate} onChange={(event) => setNextDate(event.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="subscription-notes" className="text-[13px] font-medium text-fg-muted">Notes <span className="text-fg-subtle">(optional)</span></label>
          <textarea id="subscription-notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} rows={3} className="block w-full resize-none rounded-xl border border-line bg-glass-input px-4 py-3 text-base text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent/70 focus:ring-4 focus:ring-accent/15 sm:text-sm" />
        </div>
        <Button type="submit" size="lg" className="w-full" isLoading={isPending} disabled={isPending}>{isPending ? "Saving…" : subscription ? "Save changes" : "Add subscription"}</Button>
      </form>
    </Modal>
  );
}

export function SubscriptionDetailsModal({
  subscription,
  payments,
  today,
  currency,
  onClose,
}: {
  subscription: SubscriptionRecord;
  payments: SubscriptionPaymentRecord[];
  today: string;
  currency: SupportedCurrency;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"details" | "edit" | "delete">("details");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const history = payments.filter((payment) => payment.subscription_id === subscription.id)
    .sort((a, b) => b.due_date.localeCompare(a.due_date));
  const latest = history[0];
  const nextFuture = addBillingCycle(subscription.next_payment_date, subscription.billing_cycle, subscription.billing_anchor_day);
  const secondFuture = addBillingCycle(nextFuture, subscription.billing_cycle, subscription.billing_anchor_day);

  if (mode === "edit") {
    return <SubscriptionFormModal key={`${subscription.id}:${subscription.updated_at}`} isOpen onClose={() => setMode("details")} currency={currency} today={today} subscription={subscription} />;
  }

  const mutate = (local: (ownerId: string) => Promise<void>, remote: () => Promise<{ success: boolean; error?: string }>, done?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await runMutation({ local, remote });
      if (!result.success) {
        setError(result.error ?? "Unable to update this subscription.");
        return;
      }
      completeMutation(result, router);
      done?.();
    });
  };

  const setLifecycle = (lifecycle: SubscriptionLifecycle) => mutate(
    (ownerId) => setSubscriptionLifecycleLocally(ownerId, subscription.id, lifecycle),
    () => setSubscriptionLifecycleAction(subscription.id, lifecycle)
  );

  const markPaid = () => {
    const paymentId = crypto.randomUUID();
    const paidAt = new Date().toISOString();
    mutate(
      (ownerId) => markSubscriptionPaidLocally(ownerId, { paymentId, subscriptionId: subscription.id, dueDate: subscription.next_payment_date, paidAt }),
      () => markSubscriptionPaidAction({ paymentId, subscriptionId: subscription.id, dueDate: subscription.next_payment_date, paidAt })
    );
  };

  const undo = () => {
    if (!latest) return;
    mutate(
      (ownerId) => undoSubscriptionPaymentLocally(ownerId, { paymentId: latest.id, subscriptionId: subscription.id, dueDate: latest.due_date }),
      () => undoSubscriptionPaymentAction({ paymentId: latest.id, subscriptionId: subscription.id, dueDate: latest.due_date })
    );
  };

  if (mode === "delete") {
    return (
      <Modal isOpen onClose={() => setMode("details")} title="Delete subscription?" description="Its reminder and payment history will be removed. Financial data is untouched." size="sm">
        <div className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setMode("details")}>Cancel</Button>
            <Button variant="danger" size="lg" isLoading={isPending} onClick={() => mutate(
              (ownerId) => deleteSubscriptionLocally(ownerId, subscription.id),
              () => deleteSubscriptionAction(subscription.id),
              onClose
            )}>Delete</Button>
          </div>
        </div>
      </Modal>
    );
  }

  const status = subscriptionStatus(subscription, today);
  return (
    <Modal isOpen onClose={onClose} title={subscription.name} description={`${cycleLabel(subscription.billing_cycle)} · next ${formatSubscriptionDate(subscription.next_payment_date)}`} size="md">
      <div className="space-y-5">
        {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}
        <div className="flex items-center justify-between rounded-2xl border border-line bg-glass-hover p-4">
          <div><p className="text-xs text-fg-subtle">Current payment</p><p className="mt-1 font-money text-lg font-bold text-fg">{subscription.currency} {Number(subscription.amount).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</p></div>
          <SubscriptionStatusBadge status={status} />
        </div>

        {subscription.notes && <p className="rounded-xl border border-line bg-glass-input p-3 text-sm text-fg-muted">{subscription.notes}</p>}

        <div className="grid grid-cols-2 gap-2">
          {subscription.lifecycle === "active" ? (
            <Button onClick={markPaid} disabled={isPending} leftIcon={<Check className="h-4 w-4" />}>Mark as paid</Button>
          ) : subscription.lifecycle === "paused" ? (
            <Button onClick={() => setLifecycle("active")} disabled={isPending} leftIcon={<Play className="h-4 w-4" />}>Resume</Button>
          ) : (
            <Button onClick={() => setLifecycle("active")} disabled={isPending} leftIcon={<Play className="h-4 w-4" />}>Reactivate</Button>
          )}
          <Button variant="secondary" onClick={() => setMode("edit")} disabled={isPending}>Edit</Button>
          {subscription.lifecycle === "active" && <Button variant="outline" onClick={() => setLifecycle("paused")} disabled={isPending} leftIcon={<Pause className="h-4 w-4" />}>Pause</Button>}
          {subscription.lifecycle !== "cancelled" && <Button variant="outline" onClick={() => setLifecycle("cancelled")} disabled={isPending}>Cancel plan</Button>}
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-fg">Payment history</h3>{latest && <button type="button" onClick={undo} disabled={isPending} className="flex items-center gap-1 text-xs font-semibold text-accent disabled:opacity-50"><RotateCcw className="h-3 w-3" />Undo latest</button>}</div>
          <div className="divide-y divide-line rounded-2xl border border-line bg-glass-hover px-3">
            <div className="flex items-center justify-between py-3 text-xs"><span className="text-fg-muted">Current cycle · {formatSubscriptionDate(subscription.next_payment_date)}</span><SubscriptionStatusBadge status={status} /></div>
            {subscription.lifecycle === "active" && [nextFuture, secondFuture].map((date) => <div key={date} className="flex items-center justify-between py-3 text-xs"><span className="text-fg-muted">Future cycle · {formatSubscriptionDate(date)}</span><SubscriptionStatusBadge status="upcoming" /></div>)}
            {history.map((payment) => <div key={payment.id} className="flex items-center justify-between py-3 text-xs"><span className="text-fg-muted">Due {formatSubscriptionDate(payment.due_date)}</span><span className="font-semibold text-positive">Paid {new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(payment.paid_at))}</span></div>)}
            {!history.length && <p className="py-3 text-xs text-fg-subtle">No confirmed payments yet.</p>}
          </div>
        </section>

        <button type="button" onClick={() => setMode("delete")} className="mx-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10"><Trash2 className="h-3.5 w-3.5" />Delete subscription</button>
      </div>
    </Modal>
  );
}

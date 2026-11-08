"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pause, Play, Trash2 } from "lucide-react";
import {
  createBillAction, createBillPaymentAction, deleteBillAction, deleteBillPaymentAction,
  setBillLifecycleAction, updateBillAction, updateBillPaymentAction,
} from "@/app/actions/bills";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { SectionRefreshIndicator } from "@/components/ui/SectionRefreshIndicator";
import { markOfflineDataStale } from "@/lib/offline/bootstrap";
import {
  createBillLocally, createBillPaymentLocally, deleteBillLocally, deleteBillPaymentLocally,
  runMutation, setBillLifecycleLocally, updateBillLocally, updateBillPaymentLocally,
} from "@/lib/offline/mutations";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import {
  BILL_CATEGORIES, BILL_CYCLES, BILL_ICON_OPTIONS, billCategoryLabel,
  billCycleLabel, billStatus, formatBillDate, isBillIcon, validateBillInput, validateBillPayment,
  type BillAmountType, type BillCategory, type BillCycle, type BillIconName, type BillLifecycle,
  type BillPaymentRecord, type BillRecord,
} from "@/lib/bills";
import { BillIconTile } from "./BillIcon";
import { BillStatusBadge } from "./BillCard";

const CURRENCIES: SupportedCurrency[] = ["INR", "USD", "AED"];
function complete(result: { queued: boolean }, router: ReturnType<typeof useRouter>) { if (!result.queued) { markOfflineDataStale(["bills"]); router.refresh(); } }

export function BillFormModal({ isOpen, onClose, currency, today, bill }: { isOpen: boolean; onClose: () => void; currency: SupportedCurrency; today: string; bill?: BillRecord | null }) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [name, setName] = useState(bill?.name ?? "");
  const [category, setCategory] = useState<BillCategory>(bill?.category ?? "internet");
  const [icon, setIcon] = useState<BillIconName>(isBillIcon(bill?.icon) ? bill.icon : "wifi");
  const [amountType, setAmountType] = useState<BillAmountType>(bill?.amount_type ?? "fixed");
  const [expected, setExpected] = useState(bill?.expected_amount == null ? "" : String(bill.expected_amount));
  const [selectedCurrency, setSelectedCurrency] = useState(bill?.currency ?? currency);
  const [cycle, setCycle] = useState<BillCycle>(bill?.billing_cycle ?? "monthly");
  const [interval, setInterval] = useState(String(bill?.billing_interval ?? 1));
  const [startDate, setStartDate] = useState(bill?.start_date ?? today);
  const [nextDate, setNextDate] = useState(bill?.next_due_date ?? today);
  const [reminderDays, setReminderDays] = useState(String(bill?.reminder_days ?? 3));
  const [notes, setNotes] = useState(bill?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const chooseCategory = (value: BillCategory) => {
    setCategory(value);
    const suggested = BILL_CATEGORIES.find((item) => item.value === value)?.icon;
    if (isBillIcon(suggested)) setIcon(suggested);
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const expectedAmount = expected.trim() ? Number(expected) : null;
    const billingInterval = Number(interval);
    const input = { name, category, icon, amountType, expectedAmount, currency: selectedCurrency, billingCycle: cycle, billingInterval, startDate, nextDueDate: nextDate, reminderDays: Number(reminderDays), notes };
    const invalid = validateBillInput(input);
    if (invalid) return setError(invalid);
    const [, , anchor] = nextDate.split("-").map(Number);
    const full = { ...input, id: bill?.id ?? crypto.randomUUID(), name: name.trim(), billingAnchorDay: anchor, lifecycle: bill?.lifecycle ?? ("active" as const), notes: notes.trim() };
    startTransition(async () => {
      const result = await runMutation({ local: (ownerId) => bill ? updateBillLocally(ownerId, full) : createBillLocally(ownerId, full), remote: () => bill ? updateBillAction(full) : createBillAction(full) });
      if (!result.success) return setError(result.error ?? "Unable to save this bill.");
      onClose(); complete(result, router);
    });
  };

  return <Modal isOpen={isOpen} onClose={onClose} title={bill ? "Edit bill" : "Add bill"} description="Reminder only—no account or transaction is changed." size="lg">
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}
      {!online && <Alert variant="info">Changes are saved on this device and sync when you reconnect.</Alert>}
      <Input label="Bill name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required autoFocus />
      <Select label="Category" value={category} onChange={(event) => chooseCategory(event.target.value as BillCategory)}>{BILL_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select>
      <fieldset className="space-y-2"><legend className="text-[13px] font-medium text-fg-muted">Icon</legend><div className="grid grid-cols-6 gap-2 sm:grid-cols-11">{BILL_ICON_OPTIONS.map((option) => <button key={option.value} type="button" title={option.label} aria-label={option.label} aria-pressed={icon === option.value} onClick={() => setIcon(option.value)} className="flex min-h-11 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"><BillIconTile icon={option.value} size="sm" className={icon === option.value ? "outline-2 outline-offset-2 outline-(--tile-from)" : "opacity-75 hover:opacity-100"} /></button>)}</div></fieldset>
      <div className="grid grid-cols-2 gap-3"><Select label="Amount type" value={amountType} onChange={(event) => setAmountType(event.target.value as BillAmountType)}><option value="fixed">Fixed amount</option><option value="variable">Variable amount</option></Select><Select label="Currency" value={selectedCurrency} onChange={(event) => setSelectedCurrency(event.target.value)}>{CURRENCIES.map((code) => <option key={code}>{code}</option>)}</Select></div>
      <Input label={amountType === "fixed" ? "Expected amount" : "Expected amount (optional)"} type="number" inputMode="decimal" min="0.01" step="0.01" value={expected} onChange={(event) => setExpected(event.target.value)} required={amountType === "fixed"} />
      <div className="grid gap-3 sm:grid-cols-2"><Select label="Billing frequency" value={cycle} onChange={(event) => setCycle(event.target.value as BillCycle)}>{BILL_CYCLES.map((value) => <option key={value} value={value}>{billCycleLabel(value, Number(interval) || 1)}</option>)}</Select>{cycle.startsWith("custom_") && <Input label={cycle === "custom_days" ? "Number of days" : "Number of months"} type="number" min="1" value={interval} onChange={(event) => setInterval(event.target.value)} />}</div>
      <div className="grid grid-cols-2 gap-3"><Input label="Start date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /><Input label="Next due date" type="date" value={nextDate} onChange={(event) => setNextDate(event.target.value)} required /></div>
      <Input label="Remind days before" type="number" min="0" max="365" value={reminderDays} onChange={(event) => setReminderDays(event.target.value)} helperText="Use 0 for the due date, or 1, 3, 7, or any custom number." />
      <div className="space-y-1.5"><label htmlFor="bill-notes" className="text-[13px] font-medium text-fg-muted">Notes <span className="text-fg-subtle">(optional)</span></label><textarea id="bill-notes" rows={3} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} className="block w-full resize-none rounded-xl border border-line bg-glass-input px-4 py-3 text-base text-fg outline-none focus:border-accent/70 focus:ring-4 focus:ring-accent/15 sm:text-sm" /></div>
      <Button type="submit" size="lg" className="w-full" isLoading={pending}>{bill ? "Save changes" : "Add bill"}</Button>
    </form>
  </Modal>;
}

function BillPaymentModal({ bill, payment, today, onClose }: { bill: BillRecord; payment?: BillPaymentRecord | null; today: string; onClose: () => void }) {
  const router = useRouter();
  const [dueDate, setDueDate] = useState(payment?.due_date ?? bill.next_due_date);
  const [actual, setActual] = useState(String(payment?.actual_amount ?? bill.expected_amount ?? ""));
  const [paymentDate, setPaymentDate] = useState(payment?.payment_date ?? today);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"save" | "remove" | null>(null);
  const [pending, startTransition] = useTransition();
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const invalid = validateBillPayment(Number(actual), paymentDate, dueDate);
    if (invalid) return setError(invalid);
    const input = { paymentId: payment?.id ?? crypto.randomUUID(), billId: bill.id, dueDate, actualAmount: Number(actual), paymentDate, paidAt: payment?.paid_at ?? new Date().toISOString() };
    setPendingAction("save");
    startTransition(async () => {
      const result = await runMutation({ local: (ownerId) => payment ? updateBillPaymentLocally(ownerId, input) : createBillPaymentLocally(ownerId, input), remote: () => payment ? updateBillPaymentAction(input) : createBillPaymentAction(input) });
      if (!result.success) return setError(result.error ?? "Unable to save this payment.");
      onClose(); complete(result, router);
    });
  };
  const remove = () => {
    if (!payment) return;
    setPendingAction("remove");
    startTransition(async () => {
      const result = await runMutation({ local: (ownerId) => deleteBillPaymentLocally(ownerId, payment.id), remote: () => deleteBillPaymentAction(payment.id, bill.id) });
      if (!result.success) return setError(result.error ?? "Unable to remove this payment.");
      onClose(); complete(result, router);
    });
  };
  return <Modal isOpen onClose={onClose} title={payment ? "Edit payment" : "Mark bill as paid"} description="This records status only and never creates a transaction." size="sm"><form onSubmit={save} className="space-y-4">{error && <Alert variant="error">{error}</Alert>}<Input label="Billing-cycle due date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={Boolean(payment)} /><Input label="Actual amount paid" type="number" inputMode="decimal" min="0.01" step="0.01" value={actual} onChange={(event) => setActual(event.target.value)} required /><Input label="Payment date" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required /><div className={payment ? "grid grid-cols-2 gap-2" : ""}>{payment && <Button type="button" variant="danger" size="lg" onClick={remove} isLoading={pending && pendingAction === "remove"} disabled={pending}>Undo payment</Button>}<Button type="submit" size="lg" className="w-full" isLoading={pending && pendingAction === "save"} disabled={pending}>{payment ? "Save payment" : "Confirm paid"}</Button></div></form></Modal>;
}

export function BillDetailsModal({ bill, payments, today, currency, onClose }: { bill: BillRecord; payments: BillPaymentRecord[]; today: string; currency: SupportedCurrency; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"details" | "edit" | "pay" | "delete">("details");
  const [editingPayment, setEditingPayment] = useState<BillPaymentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<BillLifecycle | "delete" | null>(null);
  const [pending, startTransition] = useTransition();
  const history = payments.filter((item) => item.bill_id === bill.id).sort((a, b) => b.due_date.localeCompare(a.due_date));
  if (mode === "edit") return <BillFormModal key={`${bill.id}:${bill.updated_at}`} isOpen onClose={() => setMode("details")} currency={currency} today={today} bill={bill} />;
  if (mode === "pay" || editingPayment) return <BillPaymentModal bill={bill} payment={editingPayment} today={today} onClose={() => { setMode("details"); setEditingPayment(null); }} />;
  const mutate = (action: BillLifecycle | "delete", local: (ownerId: string) => Promise<void>, remote: () => Promise<{ success: boolean; error?: string }>, done?: () => void) => { setPendingAction(action); startTransition(async () => { const result = await runMutation({ local, remote }); if (!result.success) return setError(result.error ?? "Unable to update this bill."); complete(result, router); done?.(); }); };
  const lifecycle = (value: BillLifecycle) => mutate(value, (ownerId) => setBillLifecycleLocally(ownerId, bill.id, value), () => setBillLifecycleAction(bill.id, value));
  if (mode === "delete") return <Modal isOpen onClose={() => setMode("details")} title="Delete bill?" description="Its reminder and payment history will be removed. Financial data is untouched." size="sm"><div className="grid grid-cols-2 gap-2"><Button variant="secondary" size="lg" onClick={() => setMode("details")} disabled={pending}>Cancel</Button><Button variant="danger" size="lg" isLoading={pending && pendingAction === "delete"} disabled={pending} onClick={() => mutate("delete", (ownerId) => deleteBillLocally(ownerId, bill.id), () => deleteBillAction(bill.id), onClose)}>Delete</Button></div></Modal>;
  const status = billStatus(bill, today);
  return <Modal isOpen onClose={onClose} title={bill.name} description={`${billCategoryLabel(bill.category)} · ${billCycleLabel(bill.billing_cycle, bill.billing_interval)}`} size="md"><div className="relative space-y-5"><SectionRefreshIndicator scope="bills" className="absolute right-0 -top-4 rounded-full bg-glass-strong px-2 py-1" />{error && <Alert variant="error">{error}</Alert>}<div className="flex items-center gap-3 rounded-2xl border border-line bg-glass-hover p-4"><BillIconTile icon={bill.icon} /><div className="min-w-0 flex-1"><p className="text-xs text-fg-subtle">Expected amount</p><p className="font-money text-lg font-bold text-fg">{bill.expected_amount == null ? "Not estimated" : `${bill.currency} ${Number(bill.expected_amount).toLocaleString("en-IN")}`}</p><p className="text-xs text-fg-subtle">Due {formatBillDate(bill.next_due_date)} · reminder {bill.reminder_days}d before</p></div><BillStatusBadge status={status} /></div>{bill.notes && <p className="rounded-xl border border-line bg-glass-input p-3 text-sm text-fg-muted">{bill.notes}</p>}<div className="grid grid-cols-2 gap-2">{bill.lifecycle === "active" ? <Button onClick={() => setMode("pay")} leftIcon={<Check className="h-4 w-4" />} disabled={pending}>Mark as paid</Button> : <Button onClick={() => lifecycle("active")} leftIcon={<Play className="h-4 w-4" />} isLoading={pending && pendingAction === "active"} disabled={pending}>{bill.lifecycle === "paused" ? "Resume" : "Reactivate"}</Button>}<Button variant="secondary" onClick={() => setMode("edit")} disabled={pending}>Edit</Button>{bill.lifecycle === "active" && <Button variant="outline" onClick={() => lifecycle("paused")} leftIcon={<Pause className="h-4 w-4" />} isLoading={pending && pendingAction === "paused"} disabled={pending}>Pause</Button>}{bill.lifecycle !== "cancelled" && <Button variant="outline" onClick={() => lifecycle("cancelled")} isLoading={pending && pendingAction === "cancelled"} disabled={pending}>Cancel bill</Button>}</div><section><h3 className="mb-2 text-sm font-semibold text-fg">Payment history</h3><div className="divide-y divide-line rounded-2xl border border-line bg-glass-hover px-3"><div className="flex items-center justify-between py-3 text-xs"><span className="text-fg-muted">Current cycle · {formatBillDate(bill.next_due_date)}</span><BillStatusBadge status={status} /></div>{history.map((item) => <button key={item.id} type="button" onClick={() => setEditingPayment(item)} disabled={pending} className="flex w-full items-center justify-between gap-3 py-3 text-left text-xs disabled:opacity-55"><span className="text-fg-muted">Due {formatBillDate(item.due_date)} · paid {formatBillDate(item.payment_date)}</span><span className="font-money font-semibold text-positive">{item.currency ?? bill.currency}{" "}{Number(item.actual_amount).toLocaleString("en-IN")}</span></button>)}{!history.length && <p className="py-3 text-xs text-fg-subtle">No confirmed payments yet.</p>}</div></section><button type="button" onClick={() => setMode("delete")} disabled={pending} className="mx-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-55"><Trash2 className="h-3.5 w-3.5" />Delete bill</button></div></Modal>;
}

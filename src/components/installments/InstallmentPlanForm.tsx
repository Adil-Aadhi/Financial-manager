"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInstallmentPlanAction, updateInstallmentPlanAction } from "@/app/actions/installments";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import {
  INSTALLMENT_CYCLES,
  INSTALLMENT_ICON_OPTIONS,
  INSTALLMENT_PLAN_TYPES,
  INSTALLMENT_PRODUCT_CATEGORIES,
  INSTALLMENT_PROVIDER_SUGGESTIONS,
  buildSchedule,
  computeFinancials,
  formatInstallmentDate,
  installmentCycleLabel,
  isInstallmentIcon,
  suggestInstallmentAmount,
  validatePlanInput,
  type InstallmentCycle,
  type InstallmentIconName,
  type InstallmentPlanInput,
  type InstallmentPlanRecord,
  type InstallmentPlanType,
  type InstallmentProductCategory,
} from "@/lib/installments";
import { markOfflineDataStale } from "@/lib/offline/bootstrap";
import { createInstallmentPlanLocally, runMutation, updateInstallmentPlanLocally } from "@/lib/offline/mutations";
import { useOnlineStatus } from "@/lib/offline/useOnlineStatus";
import type { SupportedCurrency } from "@/lib/supabase/profile";
import { money } from "./InstallmentCard";
import { InstallmentIconTile } from "./InstallmentIcon";

const CURRENCIES: SupportedCurrency[] = ["INR", "USD", "AED"];
const DEFAULT_PROVIDER: Record<InstallmentPlanType, string> = { product_emi: "Bank EMI", bnpl: "Amazon Pay Later", custom: "" };

export function completeInstallmentMutation(result: { queued: boolean }, router: ReturnType<typeof useRouter>) {
  if (!result.queued) {
    markOfflineDataStale(["installments", "transactions", "accounts", "dashboard"]);
    router.refresh();
  }
}

const num = (value: string) => (value.trim() === "" ? 0 : Number(value));

export function InstallmentPlanFormModal({
  onClose,
  currency,
  today,
  plan,
}: {
  onClose: () => void;
  currency: SupportedCurrency;
  today: string;
  plan?: InstallmentPlanRecord | null;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [planType, setPlanType] = useState<InstallmentPlanType>(plan?.plan_type ?? "product_emi");
  const [provider, setProvider] = useState(plan?.provider ?? DEFAULT_PROVIDER.product_emi);
  const [productCategory, setProductCategory] = useState<InstallmentProductCategory>(plan?.product_category ?? "mobile");
  const [icon, setIcon] = useState<InstallmentIconName>(isInstallmentIcon(plan?.icon) ? plan.icon : "smartphone");
  const [original, setOriginal] = useState(plan ? String(Number(plan.original_amount)) : "");
  const [down, setDown] = useState(plan && Number(plan.down_payment) ? String(Number(plan.down_payment)) : "");
  const [interest, setInterest] = useState(plan && Number(plan.interest_amount) ? String(Number(plan.interest_amount)) : "");
  const [fees, setFees] = useState(plan && Number(plan.additional_fees) ? String(Number(plan.additional_fees)) : "");
  const [count, setCount] = useState(String(plan?.installment_count ?? 12));
  const [manualAmount, setManualAmount] = useState(() => {
    if (!plan) return false;
    return Number(plan.default_installment_amount) !== suggestInstallmentAmount(Number(plan.total_repayment_amount), plan.installment_count);
  });
  const [installment, setInstallment] = useState(plan ? String(Number(plan.default_installment_amount)) : "");
  const [selectedCurrency, setSelectedCurrency] = useState(plan?.currency ?? currency);
  const [cycle, setCycle] = useState<InstallmentCycle>(plan?.billing_cycle ?? "monthly");
  const [interval, setIntervalValue] = useState(String(plan?.billing_interval ?? 1));
  const [startDate, setStartDate] = useState(plan?.start_date ?? today);
  const [firstDue, setFirstDue] = useState(plan?.first_due_date ?? today);
  const [reminderDays, setReminderDays] = useState(String(plan?.reminder_days ?? 3));
  const [notes, setNotes] = useState(plan?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const installmentCount = Math.trunc(num(count));
  const preliminary = computeFinancials({
    originalAmount: num(original),
    downPayment: num(down),
    interestAmount: num(interest),
    additionalFees: num(fees),
    installmentCount: installmentCount || 1,
    defaultInstallmentAmount: 0,
  });
  const suggested = suggestInstallmentAmount(preliminary.totalCents / 100, installmentCount);
  const installmentAmount = manualAmount ? num(installment) : suggested;
  const financials = computeFinancials({
    originalAmount: num(original),
    downPayment: num(down),
    interestAmount: num(interest),
    additionalFees: num(fees),
    installmentCount: installmentCount || 1,
    defaultInstallmentAmount: installmentAmount,
  });
  const preview =
    firstDue && installmentCount > 0 && installmentCount <= 600
      ? buildSchedule(
          {
            id: "preview",
            first_due_date: firstDue,
            billing_cycle: cycle,
            billing_interval: Math.max(1, Math.trunc(num(interval)) || 1),
            reminder_days: 0,
            total_repayment_amount: financials.totalCents / 100,
            installment_count: installmentCount,
            default_installment_amount: installmentAmount,
          },
          [],
          today
        )
      : [];

  const choosePlanType = (value: InstallmentPlanType) => {
    setPlanType(value);
    if (!plan && (provider === "" || Object.values(DEFAULT_PROVIDER).includes(provider))) setProvider(DEFAULT_PROVIDER[value]);
  };
  const chooseCategory = (value: InstallmentProductCategory) => {
    setProductCategory(value);
    const suggestion = INSTALLMENT_PRODUCT_CATEGORIES.find((item) => item.value === value)?.icon;
    if (isInstallmentIcon(suggestion)) setIcon(suggestion);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const input: InstallmentPlanInput = {
      name,
      description,
      planType,
      provider,
      productCategory,
      icon,
      originalAmount: num(original),
      downPayment: num(down),
      interestAmount: num(interest),
      additionalFees: num(fees),
      currency: selectedCurrency,
      installmentCount,
      defaultInstallmentAmount: installmentAmount,
      billingCycle: cycle,
      billingInterval: cycle.startsWith("custom_") ? Math.trunc(num(interval)) : 1,
      startDate,
      firstDueDate: firstDue,
      reminderDays: Math.trunc(num(reminderDays)),
      notes,
    };
    if (!original.trim()) return setError("Enter the original purchase price.");
    const invalid = validatePlanInput(input);
    if (invalid) return setError(invalid);
    const full = { ...input, id: plan?.id ?? crypto.randomUUID() };
    startTransition(async () => {
      const result = await runMutation({
        local: (ownerId) => (plan ? updateInstallmentPlanLocally(ownerId, full) : createInstallmentPlanLocally(ownerId, full)),
        remote: () => (plan ? updateInstallmentPlanAction(full) : createInstallmentPlanAction(full)),
      });
      if (!result.success) return setError(result.error ?? "Unable to save this plan.");
      onClose();
      completeInstallmentMutation(result, router);
    });
  };

  return (
    <Modal isOpen onClose={onClose} title={plan ? "Edit installment plan" : "New installment plan"} description="Plans never move money. Only confirmed account payments create expenses." size="lg">
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}
        {!online && <Alert variant="info">Saved on this device and synced when you reconnect.</Alert>}

        <section className="space-y-4">
          <SectionTitle>Plan</SectionTitle>
          <div className="glass-track grid grid-cols-3 gap-1 rounded-xl p-1" role="radiogroup" aria-label="Installment type">
            {INSTALLMENT_PLAN_TYPES.map((type) => (
              <button
                key={type.value}
                type="button"
                role="radio"
                aria-checked={planType === type.value}
                onClick={() => choosePlanType(type.value)}
                className={cn(
                  "min-h-10 rounded-lg px-2 text-xs font-semibold transition-colors",
                  planType === type.value ? "bg-accent text-accent-fg shadow-glow" : "text-fg-muted hover:text-fg"
                )}
              >
                {type.label}
              </button>
            ))}
          </div>
          <Input label="Product or plan name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="iPhone EMI" required className="text-base sm:text-sm" />
          <div className="space-y-2">
            <Input label="Provider / platform" value={provider} onChange={(event) => setProvider(event.target.value)} maxLength={60} placeholder="HDFC Bank EMI" required className="text-base sm:text-sm" />
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {INSTALLMENT_PROVIDER_SUGGESTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setProvider(item)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold",
                    provider === item ? "border-accent/30 bg-accent/12 text-accent" : "border-line bg-glass-hover text-fg-muted"
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <Select label="Product category" value={productCategory} onChange={(event) => chooseCategory(event.target.value as InstallmentProductCategory)} className="text-base sm:text-sm">
            {INSTALLMENT_PRODUCT_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </Select>
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium text-fg-muted">Icon</legend>
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
              {INSTALLMENT_ICON_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  title={option.label}
                  aria-label={option.label}
                  aria-pressed={icon === option.value}
                  onClick={() => setIcon(option.value)}
                  className="flex min-h-11 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  <InstallmentIconTile icon={option.value} size="sm" className={icon === option.value ? "outline-2 outline-offset-2 outline-(--tile-from)" : "opacity-75 hover:opacity-100"} />
                </button>
              ))}
            </div>
          </fieldset>
          <Input label="Description (optional)" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} placeholder="256 GB, Blue" className="text-base sm:text-sm" />
        </section>

        <section className="space-y-4">
          <SectionTitle>Amounts</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Purchase price" type="number" inputMode="decimal" min="0.01" step="0.01" value={original} onChange={(event) => setOriginal(event.target.value)} required className="text-base sm:text-sm" />
            <Select label="Currency" value={selectedCurrency} onChange={(event) => setSelectedCurrency(event.target.value)} className="text-base sm:text-sm">
              {CURRENCIES.map((code) => <option key={code}>{code}</option>)}
            </Select>
            <Input label="Down payment" type="number" inputMode="decimal" min="0" step="0.01" value={down} onChange={(event) => setDown(event.target.value)} placeholder="0" className="text-base sm:text-sm" />
            <Input label="Interest" type="number" inputMode="decimal" min="0" step="0.01" value={interest} onChange={(event) => setInterest(event.target.value)} placeholder="0" className="text-base sm:text-sm" />
            <Input label="Fees" type="number" inputMode="decimal" min="0" step="0.01" value={fees} onChange={(event) => setFees(event.target.value)} placeholder="0" helperText="Processing fee, GST…" className="text-base sm:text-sm" />
            <Input label="Installments" type="number" inputMode="numeric" min="1" max="600" step="1" value={count} onChange={(event) => setCount(event.target.value)} required className="text-base sm:text-sm" />
          </div>
          <div className="space-y-2">
            <Input
              label="Installment amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={manualAmount ? installment : suggested ? String(suggested) : ""}
              onChange={(event) => setInstallment(event.target.value)}
              disabled={!manualAmount}
              className="text-base sm:text-sm"
              labelAction={
                <button
                  type="button"
                  onClick={() => {
                    if (!manualAmount) setInstallment(suggested ? String(suggested) : "");
                    setManualAmount(!manualAmount);
                  }}
                  className="text-xs font-semibold text-accent hover:text-accent-strong"
                >
                  {manualAmount ? "Use even split" : "Adjust manually"}
                </button>
              }
              helperText="The last installment settles any remainder, so nothing is left over."
            />
          </div>
          <dl className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-glass-hover p-3 text-xs sm:grid-cols-4">
            <Calc label="Financed" value={money(financials.financedCents / 100, selectedCurrency)} />
            <Calc label="Total repayment" value={money(financials.totalCents / 100, selectedCurrency)} />
            <Calc label="Each installment" value={money(financials.installmentCents / 100, selectedCurrency)} />
            <Calc label="Last installment" value={money(financials.finalCents / 100, selectedCurrency)} danger={financials.finalCents <= 0 && financials.totalCents > 0} />
          </dl>
        </section>

        <section className="space-y-4">
          <SectionTitle>Schedule</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Frequency" value={cycle} onChange={(event) => setCycle(event.target.value as InstallmentCycle)} className="text-base sm:text-sm">
              {INSTALLMENT_CYCLES.map((value) => (
                <option key={value} value={value}>
                  {value === "custom_days" ? "Custom (days)" : value === "custom_months" ? "Custom (months)" : installmentCycleLabel(value)}
                </option>
              ))}
            </Select>
            {cycle.startsWith("custom_") && (
              <Input label={cycle === "custom_days" ? "Every how many days" : "Every how many months"} type="number" inputMode="numeric" min="1" value={interval} onChange={(event) => setIntervalValue(event.target.value)} className="text-base sm:text-sm" />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Purchase date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required className="text-base sm:text-sm" />
            <Input label="First due date" type="date" value={firstDue} onChange={(event) => setFirstDue(event.target.value)} required className="text-base sm:text-sm" />
          </div>
          <Input label="Remind days before" type="number" inputMode="numeric" min="0" max="365" value={reminderDays} onChange={(event) => setReminderDays(event.target.value)} helperText="Installments inside this window show as Pending." className="text-base sm:text-sm" />
          {preview.length > 0 && (
            <p className="text-xs text-fg-subtle">
              {preview.length} × {installmentCycleLabel(cycle, Math.max(1, Math.trunc(num(interval)) || 1)).toLowerCase()} · {formatInstallmentDate(preview[0].dueDate)} → {formatInstallmentDate(preview[preview.length - 1].dueDate)}
            </p>
          )}
        </section>

        <div className="space-y-1.5">
          <label htmlFor="installment-notes" className="text-[13px] font-medium text-fg-muted">Notes <span className="text-fg-subtle">(optional)</span></label>
          <textarea
            id="installment-notes"
            rows={3}
            maxLength={500}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="block w-full resize-none rounded-xl border border-line bg-glass-input px-4 py-3 text-base text-fg outline-none focus:border-accent/70 focus:ring-4 focus:ring-accent/15 sm:text-sm"
          />
        </div>
        <Button type="submit" size="lg" className="w-full" isLoading={pending}>{plan ? "Save changes" : "Create plan"}</Button>
      </form>
    </Modal>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="border-t border-line pt-4 text-xs font-semibold uppercase tracking-wide text-fg-subtle first:border-t-0 first:pt-0">{children}</h3>;
}

function Calc({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className={cn("truncate font-money text-sm font-semibold", danger ? "text-danger" : "text-fg")}>{value}</dd>
    </div>
  );
}

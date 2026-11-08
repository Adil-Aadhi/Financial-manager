import { addDays, dailyBudgetToday, isDateKey, toCents } from "@/lib/dailyBudget";

/**
 * Installments Tracker domain rules, shared by the UI, the local-first mutations and the server
 * sync apply so all three accept and compute exactly the same things.
 *
 * Money is handled in integer cents. The schedule is derived from the plan (it is never stored):
 * every installment is the plan's default amount except the last, which settles the remainder,
 * so the schedule always adds up to the total repayment with no rounding difference.
 *
 * Dates are calendar dates ("YYYY-MM-DD") in the India calendar (Asia/Kolkata), the same as
 * transactions and the other trackers.
 */

export const INSTALLMENT_PLAN_TYPES = [
  { value: "product_emi", label: "Product EMI" },
  { value: "bnpl", label: "Buy Now Pay Later" },
  { value: "custom", label: "Custom plan" },
] as const;

export const INSTALLMENT_PROVIDER_SUGGESTIONS = [
  "Bank EMI",
  "Credit Card EMI",
  "Amazon Pay Later",
  "Flipkart Pay Later",
  "Flipkart Pay in 3",
  "Other",
] as const;

export const INSTALLMENT_PRODUCT_CATEGORIES = [
  { value: "mobile", label: "Mobile", icon: "smartphone" },
  { value: "laptop", label: "Laptop / computer", icon: "laptop" },
  { value: "electronics", label: "Electronics", icon: "tv" },
  { value: "appliance", label: "Home appliance", icon: "refrigerator" },
  { value: "furniture", label: "Furniture", icon: "sofa" },
  { value: "vehicle", label: "Vehicle", icon: "car" },
  { value: "fashion", label: "Fashion", icon: "shirt" },
  { value: "travel", label: "Travel", icon: "plane" },
  { value: "education", label: "Education", icon: "graduation-cap" },
  { value: "health", label: "Health", icon: "heart-pulse" },
  { value: "shopping", label: "Shopping", icon: "shopping-bag" },
  { value: "other", label: "Other", icon: "package" },
] as const;

export const INSTALLMENT_ICON_OPTIONS = [
  { value: "smartphone", label: "Phone" },
  { value: "laptop", label: "Laptop" },
  { value: "tablet", label: "Tablet" },
  { value: "headphones", label: "Audio" },
  { value: "watch", label: "Watch" },
  { value: "camera", label: "Camera" },
  { value: "tv", label: "TV" },
  { value: "gamepad-2", label: "Gaming" },
  { value: "refrigerator", label: "Refrigerator" },
  { value: "washing-machine", label: "Washing machine" },
  { value: "air-vent", label: "Air conditioner" },
  { value: "sofa", label: "Furniture" },
  { value: "car", label: "Car" },
  { value: "bike", label: "Bike" },
  { value: "shirt", label: "Fashion" },
  { value: "plane", label: "Travel" },
  { value: "graduation-cap", label: "Education" },
  { value: "heart-pulse", label: "Health" },
  { value: "shopping-bag", label: "Shopping" },
  { value: "shopping-cart", label: "Online order" },
  { value: "credit-card", label: "Card EMI" },
  { value: "landmark", label: "Bank" },
  { value: "wallet", label: "Pay Later" },
  { value: "package", label: "Other" },
] as const;

export const INSTALLMENT_CYCLES = ["weekly", "monthly", "quarterly", "custom_days", "custom_months"] as const;
export const INSTALLMENT_LIFECYCLES = ["active", "paused", "completed", "cancelled"] as const;
export const INSTALLMENT_PAYMENT_METHODS = ["account", "cash", "manual"] as const;
export const INSTALLMENT_PAYMENT_KINDS = ["installment", "closure"] as const;
export const INSTALLMENT_TRANSACTION_ORIGINS = ["created", "linked"] as const;

/** The single shared expense category used for every installment transaction. */
export const INSTALLMENT_CATEGORY_NAME = "Installment Payment";
export const INSTALLMENT_CATEGORY_ICON = "calendar-clock";

/** Shown wherever a direct edit/delete of an installment-generated expense is refused. */
export const INSTALLMENT_MANAGED_MESSAGE = "This expense is managed by Installments. Edit or undo the payment from the Installments page.";

/** Where an installment-generated expense is managed: the plan and the payment that created it. */
export interface ManagedTransactionInfo {
  transactionId: string;
  paymentId: string;
  planId: string;
  planName: string;
  installmentNumber: number;
  installmentCount: number;
  kind: "installment" | "closure";
  coversThrough: number;
}

/**
 * Expenses created by installment payments (origin 'created'), keyed by transaction id. Linked
 * transactions are the user's own entries and are deliberately not included.
 */
export function managedTransactions(
  payments: Array<Pick<InstallmentPaymentRecord, "id" | "installment_plan_id" | "installment_number" | "kind" | "covers_through" | "transaction_id" | "transaction_origin">>,
  plans: Array<Pick<InstallmentPlanRecord, "id" | "name" | "installment_count">>
) {
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const result = new Map<string, ManagedTransactionInfo>();
  for (const payment of payments) {
    if (payment.transaction_origin !== "created" || !payment.transaction_id) continue;
    const plan = planById.get(payment.installment_plan_id);
    result.set(payment.transaction_id, {
      transactionId: payment.transaction_id,
      paymentId: payment.id,
      planId: payment.installment_plan_id,
      planName: plan?.name ?? "Installment plan",
      installmentNumber: payment.installment_number,
      installmentCount: plan?.installment_count ?? payment.covers_through,
      kind: payment.kind,
      coversThrough: payment.covers_through,
    });
  }
  return result;
}

export function managedTransactionHref(info: Pick<ManagedTransactionInfo, "planId" | "paymentId">) {
  return `/installments?selected=${encodeURIComponent(info.planId)}&payment=${encodeURIComponent(info.paymentId)}`;
}

export const MAX_AMOUNT_CENTS = 99_999_999_999_999;
export const MAX_INSTALLMENTS = 600;

export type InstallmentPlanType = (typeof INSTALLMENT_PLAN_TYPES)[number]["value"];
export type InstallmentProductCategory = (typeof INSTALLMENT_PRODUCT_CATEGORIES)[number]["value"];
export type InstallmentIconName = (typeof INSTALLMENT_ICON_OPTIONS)[number]["value"];
export type InstallmentCycle = (typeof INSTALLMENT_CYCLES)[number];
export type InstallmentLifecycle = (typeof INSTALLMENT_LIFECYCLES)[number];
export type InstallmentPaymentMethod = (typeof INSTALLMENT_PAYMENT_METHODS)[number];
export type InstallmentPaymentKind = (typeof INSTALLMENT_PAYMENT_KINDS)[number];
export type InstallmentTransactionOrigin = (typeof INSTALLMENT_TRANSACTION_ORIGINS)[number];
export type InstallmentRowStatus = "paid" | "closed" | "overdue" | "pending" | "upcoming";
export type InstallmentPlanStatus = "overdue" | "pending" | "upcoming" | InstallmentLifecycle;

export interface InstallmentPlanRecord {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  plan_type: InstallmentPlanType;
  provider: string;
  product_category: InstallmentProductCategory;
  icon: string;
  original_amount: number | string;
  down_payment: number | string;
  financed_amount: number | string;
  interest_amount: number | string;
  additional_fees: number | string;
  total_repayment_amount: number | string;
  currency: string;
  installment_count: number;
  default_installment_amount: number | string;
  billing_cycle: InstallmentCycle;
  billing_interval: number;
  start_date: string;
  first_due_date: string;
  reminder_days: number;
  lifecycle: InstallmentLifecycle;
  notes: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface InstallmentPaymentRecord {
  id: string;
  user_id: string;
  installment_plan_id: string;
  installment_number: number;
  kind: InstallmentPaymentKind;
  covers_through: number;
  due_date: string;
  expected_amount: number | string;
  actual_amount: number | string;
  payment_date: string;
  payment_method: InstallmentPaymentMethod;
  account_id: string | null;
  transaction_id: string | null;
  transaction_origin: InstallmentTransactionOrigin | null;
  notes: string | null;
  paid_at: string;
  created_at: string;
  updated_at?: string | null;
}

export interface InstallmentPlanInput {
  name: string;
  description: string;
  planType: InstallmentPlanType;
  provider: string;
  productCategory: InstallmentProductCategory;
  icon: InstallmentIconName;
  originalAmount: number;
  downPayment: number;
  interestAmount: number;
  additionalFees: number;
  currency: string;
  installmentCount: number;
  defaultInstallmentAmount: number;
  billingCycle: InstallmentCycle;
  billingInterval: number;
  startDate: string;
  firstDueDate: string;
  reminderDays: number;
  notes: string;
}

/* ------------------------------------------------------------------ guards */

export const isInstallmentPlanType = (value: unknown): value is InstallmentPlanType =>
  typeof value === "string" && INSTALLMENT_PLAN_TYPES.some((item) => item.value === value);
export const isInstallmentProductCategory = (value: unknown): value is InstallmentProductCategory =>
  typeof value === "string" && INSTALLMENT_PRODUCT_CATEGORIES.some((item) => item.value === value);
export const isInstallmentIcon = (value: unknown): value is InstallmentIconName =>
  typeof value === "string" && INSTALLMENT_ICON_OPTIONS.some((item) => item.value === value);
export const isInstallmentCycle = (value: unknown): value is InstallmentCycle =>
  typeof value === "string" && INSTALLMENT_CYCLES.includes(value as InstallmentCycle);
export const isInstallmentLifecycle = (value: unknown): value is InstallmentLifecycle =>
  typeof value === "string" && INSTALLMENT_LIFECYCLES.includes(value as InstallmentLifecycle);
export const isInstallmentPaymentMethod = (value: unknown): value is InstallmentPaymentMethod =>
  typeof value === "string" && INSTALLMENT_PAYMENT_METHODS.includes(value as InstallmentPaymentMethod);
export const isInstallmentPaymentKind = (value: unknown): value is InstallmentPaymentKind =>
  typeof value === "string" && INSTALLMENT_PAYMENT_KINDS.includes(value as InstallmentPaymentKind);
export const isInstallmentTransactionOrigin = (value: unknown): value is InstallmentTransactionOrigin =>
  typeof value === "string" && INSTALLMENT_TRANSACTION_ORIGINS.includes(value as InstallmentTransactionOrigin);

/* ------------------------------------------------------------------ labels */

export function installmentToday(now = new Date()) {
  return dailyBudgetToday(now);
}

export function planTypeLabel(value: InstallmentPlanType) {
  return INSTALLMENT_PLAN_TYPES.find((item) => item.value === value)?.label ?? "Custom plan";
}

export function productCategoryLabel(value: InstallmentProductCategory) {
  return INSTALLMENT_PRODUCT_CATEGORIES.find((item) => item.value === value)?.label ?? "Other";
}

export function installmentCycleLabel(cycle: InstallmentCycle, interval = 1) {
  if (cycle === "custom_days") return `Every ${interval} day${interval === 1 ? "" : "s"}`;
  if (cycle === "custom_months") return `Every ${interval} month${interval === 1 ? "" : "s"}`;
  return ({ weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly" } as const)[cycle];
}

export function paymentMethodLabel(method: InstallmentPaymentMethod) {
  return ({ account: "Linked account", cash: "Cash", manual: "Other / Manual" } as const)[method];
}

export function formatInstallmentDate(date: string, withYear = true) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** The expense transaction description for a payment, e.g. "iPhone EMI – Installment 3/12". */
export function installmentTransactionDescription(
  planName: string,
  installmentNumber: number,
  installmentCount: number,
  kind: InstallmentPaymentKind = "installment",
  coversThrough = installmentNumber
) {
  const name = planName.trim();
  if (kind === "closure") {
    const range = coversThrough > installmentNumber ? `${installmentNumber}–${coversThrough}` : String(installmentNumber);
    return `${name} – Early closure ${range}/${installmentCount}`;
  }
  return `${name} – Installment ${installmentNumber}/${installmentCount}`;
}

/* ------------------------------------------------------------------ money */

const cents = (value: number | string | null | undefined) => toCents(value);
const fromCents = (value: number) => value / 100;

function hasTwoDecimals(value: number) {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
}

export interface InstallmentFinancials {
  financedCents: number;
  totalCents: number;
  /** The default per-installment amount (all but the last installment). */
  installmentCents: number;
  /** The last installment: total minus every earlier installment. */
  finalCents: number;
}

/** Even split of a total, rounded to the cent; the final installment absorbs the remainder. */
export function suggestInstallmentAmount(totalRepayment: number, installmentCount: number) {
  if (!Number.isInteger(installmentCount) || installmentCount < 1) return 0;
  const total = cents(totalRepayment);
  if (total <= 0) return 0;
  return fromCents(Math.round(total / installmentCount));
}

export function computeFinancials(input: {
  originalAmount: number;
  downPayment: number;
  interestAmount: number;
  additionalFees: number;
  installmentCount: number;
  defaultInstallmentAmount: number;
}): InstallmentFinancials {
  const financedCents = cents(input.originalAmount) - cents(input.downPayment);
  const totalCents = financedCents + cents(input.interestAmount) + cents(input.additionalFees);
  const count = Math.max(1, Math.trunc(input.installmentCount) || 1);
  const installmentCents = cents(input.defaultInstallmentAmount);
  const finalCents = totalCents - installmentCents * (count - 1);
  return { financedCents, totalCents, installmentCents, finalCents };
}

type PlanMoney = Pick<InstallmentPlanRecord, "total_repayment_amount" | "installment_count" | "default_installment_amount">;

/** Expected amount of installment n (1-based) in cents. */
export function expectedInstallmentCents(plan: PlanMoney, installmentNumber: number) {
  const count = plan.installment_count;
  const each = cents(plan.default_installment_amount);
  if (installmentNumber < count) return each;
  return cents(plan.total_repayment_amount) - each * (count - 1);
}

export function expectedInstallmentAmount(plan: PlanMoney, installmentNumber: number) {
  return fromCents(expectedInstallmentCents(plan, installmentNumber));
}

/** Sum of the expected amounts of installments from..through (inclusive), in cents. */
export function expectedRangeCents(plan: PlanMoney, from: number, through: number) {
  let total = 0;
  for (let n = from; n <= through; n += 1) total += expectedInstallmentCents(plan, n);
  return total;
}

/* ------------------------------------------------------------------ dates */

function dateParts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Moves a date by whole months keeping the anchor day, clamped to the month's length. Always
 * computed from the first due date (never chained), so 31 Jan → 28/29 Feb → 31 Mar.
 */
function addMonthsAnchored(date: string, months: number) {
  const { year, month, day } = dateParts(date);
  const index = month - 1 + months;
  const targetYear = year + Math.floor(index / 12);
  const targetMonth = (((index % 12) + 12) % 12) + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

type PlanSchedule = Pick<InstallmentPlanRecord, "first_due_date" | "billing_cycle" | "billing_interval">;

/** Due date of installment n (1-based). */
export function installmentDueDate(plan: PlanSchedule, installmentNumber: number) {
  const steps = installmentNumber - 1;
  const interval = Math.max(1, plan.billing_interval || 1);
  switch (plan.billing_cycle) {
    case "weekly":
      return addDays(plan.first_due_date, 7 * steps);
    case "custom_days":
      return addDays(plan.first_due_date, interval * steps);
    case "quarterly":
      return addMonthsAnchored(plan.first_due_date, 3 * steps);
    case "custom_months":
      return addMonthsAnchored(plan.first_due_date, interval * steps);
    case "monthly":
    default:
      return addMonthsAnchored(plan.first_due_date, steps);
  }
}

export function daysBetween(from: string, to: string) {
  const a = dateParts(from);
  const b = dateParts(to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

/* ------------------------------------------------------------------ schedule */

export interface InstallmentScheduleRow {
  number: number;
  dueDate: string;
  expectedAmount: number;
  status: InstallmentRowStatus;
  /** The payment that settled this installment (for a closure, only on its first row). */
  payment: InstallmentPaymentRecord | null;
  /** Set on every row covered by an early closure. */
  closure: InstallmentPaymentRecord | null;
  daysUntilDue: number;
}

type ScheduleRecord = PlanMoney & PlanSchedule & Pick<InstallmentPlanRecord, "id" | "reminder_days">;

function unpaidStatus(dueDate: string, today: string, reminderDays: number): InstallmentRowStatus {
  if (dueDate < today) return "overdue";
  return daysBetween(today, dueDate) <= reminderDays ? "pending" : "upcoming";
}

export function buildSchedule(
  plan: ScheduleRecord,
  payments: InstallmentPaymentRecord[],
  today: string
): InstallmentScheduleRow[] {
  const own = payments.filter((payment) => payment.installment_plan_id === plan.id);
  const byNumber = new Map(own.filter((payment) => payment.kind !== "closure").map((payment) => [payment.installment_number, payment]));
  const closure = own.find((payment) => payment.kind === "closure") ?? null;
  const rows: InstallmentScheduleRow[] = [];
  for (let number = 1; number <= plan.installment_count; number += 1) {
    const dueDate = installmentDueDate(plan, number);
    const payment = byNumber.get(number) ?? null;
    const coveredByClosure =
      !payment && closure !== null && number >= closure.installment_number && number <= closure.covers_through;
    rows.push({
      number,
      dueDate,
      expectedAmount: expectedInstallmentAmount(plan, number),
      status: payment ? "paid" : coveredByClosure ? "closed" : unpaidStatus(dueDate, today, plan.reminder_days),
      payment: payment ?? (coveredByClosure && closure?.installment_number === number ? closure : null),
      closure: coveredByClosure ? closure : null,
      daysUntilDue: daysBetween(today, dueDate),
    });
  }
  return rows;
}

export interface InstallmentPlanSummary {
  rows: InstallmentScheduleRow[];
  paidCount: number;
  settledCount: number;
  paidCents: number;
  remainingCents: number;
  nextRow: InstallmentScheduleRow | null;
  overdueRows: InstallmentScheduleRow[];
  pendingRows: InstallmentScheduleRow[];
  status: InstallmentPlanStatus;
  progress: number;
}

export function summarizePlan(
  plan: InstallmentPlanRecord,
  payments: InstallmentPaymentRecord[],
  today: string
): InstallmentPlanSummary {
  const rows = buildSchedule(plan, payments, today);
  const own = payments.filter((payment) => payment.installment_plan_id === plan.id);
  const paidCents = own.reduce((sum, payment) => sum + cents(payment.actual_amount), 0);
  const settledCount = rows.filter((row) => row.status === "paid" || row.status === "closed").length;
  const paidCount = rows.filter((row) => row.status === "paid").length;
  const hasClosure = own.some((payment) => payment.kind === "closure");
  const remainingCents = hasClosure ? 0 : Math.max(0, cents(plan.total_repayment_amount) - paidCents);
  const unpaid = rows.filter((row) => row.status !== "paid" && row.status !== "closed");
  const nextRow = unpaid[0] ?? null;
  const overdueRows = unpaid.filter((row) => row.status === "overdue");
  const pendingRows = unpaid.filter((row) => row.status === "pending");
  let status: InstallmentPlanStatus = plan.lifecycle;
  if (plan.lifecycle === "active") {
    status = overdueRows.length ? "overdue" : pendingRows.length ? "pending" : nextRow ? "upcoming" : "completed";
  }
  return {
    rows,
    paidCount,
    settledCount,
    paidCents,
    remainingCents,
    nextRow,
    overdueRows,
    pendingRows,
    status,
    progress: plan.installment_count ? Math.round((settledCount / plan.installment_count) * 100) : 0,
  };
}

type Coverage = Pick<InstallmentPaymentRecord, "installment_number" | "covers_through">;

/** Number of distinct installments (1..count) the payments settle. */
export function coveredInstallmentCount(installmentCount: number, payments: Coverage[]) {
  const covered = new Set<number>();
  for (const payment of payments) {
    for (let n = Math.max(1, payment.installment_number); n <= Math.min(installmentCount, payment.covers_through); n += 1) covered.add(n);
  }
  return covered.size;
}

/**
 * Whether every installment is genuinely settled. A closure record alone is not enough: its range
 * plus the individual payments must cover installments 1..count (same rule as the database).
 */
export function isPlanSettled(installmentCount: number, payments: Coverage[]) {
  return coveredInstallmentCount(installmentCount, payments) >= installmentCount;
}

/**
 * Coverage rules for a new or corrected payment, given the plan's other payments: no installment
 * may be settled twice, and an early closure must start at the first unpaid installment and run
 * through the last one. Mirrors save_installment_payment() and the database guard trigger.
 */
export function coverageError(
  input: { installmentNumber: number; kind: InstallmentPaymentKind; coversThrough: number },
  installmentCount: number,
  others: Array<Coverage & Pick<InstallmentPaymentRecord, "kind">>
) {
  const covers = input.kind === "closure" ? installmentCount : input.installmentNumber;
  if (input.kind === "closure" && input.coversThrough !== installmentCount) return "An early closure must settle every remaining installment.";
  const overlap = others.find((other) => other.installment_number <= covers && other.covers_through >= input.installmentNumber);
  if (overlap) {
    if (input.kind === "closure") return "An installment in the closure range is already paid. Undo it or close from a later installment.";
    if (overlap.kind === "closure") return "This installment was settled by the early closure.";
    return `Installment ${input.installmentNumber} already has a payment.`;
  }
  if (input.kind === "closure") {
    let first = 1;
    while (first <= installmentCount && others.some((other) => first >= other.installment_number && first <= other.covers_through)) first += 1;
    if (first !== input.installmentNumber) return `An early closure must start at the first unpaid installment (${first}).`;
  }
  return null;
}

/** What an early closure is expected to settle: the total repayment minus every amount actually paid. */
export function closureExpectedCents(
  plan: Pick<InstallmentPlanRecord, "total_repayment_amount">,
  others: Array<Pick<InstallmentPaymentRecord, "actual_amount">>
) {
  return cents(plan.total_repayment_amount) - others.reduce((sum, other) => sum + cents(other.actual_amount), 0);
}

/**
 * The lifecycle after a payment change: an active plan becomes completed once settled, and a
 * completed plan returns to active when it no longer is (undo, or more installments added).
 * Paused and cancelled are always the user's own choice and are kept.
 */
export function settledLifecycle(
  lifecycle: InstallmentLifecycle,
  installmentCount: number,
  payments: Coverage[]
): InstallmentLifecycle {
  const settled = isPlanSettled(installmentCount, payments);
  if (lifecycle === "active" && settled) return "completed";
  if (lifecycle === "completed" && !settled) return "active";
  return lifecycle;
}

export interface UpcomingInstallment {
  plan: InstallmentPlanRecord;
  row: InstallmentScheduleRow;
  progressLabel: string;
}

/** Unpaid installments of active plans only, soonest first (overdue ones first of all). */
export function upcomingInstallments(
  plans: InstallmentPlanRecord[],
  payments: InstallmentPaymentRecord[],
  today: string
) {
  const items: UpcomingInstallment[] = [];
  for (const plan of plans) {
    if (plan.lifecycle !== "active") continue;
    const summary = summarizePlan(plan, payments, today);
    const next = summary.nextRow;
    if (!next) continue;
    items.push({ plan, row: next, progressLabel: `${summary.settledCount}/${plan.installment_count}` });
  }
  return items.sort((a, b) => a.row.dueDate.localeCompare(b.row.dueDate) || a.plan.name.localeCompare(b.plan.name));
}

/* ------------------------------------------------------------------ validation */

function moneyError(value: number, label: string, { allowZero = false } = {}) {
  if (!Number.isFinite(value)) return `Enter a valid ${label}.`;
  if (allowZero ? value < 0 : value <= 0) return `${label[0].toUpperCase()}${label.slice(1)} must be ${allowZero ? "zero or more" : "greater than zero"}.`;
  if (cents(value) > MAX_AMOUNT_CENTS) return `That ${label} is too large.`;
  if (!hasTwoDecimals(value)) return "Use at most two decimal places.";
  return null;
}

export function validatePlanInput(input: InstallmentPlanInput) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return "Product or plan name is required.";
  if (name.length > 80) return "Keep the name under 80 characters.";
  if ((input.description ?? "").trim().length > 200) return "Keep the description under 200 characters.";
  if (!isInstallmentPlanType(input.planType)) return "Choose a valid installment type.";
  const provider = typeof input.provider === "string" ? input.provider.trim() : "";
  if (!provider) return "Choose or enter a provider.";
  if (provider.length > 60) return "Keep the provider under 60 characters.";
  if (!isInstallmentProductCategory(input.productCategory)) return "Choose a valid product category.";
  if (!isInstallmentIcon(input.icon)) return "Choose a valid icon.";
  const invalidMoney =
    moneyError(input.originalAmount, "purchase price") ??
    moneyError(input.downPayment, "down payment", { allowZero: true }) ??
    moneyError(input.interestAmount, "interest amount", { allowZero: true }) ??
    moneyError(input.additionalFees, "fee amount", { allowZero: true });
  if (invalidMoney) return invalidMoney;
  if (cents(input.downPayment) >= cents(input.originalAmount)) return "Down payment must be less than the purchase price.";
  if (!Number.isInteger(input.installmentCount) || input.installmentCount < 1 || input.installmentCount > MAX_INSTALLMENTS) {
    return `Number of installments must be between 1 and ${MAX_INSTALLMENTS}.`;
  }
  const installmentError = moneyError(input.defaultInstallmentAmount, "installment amount");
  if (installmentError) return installmentError;
  const financials = computeFinancials(input);
  if (financials.totalCents > MAX_AMOUNT_CENTS) return "That total repayment is too large.";
  if (input.installmentCount === 1 && financials.installmentCents !== financials.totalCents) {
    return "A single installment must equal the total repayment.";
  }
  if (financials.finalCents <= 0) {
    return "The installment amount is too high: the last installment would be zero or less.";
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) return "Choose a valid currency.";
  if (!isInstallmentCycle(input.billingCycle)) return "Choose a valid installment frequency.";
  if (!Number.isInteger(input.billingInterval) || input.billingInterval < 1) return "Choose a valid custom interval.";
  if (input.billingCycle === "custom_days" && input.billingInterval > 3650) return "Custom day intervals cannot exceed 3650 days.";
  if (input.billingCycle === "custom_months" && input.billingInterval > 120) return "Custom month intervals cannot exceed 120 months.";
  if (!isDateKey(input.startDate) || !isDateKey(input.firstDueDate) || input.startDate < "2000-01-01") {
    return "Choose valid plan dates.";
  }
  if (input.firstDueDate < input.startDate) return "The first due date cannot be before the purchase date.";
  if (!Number.isInteger(input.reminderDays) || input.reminderDays < 0 || input.reminderDays > 365) {
    return "Reminder days must be between 0 and 365.";
  }
  if ((input.notes ?? "").trim().length > 500) return "Keep notes under 500 characters.";
  return null;
}

/** Plan edits can't drop installments that already have payments. */
export function validatePlanAgainstPayments(
  installmentCount: number,
  payments: Pick<InstallmentPaymentRecord, "installment_number" | "covers_through" | "kind">[]
) {
  const closure = payments.find((payment) => payment.kind === "closure");
  if (closure && installmentCount !== closure.covers_through) {
    return "Undo the early closure before changing the number of installments.";
  }
  const highest = payments.reduce((max, payment) => Math.max(max, payment.covers_through), 0);
  if (installmentCount < highest) {
    return `Installment ${highest} already has a payment, so the plan needs at least ${highest} installments.`;
  }
  return null;
}

export interface InstallmentPaymentFields {
  installmentNumber: number;
  kind: InstallmentPaymentKind;
  coversThrough: number;
  actualAmount: number;
  paymentDate: string;
  paymentMethod: InstallmentPaymentMethod;
  accountId: string | null;
  transactionOrigin: InstallmentTransactionOrigin | null;
  transactionId: string | null;
  notes: string;
}

export function validatePaymentFields(input: InstallmentPaymentFields, installmentCount: number) {
  if (!isInstallmentPaymentKind(input.kind)) return "Choose a valid payment type.";
  if (!Number.isInteger(input.installmentNumber) || input.installmentNumber < 1 || input.installmentNumber > installmentCount) {
    return "That installment is not part of this plan.";
  }
  if (input.kind === "installment" && input.coversThrough !== input.installmentNumber) return "That installment is not part of this plan.";
  if (input.kind === "closure" && input.coversThrough !== installmentCount) {
    return "An early closure must settle every remaining installment.";
  }
  const amountError = moneyError(input.actualAmount, "amount paid");
  if (amountError) return amountError;
  if (!isDateKey(input.paymentDate) || input.paymentDate < "2000-01-01") return "Choose a valid payment date.";
  if (!isInstallmentPaymentMethod(input.paymentMethod)) return "Choose a payment method.";
  if (input.paymentMethod === "account") {
    if (!input.accountId) return "Choose the account this installment was paid from.";
    if (!isInstallmentTransactionOrigin(input.transactionOrigin) || !input.transactionId) {
      return "Choose the account this installment was paid from.";
    }
  } else if (input.accountId || input.transactionId || input.transactionOrigin) {
    return "Cash and manual payments cannot use an account.";
  }
  if ((input.notes ?? "").trim().length > 300) return "Keep notes under 300 characters.";
  return null;
}

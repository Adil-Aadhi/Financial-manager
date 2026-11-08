import { addDays, dailyBudgetToday, isDateKey, toCents } from "@/lib/dailyBudget";

/** Bills are reminders only. This module has no account, transaction, or budget dependency. */
export const BILL_CATEGORIES = [
  { value: "internet", label: "Internet / Wi-Fi", icon: "wifi" },
  { value: "mobile", label: "Mobile", icon: "smartphone" },
  { value: "electricity", label: "Electricity", icon: "zap" },
  { value: "water", label: "Water", icon: "droplets" },
  { value: "rent", label: "Rent", icon: "house" },
  { value: "insurance", label: "Insurance", icon: "shield-check" },
  { value: "lic", label: "LIC", icon: "heart-handshake" },
  { value: "education", label: "Education", icon: "graduation-cap" },
  { value: "loan", label: "Loan / EMI", icon: "landmark" },
  { value: "other", label: "Other", icon: "receipt-text" },
] as const;

export const BILL_ICON_OPTIONS = [
  { value: "receipt-text", label: "General bill" },
  { value: "wifi", label: "Internet / Wi-Fi" },
  { value: "smartphone", label: "Mobile" },
  { value: "zap", label: "Electricity" },
  { value: "droplets", label: "Water" },
  { value: "house", label: "Rent / home" },
  { value: "shield-check", label: "Insurance" },
  { value: "heart-handshake", label: "LIC / life cover" },
  { value: "graduation-cap", label: "Education" },
  { value: "landmark", label: "Loan / EMI" },
  { value: "car", label: "Vehicle" },
  { value: "heart-pulse", label: "Health" },
  { value: "building-2", label: "Property" },
  { value: "flame", label: "Gas" },
  { value: "tv", label: "TV" },
  { value: "phone", label: "Telephone" },
  { value: "bus", label: "Transport" },
  { value: "book-open", label: "Books" },
  { value: "baby", label: "Childcare" },
  { value: "wrench", label: "Maintenance" },
  { value: "calendar-days", label: "Scheduled payment" },
  { value: "circle-ellipsis", label: "Other" },
] as const;

export const BILL_CYCLES = ["weekly", "monthly", "quarterly", "half-yearly", "yearly", "custom_days", "custom_months"] as const;
export const BILL_LIFECYCLES = ["active", "paused", "cancelled"] as const;
export const BILL_AMOUNT_TYPES = ["fixed", "variable"] as const;
export const DEFAULT_BILL_ICON = "receipt-text";

export type BillCategory = (typeof BILL_CATEGORIES)[number]["value"];
export type BillIconName = (typeof BILL_ICON_OPTIONS)[number]["value"];
export type BillCycle = (typeof BILL_CYCLES)[number];
export type BillLifecycle = (typeof BILL_LIFECYCLES)[number];
export type BillAmountType = (typeof BILL_AMOUNT_TYPES)[number];
export type BillStatus = "upcoming" | "pending" | "overdue" | BillLifecycle;

export interface BillRecord {
  id: string;
  user_id: string;
  name: string;
  category: BillCategory;
  icon: BillIconName;
  amount_type: BillAmountType;
  expected_amount: number | string | null;
  currency: string;
  billing_cycle: BillCycle;
  billing_interval: number;
  billing_anchor_day: number;
  start_date: string;
  next_due_date: string;
  reminder_days: number;
  lifecycle: BillLifecycle;
  notes: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface BillPaymentRecord {
  id: string;
  user_id: string;
  bill_id: string;
  due_date: string;
  expected_amount: number | string | null;
  actual_amount: number | string;
  payment_date: string;
  paid_at: string;
  status: "paid";
  /** Currency is inherited from the bill; optional for presentation compatibility. */
  currency?: string;
  created_at: string;
  updated_at?: string | null;
}

export interface BillInput {
  name: string;
  category: BillCategory;
  icon: BillIconName;
  amountType: BillAmountType;
  expectedAmount: number | null;
  currency: string;
  billingCycle: BillCycle;
  billingInterval: number;
  startDate: string;
  nextDueDate: string;
  reminderDays: number;
  notes: string;
}

export function isBillCategory(value: unknown): value is BillCategory {
  return typeof value === "string" && BILL_CATEGORIES.some((item) => item.value === value);
}
export function isBillIcon(value: unknown): value is BillIconName {
  return typeof value === "string" && BILL_ICON_OPTIONS.some((item) => item.value === value);
}
export function isBillCycle(value: unknown): value is BillCycle {
  return typeof value === "string" && BILL_CYCLES.includes(value as BillCycle);
}
export function isBillLifecycle(value: unknown): value is BillLifecycle {
  return typeof value === "string" && BILL_LIFECYCLES.includes(value as BillLifecycle);
}
export function isBillAmountType(value: unknown): value is BillAmountType {
  return typeof value === "string" && BILL_AMOUNT_TYPES.includes(value as BillAmountType);
}

export function billToday(now = new Date()) {
  return dailyBudgetToday(now);
}

export function billCategoryLabel(value: BillCategory) {
  return BILL_CATEGORIES.find((item) => item.value === value)?.label ?? "Other";
}

export function billCycleLabel(cycle: BillCycle, interval = 1) {
  if (cycle === "custom_days") return `Every ${interval} day${interval === 1 ? "" : "s"}`;
  if (cycle === "custom_months") return `Every ${interval} month${interval === 1 ? "" : "s"}`;
  return ({ weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", "half-yearly": "Half-yearly", yearly: "Yearly" } as const)[cycle];
}

function parts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}
function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function moveMonths(date: string, months: number, anchorDay?: number) {
  const { year, month, day } = parts(date);
  const index = month - 1 + months;
  const targetYear = year + Math.floor(index / 12);
  const targetMonth = ((index % 12) + 12) % 12 + 1;
  const targetDay = Math.min(anchorDay ?? day, daysInMonth(targetYear, targetMonth));
  return `${targetYear.toString().padStart(4, "0")}-${targetMonth.toString().padStart(2, "0")}-${targetDay.toString().padStart(2, "0")}`;
}

function cycleMonths(cycle: BillCycle, interval: number) {
  if (cycle === "monthly") return 1;
  if (cycle === "quarterly") return 3;
  if (cycle === "half-yearly") return 6;
  if (cycle === "yearly") return 12;
  if (cycle === "custom_months") return interval;
  return null;
}

export function addBillCycle(date: string, cycle: BillCycle, interval = 1, anchorDay?: number) {
  if (cycle === "weekly") return addDays(date, 7);
  if (cycle === "custom_days") return addDays(date, interval);
  return moveMonths(date, cycleMonths(cycle, interval) ?? 1, anchorDay);
}

export function previousBillCycle(date: string, cycle: BillCycle, interval = 1, anchorDay?: number) {
  if (cycle === "weekly") return addDays(date, -7);
  if (cycle === "custom_days") return addDays(date, -interval);
  return moveMonths(date, -(cycleMonths(cycle, interval) ?? 1), anchorDay);
}

export function daysBetweenBillDates(from: string, to: string) {
  const a = parts(from);
  const b = parts(to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

export function billStatus(bill: BillRecord, today: string): BillStatus {
  if (bill.lifecycle !== "active") return bill.lifecycle;
  if (bill.next_due_date < today) return "overdue";
  if (bill.next_due_date === today) return "pending";
  return "upcoming";
}

export function billProgress(bill: BillRecord, today: string) {
  const calculated = previousBillCycle(bill.next_due_date, bill.billing_cycle, bill.billing_interval, bill.billing_anchor_day);
  const start = bill.start_date > calculated ? bill.start_date : calculated;
  const total = Math.max(1, daysBetweenBillDates(start, bill.next_due_date));
  return Math.min(100, Math.max(0, Math.round((daysBetweenBillDates(start, today) / total) * 100)));
}

export function billMonthlyEstimate(bill: Pick<BillRecord, "expected_amount" | "billing_cycle" | "billing_interval">) {
  if (bill.expected_amount === null || bill.expected_amount === "") return 0;
  const amount = Number(bill.expected_amount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (bill.billing_cycle === "weekly") return amount * 52 / 12;
  if (bill.billing_cycle === "custom_days") return amount * 365 / (12 * bill.billing_interval);
  return amount / (cycleMonths(bill.billing_cycle, bill.billing_interval) ?? 1);
}

/** Cycle-month history uses due_date, so late confirmations stay with the bill they settled. */
export function billPaymentsForMonth(payments: BillPaymentRecord[], month: string) {
  return payments.filter((payment) => payment.due_date.startsWith(month));
}

export function validateBillInput(input: BillInput) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return "Bill name is required.";
  if (name.length > 80) return "Keep the bill name under 80 characters.";
  if (!isBillCategory(input.category)) return "Choose a valid bill category.";
  if (!isBillIcon(input.icon)) return "Choose a valid bill icon.";
  if (!isBillAmountType(input.amountType)) return "Choose a valid amount type.";
  if (input.expectedAmount !== null) {
    if (!Number.isFinite(input.expectedAmount) || input.expectedAmount <= 0) return "Expected amount must be greater than zero.";
    if (input.expectedAmount > 999_999_999_999.99) return "That amount is too large.";
    if (Math.abs(input.expectedAmount * 100 - Math.round(input.expectedAmount * 100)) > 1e-7) return "Use at most two decimal places.";
  }
  if (input.amountType === "fixed" && input.expectedAmount === null) return "A fixed bill needs an expected amount.";
  if (!/^[A-Z]{3}$/.test(input.currency)) return "Choose a valid currency.";
  if (!isBillCycle(input.billingCycle)) return "Choose a valid billing frequency.";
  if (!Number.isInteger(input.billingInterval) || input.billingInterval < 1) return "Choose a valid billing interval.";
  if (input.billingCycle === "custom_days" && input.billingInterval > 3650) return "Custom day intervals cannot exceed 3650 days.";
  if (input.billingCycle === "custom_months" && input.billingInterval > 120) return "Custom month intervals cannot exceed 120 months.";
  if (!isDateKey(input.startDate) || !isDateKey(input.nextDueDate) || input.startDate < "2000-01-01" || input.nextDueDate < "2000-01-01") return "Choose valid bill dates.";
  if (input.nextDueDate < input.startDate) return "Next due date cannot be before the start date.";
  if (!Number.isInteger(input.reminderDays) || input.reminderDays < 0 || input.reminderDays > 365) return "Reminder days must be between 0 and 365.";
  if (input.notes.trim().length > 500) return "Keep notes under 500 characters.";
  return null;
}

export function validateBillPayment(actualAmount: number, paymentDate: string, dueDate: string) {
  if (!Number.isFinite(actualAmount) || actualAmount <= 0 || actualAmount > 999_999_999_999.99) return "Enter a valid amount paid.";
  if (Math.abs(actualAmount * 100 - Math.round(actualAmount * 100)) > 1e-7) return "Use at most two decimal places.";
  if (!isDateKey(paymentDate) || !isDateKey(dueDate) || paymentDate < "2000-01-01" || dueDate < "2000-01-01") return "Choose valid payment dates.";
  return null;
}

export function sameBillMoney(left: number | string | null, right: number | string | null) {
  if (left === null || right === null) return left === right;
  return toCents(left) === toCents(right);
}

export function formatBillDate(date: string) {
  const { year, month, day } = parts(date);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}
